/* Shared by the page bridge. No network requests run until a download is requested. */
(() => {
  'use strict';
  if (window.TGDocTransfer) return;

  const MAX_BYTES = 512 * 1024 * 1024;
  const RANGE_BYTES = 1024 * 1024;
  const nativeCreateURL = URL.createObjectURL.bind(URL);
  const nativeRevokeURL = URL.revokeObjectURL.bind(URL);
  const extensions = {
    'application/pdf': 'pdf', 'application/zip': 'zip',
    'application/x-7z-compressed': '7z', 'application/x-rar-compressed': 'rar',
    'application/vnd.rar': 'rar', 'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json',
    'application/epub+zip': 'epub', 'application/rtf': 'rtf',
  };

  function sanitizeFilename(name, mime = '') {
    let clean = String(name || 'telegram-document')
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_')
      .replace(/^[.\s]+|[.\s]+$/g, '') || 'telegram-document';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) clean = '_' + clean;
    if (!/\.[^ .]{1,16}$/.test(clean)) {
      const extension = extensions[String(mime).toLowerCase().split(';')[0].trim()];
      if (extension) clean += '.' + extension;
    }
    const match = clean.match(/(\.[^ .]{1,16})$/);
    const extension = match ? match[1] : '';
    let stem = extension ? clean.slice(0, -extension.length) : clean;
    const encoder = new TextEncoder();
    while (encoder.encode(stem + extension).length > 180) stem = Array.from(stem).slice(0, -1).join('');
    return (stem || 'document') + extension;
  }

  function checkCancelled(signal) {
    if (signal?.aborted) throw new DOMException('Download cancelled.', 'AbortError');
  }

  function limit(size) {
    if (size > MAX_BYTES) throw new Error('This file exceeds the 512 MiB document download limit.');
  }

  function validateURL(src) {
    const url = new URL(String(src), location.href);
    if (url.origin !== location.origin || !['https:', 'blob:'].includes(url.protocol)) {
      throw new Error('Only document URLs from this Telegram Web page can be downloaded.');
    }
    if (url.username || url.password) throw new Error('Invalid document URL.');
    return url.href;
  }

  function numericHeader(headers, name) {
    const raw = headers.get(name);
    if (raw === null) return null;
    if (!/^\d+$/.test(raw)) throw new Error('Invalid ' + name + ' response header.');
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error('Invalid file size.');
    return value;
  }

  function progress(callback, received, total) {
    if (typeof callback !== 'function') return;
    try { callback(received, total || 0); } catch (_) { /* UI errors must not corrupt a transfer. */ }
  }

  async function readBody(response, { signal, onProgress, offset, total, expectedLength }) {
    const chunks = [];
    let size = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          checkCancelled(signal);
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          size += value.byteLength;
          limit(offset + size);
          if (expectedLength !== null && size > expectedLength) throw new Error('The document response contains unexpected extra bytes.');
          chunks.push(value);
          progress(onProgress, offset + size, total);
        }
      } catch (error) {
        try { await reader.cancel(); } catch (_) { /* Already closed. */ }
        throw error;
      } finally { reader.releaseLock(); }
    } else {
      const body = await response.blob();
      size = body.size;
      limit(offset + size);
      chunks.push(body);
      progress(onProgress, offset + size, total);
    }
    checkCancelled(signal);
    if (expectedLength !== null && size !== expectedLength) throw new Error('The document response was incomplete. Please retry.');
    if (!size) throw new Error('Telegram returned an empty document.');
    const result = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
    if (offset === 0 && /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(await result.slice(0, 512).text())) {
      throw new Error('Telegram returned a web page instead of a document. Reload Telegram Web and try again.');
    }
    return result;
  }

  async function fetchBlob(src, { signal, onProgress, expectedSize } = {}) {
    const url = validateURL(src);
    checkCancelled(signal);
    let total = null;
    if (expectedSize !== undefined && expectedSize !== null && expectedSize !== 0) {
      if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) throw new Error('Invalid expected document size.');
      total = expectedSize;
      limit(total);
    }
    let offset = 0;
    let mime = 'application/octet-stream';
    const chunks = [];
    for (;;) {
      checkCancelled(signal);
      const response = await fetch(url, {
        credentials: 'include', signal,
        headers: url.startsWith('blob:') ? {} : { Range: `bytes=${offset}-${offset + RANGE_BYTES - 1}` },
      });
      if (response.status === 416 && total !== null && offset === total && offset > 0) break;
      if (response.status !== 200 && response.status !== 206) throw new Error('Telegram document request failed (HTTP ' + response.status + ').');
      const type = (response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
      if (type === 'text/html' || type === 'application/xhtml+xml') {
        throw new Error('Telegram returned a web page instead of a document. Reload Telegram Web and try again.');
      }
      if (type) mime = type;
      if (response.status === 200) {
        if (offset !== 0) throw new Error('Telegram stopped honoring document range requests. Please retry.');
        const contentLength = numericHeader(response.headers, 'content-length');
        if (total !== null && contentLength !== null && total !== contentLength) throw new Error('The document size changed during download.');
        const expectedLength = total ?? contentLength;
        if (expectedLength !== null) limit(expectedLength);
        const blob = await readBody(response, { signal, onProgress, offset: 0, total: expectedLength, expectedLength });
        progress(onProgress, blob.size, blob.size);
        return blob;
      }
      const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(response.headers.get('content-range') || '');
      if (!match) throw new Error('Telegram returned a partial document without a valid byte range.');
      const start = Number(match[1]), end = Number(match[2]);
      const rangeTotal = match[3] === '*' ? null : Number(match[3]);
      if (![start, end, ...(rangeTotal === null ? [] : [rangeTotal])].every(Number.isSafeInteger)
        || start !== offset || end < start || (rangeTotal !== null && end >= rangeTotal)) {
        throw new Error('Telegram returned an inconsistent document byte range.');
      }
      if (rangeTotal !== null) {
        if (total !== null && total !== rangeTotal) throw new Error('The document size changed during download.');
        total = rangeTotal;
      }
      if (total === null) throw new Error('Telegram did not provide the complete document size.');
      limit(total);
      if (end >= total) throw new Error('The document response extends past its expected size.');
      const expectedLength = end - start + 1;
      const contentLength = numericHeader(response.headers, 'content-length');
      if (contentLength !== null && contentLength !== expectedLength) throw new Error('The document byte range length is inconsistent.');
      const blob = await readBody(response, { signal, onProgress, offset, total, expectedLength });
      chunks.push(blob);
      offset += blob.size;
      if (offset === total) break;
    }
    checkCancelled(signal);
    if (!offset || total !== offset) throw new Error('The document download is incomplete.');
    progress(onProgress, offset, total);
    return new Blob(chunks, { type: mime });
  }

  function saveBlob(blob, filename) {
    if (!(blob instanceof Blob) || !blob.size) throw new Error('There is no document data to save.');
    limit(blob.size);
    const url = nativeCreateURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizeFilename(filename, blob.type);
    anchor.rel = 'noopener';
    anchor.hidden = true;
    anchor.addEventListener('click', event => event.stopPropagation());
    try {
      (document.body || document.documentElement).appendChild(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => nativeRevokeURL(url), 120000);
    }
    return anchor.download;
  }

  window.TGDocTransfer = Object.freeze({ fetchBlob, saveBlob, sanitizeFilename, MAX_BYTES });
})();
