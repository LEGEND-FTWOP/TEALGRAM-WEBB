/* Document controls run in the extension's isolated world. */
(() => {
  'use strict';
  if (window.__tgdocContentLoaded) return;
  window.__tgdocContentLoaded = true;

  const CHANNEL = 'tgdoc-v1';
  const CARD_SELECTOR = '.document, .Document, .File, .document-container, .document-wrapper';
  const NAME_SELECTOR = '.document-name, .file-name, .filename, .fullName, .full-name, .document-title, .file-title';
  const MESSAGE_SELECTOR = '[data-mid], [data-message-id], .Message[id], .bubble';
  const MEDIA_EXTENSION = /\.(?:mp4|m4v|webm|mov|mkv|avi|mp3|m4a|ogg|oga|opus|wav|flac|aac|jpe?g|png|gif|webp|avif|heic|tgs|webm)$/i;
  const records = new Map();
  const pending = new Map();
  const IDLE_TIMEOUT = 10 * 60 * 1000;
  let active = null;
  let scanTimer = 0;

  function randomId() {
    return crypto.randomUUID();
  }

  function text(value) {
    return String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  }

  function filenameOf(card) {
    const direct = card.getAttribute('data-file-name') || card.getAttribute('data-filename');
    if (text(direct)) return text(direct);
    // A's fullName can be nested inside filename; prefer the complete string.
    const names = [...card.querySelectorAll(NAME_SELECTOR)];
    if (card.matches(NAME_SELECTOR)) names.unshift(card);
    for (const name of names) {
      const title = name.getAttribute('title') || name.getAttribute('data-original-title');
      if (text(title)) return text(title);
      if (text(name.textContent)) return text(name.textContent);
    }
    const anchor = card.matches('a[download]') ? card : card.querySelector('a[download]');
    if (anchor && text(anchor.getAttribute('download'))) return text(anchor.getAttribute('download'));
    const title = card.getAttribute('title');
    return title && /\.[a-z\d]{1,12}$/i.test(text(title)) ? text(title) : '';
  }

  function sourceOf(card) {
    const elements = [card, ...card.querySelectorAll('a[href], [data-url], [data-download-url]')];
    for (const el of elements) {
      for (const attr of ['data-download-url', 'data-url', 'href']) {
        const raw = el.getAttribute(attr);
        if (!raw || raw.startsWith('#')) continue;
        try {
          const url = new URL(raw, location.href);
          if ((url.protocol === 'https:' && url.origin === location.origin)
              || (url.protocol === 'blob:' && url.origin === location.origin)) return url.href;
        } catch (_) { /* Telegram may not have created a file URL yet. */ }
      }
    }
    return '';
  }

  function descriptorOf(card) {
    const message = card.closest(MESSAGE_SELECTOR);
    const peer = card.closest('[data-peer-id]') || message?.querySelector('[data-peer-id]');
    const rawId = message?.getAttribute('data-mid') || message?.getAttribute('data-message-id') || message?.id || '';
    const documentNode = card.matches('[data-document-id], [data-doc-id]')
      ? card : card.querySelector('[data-document-id], [data-doc-id]');
    return {
      messageId: rawId.replace(/^message[-_]/i, ''),
      peerId: peer?.getAttribute('data-peer-id') || location.hash,
      documentId: documentNode?.getAttribute('data-document-id') || documentNode?.getAttribute('data-doc-id') || '',
      filename: filenameOf(card),
      src: sourceOf(card),
    };
  }

  function identityOf(descriptor) {
    return JSON.stringify([descriptor.peerId, descriptor.messageId, descriptor.documentId, descriptor.filename]);
  }

  function isDocument(card, descriptor) {
    if (card.closest('.tgdoc-controls, .MediaViewer, .media-viewer, .Audio, .audio, .voice-message, .sticker')) return false;
    if (card.matches('.document-audio, .document-voice, .is-audio, .is-voice, .is-sticker')) return false;
    if (MEDIA_EXTENSION.test(descriptor.filename)) return false;
    if (card.querySelector('audio, video')) return false;
    // Exclude placeholders and unrelated elements that happen to use Document.
    return Boolean(descriptor.filename || card.querySelector(NAME_SELECTOR)
      || descriptor.documentId || card.matches('[data-document-id], [data-doc-id]'));
  }

  function defaultLabel(record) {
    return /\.pdf$/i.test(record.descriptor.filename) ? 'Download PDF' : 'Download file';
  }

  function post(message) {
    window.postMessage({ channel: CHANNEL, ...message }, location.origin);
  }

  function setStatus(record, value, state = '') {
    record.status.textContent = value;
    record.row.dataset.state = state;
  }

  function resetTimer(record) {
    clearTimeout(record.timer);
    record.timer = setTimeout(() => {
      if (!record.jobId) return;
      post({ action: 'cancel', id: record.jobId });
      finish(record, 'No response for 10 minutes. Reload Telegram and try again.', 'error');
    }, IDLE_TIMEOUT);
  }

  function finish(record, message, state) {
    clearTimeout(record.timer);
    pending.delete(record.jobId);
    record.jobId = '';
    if (active === record) active = null;
    record.button.disabled = false;
    record.cancel.disabled = false;
    record.button.textContent = state === 'done' ? 'Download again' : defaultLabel(record);
    record.cancel.hidden = true;
    record.row.setAttribute('aria-busy', 'false');
    setStatus(record, message, state);
  }

  function start(record) {
    if (record.jobId) return;
    if (active) {
      setStatus(record, 'Wait for the current download, or cancel it first.', 'error');
      return;
    }
    const descriptor = descriptorOf(record.card);
    if (identityOf(descriptor) !== record.identity) {
      scheduleScan();
      return;
    }
    record.descriptor = descriptor;
    record.jobId = randomId();
    pending.set(record.jobId, record);
    active = record;
    record.button.disabled = true;
    record.button.textContent = 'Loading…';
    record.cancel.hidden = false;
    record.row.setAttribute('aria-busy', 'true');
    setStatus(record, 'Getting the document from Telegram…', 'busy');
    resetTimer(record);
    post({ action: 'download', id: record.jobId, descriptor, elementToken: record.token });
  }

  function cancel(record) {
    if (!record.jobId) return;
    post({ action: 'cancel', id: record.jobId });
    record.cancel.disabled = true;
    setStatus(record, 'Cancelling…', 'busy');
    clearTimeout(record.timer);
    record.timer = setTimeout(() => {
      finish(record, 'Cancelled.', 'cancelled');
      record.cancel.disabled = false;
    }, 5000);
  }

  function remove(record) {
    if (record.jobId) {
      post({ action: 'cancel', id: record.jobId });
      finish(record, '', '');
    }
    record.row.remove();
    if (record.card.getAttribute('data-tgdoc-token') === record.token) {
      record.card.removeAttribute('data-tgdoc-token');
    }
    records.delete(record.card);
  }

  function insertionAnchor(card) {
    // Never place our buttons inside Telegram's clickable anchor or button.
    let anchor = card;
    let enclosing = anchor.parentElement?.closest('a, button');
    while (enclosing && enclosing !== document.body) {
      anchor = enclosing;
      enclosing = anchor.parentElement?.closest('a, button');
    }
    return anchor;
  }

  function create(card, descriptor) {
    const row = document.createElement('div');
    row.className = 'tgdoc-controls';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', descriptor.filename ? `Download ${descriptor.filename}` : 'Download document');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tgdoc-download';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'tgdoc-cancel';
    cancelButton.textContent = 'Cancel';
    cancelButton.hidden = true;
    const status = document.createElement('span');
    status.className = 'tgdoc-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    row.append(button, cancelButton, status);
    const record = {
      card, row, button, cancel: cancelButton, status, descriptor,
      identity: identityOf(descriptor), token: randomId(), jobId: '', timer: 0,
    };
    card.setAttribute('data-tgdoc-token', record.token);
    button.textContent = defaultLabel(record);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      start(record);
    });
    cancelButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      cancel(record);
    });
    row.addEventListener('click', event => event.stopPropagation());
    insertionAnchor(card).insertAdjacentElement('afterend', row);
    records.set(card, record);
  }

  function scan() {
    scanTimer = 0;
    for (const record of records.values()) {
      if (!record.card.isConnected || !record.row.isConnected) {
        remove(record);
        continue;
      }
      const descriptor = descriptorOf(record.card);
      if (!isDocument(record.card, descriptor) || identityOf(descriptor) !== record.identity) {
        remove(record);
      } else {
        const anchor = insertionAnchor(record.card);
        if (record.row.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', record.row);
      }
    }
    const cards = [...document.querySelectorAll(CARD_SELECTOR)];
    for (const card of cards) {
      if (records.has(card)) continue;
      // Telegram sometimes nests .document inside .document-container.
      if (card.querySelector(CARD_SELECTOR)) continue;
      const descriptor = descriptorOf(card);
      if (isDocument(card, descriptor)) create(card, descriptor);
    }
  }

  function scheduleScan() {
    if (!scanTimer) scanTimer = setTimeout(scan, 120);
  }

  function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0) return '';
    if (value < 1024) return `${Math.round(value)} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || typeof data.id !== 'string') return;
    const record = pending.get(data.id);
    if (!record) return;
    if (data.action === 'progress') {
      resetTimer(record);
      const percent = Number(data.percent);
      const received = Number(data.received);
      const total = Number(data.total);
      const label = Number.isFinite(percent) && percent >= 0 ? `${Math.min(100, Math.floor(percent))}%` : formatBytes(received);
      record.button.textContent = label ? `Downloading ${label}` : 'Downloading…';
      setStatus(record, total > 0 ? `${formatBytes(received)} of ${formatBytes(total)}` : 'Downloading the document…', 'busy');
    } else if (data.action === 'saving') {
      resetTimer(record);
      record.button.textContent = 'Saving…';
      setStatus(record, 'Handing the file to your browser…', 'busy');
    } else if (data.action === 'done') {
      finish(record, 'Download started. Check your browser’s Downloads.', 'done');
    } else if (data.action === 'cancelled') {
      finish(record, 'Cancelled.', 'cancelled');
      record.cancel.disabled = false;
    } else if (data.action === 'error') {
      finish(record, text(data.message || data.reason || 'Could not download this document. Reload Telegram and try again.').slice(0, 500), 'error');
      record.cancel.disabled = false;
    }
  });

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => {
      const target = mutation.target.nodeType === Node.ELEMENT_NODE
        ? mutation.target : mutation.target.parentElement;
      if (target?.closest('.tgdoc-controls')) return false;
      if (mutation.type === 'childList') {
        const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
        if (nodes.length && nodes.every(node => node.nodeType === Node.ELEMENT_NODE && node.matches('.tgdoc-controls'))) return false;
      }
      return true;
    })) scheduleScan();
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['data-mid', 'data-message-id', 'data-peer-id', 'data-document-id', 'data-doc-id', 'title', 'href', 'data-url', 'data-file-name', 'data-filename'],
  });
  window.addEventListener('hashchange', scheduleScan);
  scan();
})();
