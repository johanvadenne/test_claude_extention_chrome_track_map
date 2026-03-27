// TrackMap Content Script v3
// Guard non-web + sans monkey-patching + PING/RESCAN

(function () {
  'use strict';

  // ── Guard pages non-web ──
  const proto = window.location.protocol;
  if (
    proto === 'chrome:'          ||
    proto === 'chrome-extension:' ||
    proto === 'file:'            ||
    proto === 'about:'           ||
    proto === 'data:'            ||
    proto === 'javascript:'      ||
    proto === 'blob:'            ||
    document.contentType === 'application/pdf' ||
    !window.location.hostname
  ) { return; }

  // ── Singleton guard ──
  if (window.__trackMapInitialized) return;
  window.__trackMapInitialized = true;

  const pageDomain = window.location.hostname.replace(/^www\./, '');
  const state = { scripts: [], iframes: [], seen: new Set() };

  // ── Helpers ──

  function isThirdParty(h) {
    if (!h) return false;
    const c = h.replace(/^www\./, '');
    return c !== pageDomain && !c.endsWith('.' + pageDomain);
  }

  function collectScripts() {
    document.querySelectorAll('script[src]').forEach(s => {
      try {
        const u = new URL(s.src);
        if (isThirdParty(u.hostname) && !state.seen.has(u.hostname)) {
          state.scripts.push({ src: s.src, domain: u.hostname });
          state.seen.add(u.hostname);
        }
      } catch(_) {}
    });
  }

  function collectIframes() {
    document.querySelectorAll('iframe[src]').forEach(f => {
      try {
        const u = new URL(f.src);
        if (isThirdParty(u.hostname) && !state.seen.has(u.hostname)) {
          state.iframes.push({ src: f.src, domain: u.hostname });
          state.seen.add(u.hostname);
        }
      } catch(_) {}
    });
  }

  // Note : fetch/XHR ne sont plus interceptés ici.
  // Le background.js utilise chrome.webRequest.onCompleted pour capter
  // toutes les requêtes réseau de façon fiable sans monkey-patching.

  // ── MutationObserver : scripts/iframes injectés dynamiquement ──

  const observer = new MutationObserver(mutations => {
    let changed = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'SCRIPT' && node.src) {
          try {
            const u = new URL(node.src);
            if (isThirdParty(u.hostname) && !state.seen.has(u.hostname)) {
              state.scripts.push({ src: node.src, domain: u.hostname });
              state.seen.add(u.hostname);
              changed = true;
            }
          } catch(_) {}
        }
        if (node.tagName === 'IFRAME' && node.src) {
          try {
            const u = new URL(node.src);
            if (isThirdParty(u.hostname) && !state.seen.has(u.hostname)) {
              state.iframes.push({ src: node.src, domain: u.hostname });
              state.seen.add(u.hostname);
              changed = true;
            }
          } catch(_) {}
        }
      }
    }
    if (changed) scheduleReport();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ── Envoi debounced ──

  let reportTimer = null;
  function scheduleReport() {
    if (reportTimer) clearTimeout(reportTimer);
    reportTimer = setTimeout(sendReport, 400);
  }

  function sendReport() {
    chrome.runtime.sendMessage({
      type: 'PAGE_DATA',
      data: {
        url:             window.location.href,
        domain:          pageDomain,
        title:           document.title || pageDomain,
        timestamp:       Date.now(),
        scripts:         state.scripts,
        iframes:         state.iframes,
        requestedDomains: [] // complété par webRequest dans background.js
      }
    }).catch(() => {});
  }

  // ── Protocole PING / RESCAN ──
  // Le popup envoie PING → si ce script répond PONG, il est vivant.
  // Le popup envoie ensuite RESCAN au lieu de ré-injecter le script.

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ type: 'PONG', domain: pageDomain });
      return false;
    }
    if (msg.type === 'RESCAN') {
      state.scripts = []; state.iframes = []; state.seen.clear();
      collectScripts();
      collectIframes();
      sendReport();
      sendResponse({ type: 'RESCAN_OK' });
      return false;
    }
  });

  // ── Init ──

  function init() { collectScripts(); collectIframes(); scheduleReport(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('load', () => { collectScripts(); collectIframes(); scheduleReport(); }, { once: true });

})();
