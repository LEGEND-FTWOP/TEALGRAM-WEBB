/* Runs in Telegram's page world. Uses Telegram's existing authenticated file loader. */
(() => {
  'use strict';
  if (window.__tgdocBridgeV1) return;
  window.__tgdocBridgeV1 = true;

  const CHANNEL = 'tgdoc-v1';
  const transfer = window.TGDocTransfer;
  const jobs = new Map();
  const remembered = new Map();
  const CACHE_LIMIT = 64 * 1024 * 1024;
  let cacheBytes = 0;
  const createObjectURL = URL.createObjectURL.bind(URL);

  // Remember only exact document URLs. Never guess which file a recent Blob belongs to.
  // Telegram's URL revocation remains untouched; this cache is bounded.
  URL.createObjectURL = function (object) {
    const url = createObjectURL(object);
    if (object instanceof Blob && object.size > 0 && object.size <= CACHE_LIMIT &&
        /^(application\/(?!x-mpegurl|vnd\.apple\.mpegurl)|text\/)/i.test(object.type) &&
        !/html/i.test(object.type)) {
      remembered.set(url, object);
      cacheBytes += object.size;
      while (cacheBytes > CACHE_LIMIT || remembered.size > 24) {
        const key = remembered.keys().next().value;
        cacheBytes -= remembered.get(key).size;
        remembered.delete(key);
      }
    }
    return url;
  };

  function post(action, id, detail = {}) {
    window.postMessage({ channel: CHANNEL, action, id, ...detail }, location.origin);
  }

  function findCard(token) {
    if (typeof token !== 'string' || !/^[\w-]{1,120}$/.test(token)) return null;
    return document.querySelector(`[data-tgdoc-token="${token}"]`);
  }

  function abortError() {
    return new DOMException('Download cancelled.', 'AbortError');
  }

  async function waitForNative(promise, signal) {
    if (signal.aborted) throw abortError();
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => {
        try { promise.cancel?.(); } catch (_) { /* already settled */ }
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try { return await Promise.race([promise, aborted]); }
    finally { signal.removeEventListener('abort', onAbort); }
  }

  function exactSource(card) {
    const candidates = [card, ...card.querySelectorAll('a[href], [data-url], [data-src], [data-download-url]')];
    for (const element of candidates) {
      if (element.matches('img, video, audio, source') ||
          element.closest('.document-thumb, .thumbnail, .preview, .file-preview')) continue;
      for (const raw of [element.getAttribute('href'), element.getAttribute('data-url'), element.getAttribute('data-src'), element.getAttribute('data-download-url')]) {
        if (!raw) continue;
        try {
          const url = new URL(raw, location.href);
          if (url.origin !== location.origin || !['https:', 'blob:'].includes(url.protocol)) continue;
          // A link to a chat is not a file source.
          const isFile = url.protocol === 'blob:' || element.hasAttribute('download') ||
            /\/(?:download|document|stream)\//i.test(url.pathname) ||
            /\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z|epub|odt|ods|rtf|json|xml)(?:$|\?)/i.test(url.pathname);
          if (isFile) return url.href;
        } catch (_) { /* malformed source */ }
      }
    }
    return '';
  }

  async function download(data) {
    const id = data.id;
    if (typeof id !== 'string' || !/^[\w-]{1,120}$/.test(id) || jobs.has(id)) return;
    const card = findCard(data.elementToken);
    if (!card || !card.isConnected) {
      post('error', id, { message: 'This document is no longer visible. Scroll to it and try again.' });
      return;
    }
    if (jobs.size) {
      post('error', id, { message: 'Wait for the current document or cancel it first.' });
      return;
    }

    const controller = new AbortController();
    jobs.set(id, controller);
    const signal = controller.signal;
    const descriptor = data.descriptor && typeof data.descriptor === 'object' ? data.descriptor : {};
    let filename = String(descriptor.filename || 'telegram-document');
    let lastProgress = 0;
    const progress = (received, total) => {
      if (signal.aborted) return;
      const now = Date.now();
      if (now - lastProgress < 150 && received !== total) return;
      lastProgress = now;
      post('progress', id, {
        received: Number(received) || 0,
        total: Number(total) || 0,
        percent: total > 0 ? Math.min(99, Math.floor(received * 100 / total)) : -1,
      });
    };

    try {
      if (!transfer) throw new Error('The extension did not initialize. Refresh Telegram and try again.');
      let blob;
      let expectedSize;
      const holder = card.doc ? card : card.querySelector('.document[data-doc-id]');
      const doc = holder?.doc;
      const manager = window.appDownloadManager;

      if (doc && manager && typeof manager.downloadMedia === 'function') {
        filename = doc.file_name || filename;
        expectedSize = Number(doc.size);
        if (expectedSize > transfer.MAX_BYTES) throw new Error('This file exceeds the 512 MiB limit.');
        const promise = manager.downloadMedia({ media: doc });
        if (!promise || typeof promise.then !== 'function') {
          throw new Error('Telegram changed its file loader. Refresh Telegram Web K and try again.');
        }
        promise.addNotifyListener?.((state) => {
          progress(state?.done, state?.total || expectedSize);
        });
        blob = await waitForNative(promise, signal);
      } else {
        const src = exactSource(card);
        if (!src) {
          throw new Error('This Telegram version has not exposed the document file. Open the channel at web.telegram.org/k/, then try its Download file button.');
        }
        blob = remembered.get(src) || await transfer.fetchBlob(src, { signal, onProgress: progress });
      }

      if (signal.aborted) throw abortError();
      if (!(blob instanceof Blob) || blob.size === 0) throw new Error('Telegram returned an empty file. Refresh and retry.');
      if (blob.size > transfer.MAX_BYTES) throw new Error('This file exceeds the 512 MiB limit.');
      if (Number.isFinite(expectedSize) && expectedSize > 0 && expectedSize !== blob.size) {
        throw new Error('Telegram returned an incomplete file. Nothing was saved; try again.');
      }
      post('saving', id);
      const savedName = transfer.saveBlob(blob, filename);
      post('done', id, { filename: savedName });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') post('cancelled', id);
      else post('error', id, { message: String(error?.message || error || 'Could not load the document. Try again.') });
    } finally {
      jobs.delete(id);
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    if (data.action === 'download') void download(data);
    else if (data.action === 'cancel') jobs.get(data.id)?.abort();
  });
})();
