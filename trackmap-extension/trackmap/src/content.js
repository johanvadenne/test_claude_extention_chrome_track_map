// TrackMap Content Script
// Injecté dans chaque page pour détecter trackers, cookies et scripts tiers

(function () {
  'use strict';

  const pageData = {
    url: window.location.href,
    domain: window.location.hostname,
    title: document.title,
    timestamp: Date.now(),
    scripts: [],
    thirdPartyCookies: [],
    iframes: [],
    links: [],
    requestedDomains: new Set()
  };

  // --- Collecte des scripts tiers ---
  function collectScripts() {
    const scripts = document.querySelectorAll('script[src]');
    scripts.forEach(script => {
      try {
        const url = new URL(script.src);
        if (url.hostname !== window.location.hostname) {
          pageData.scripts.push({
            src: script.src,
            domain: url.hostname,
            async: script.async,
            defer: script.defer
          });
          pageData.requestedDomains.add(url.hostname);
        }
      } catch (e) {}
    });
  }

  // --- Collecte des iframes tiers ---
  function collectIframes() {
    const iframes = document.querySelectorAll('iframe[src]');
    iframes.forEach(iframe => {
      try {
        const url = new URL(iframe.src);
        if (url.hostname !== window.location.hostname) {
          pageData.iframes.push({
            src: iframe.src,
            domain: url.hostname
          });
          pageData.requestedDomains.add(url.hostname);
        }
      } catch (e) {}
    });
  }

  // --- Collecte des liens externes ---
  function collectLinks() {
    const links = document.querySelectorAll('a[href]');
    const domains = new Set();
    links.forEach(link => {
      try {
        const url = new URL(link.href);
        if (url.hostname !== window.location.hostname && !domains.has(url.hostname)) {
          domains.add(url.hostname);
          pageData.links.push({ domain: url.hostname, href: link.href });
        }
      } catch (e) {}
    });
  }

  // --- Interception des requêtes fetch/XHR ---
  function interceptRequests() {
    // Intercept fetch
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      try {
        const url = typeof args[0] === 'string' ? new URL(args[0], window.location.href) : new URL(args[0].url);
        if (url.hostname !== window.location.hostname) {
          pageData.requestedDomains.add(url.hostname);
          reportUpdate();
        }
      } catch (e) {}
      return originalFetch.apply(this, args);
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        const parsed = new URL(url, window.location.href);
        if (parsed.hostname !== window.location.hostname) {
          pageData.requestedDomains.add(parsed.hostname);
          reportUpdate();
        }
      } catch (e) {}
      return originalOpen.apply(this, arguments);
    };
  }

  // --- Détection du fingerprinting ---
  function detectFingerprinting() {
    const techniques = [];

    // Canvas fingerprinting
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      techniques.push('canvas');
      return originalGetImageData.apply(this, args);
    };

    // AudioContext fingerprinting
    if (window.AudioContext || window.webkitAudioContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const originalAC = AC;
      // Note: we just monitor, don't block
    }

    return techniques;
  }

  // --- Envoi des données au Service Worker ---
  let reportTimeout = null;
  function reportUpdate() {
    if (reportTimeout) clearTimeout(reportTimeout);
    reportTimeout = setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'PAGE_DATA',
        data: {
          url: pageData.url,
          domain: pageData.domain,
          title: document.title || pageData.domain,
          timestamp: Date.now(),
          scripts: pageData.scripts,
          iframes: pageData.iframes,
          requestedDomains: Array.from(pageData.requestedDomains),
          linksCount: pageData.links.length
        }
      }).catch(() => {});
    }, 500);
  }

  // --- Observation des mutations DOM (scripts chargés dynamiquement) ---
  const observer = new MutationObserver((mutations) => {
    let updated = false;
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.tagName === 'SCRIPT' && node.src) {
          try {
            const url = new URL(node.src);
            if (url.hostname !== window.location.hostname) {
              pageData.scripts.push({ src: node.src, domain: url.hostname });
              pageData.requestedDomains.add(url.hostname);
              updated = true;
            }
          } catch (e) {}
        }
        if (node.tagName === 'IFRAME' && node.src) {
          try {
            const url = new URL(node.src);
            if (url.hostname !== window.location.hostname) {
              pageData.iframes.push({ src: node.src, domain: url.hostname });
              pageData.requestedDomains.add(url.hostname);
              updated = true;
            }
          } catch (e) {}
        }
      });
    });
    if (updated) reportUpdate();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // --- Initialisation ---
  function init() {
    interceptRequests();
    collectScripts();
    collectIframes();
    collectLinks();
    reportUpdate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-scan after full load
  window.addEventListener('load', () => {
    collectScripts();
    collectIframes();
    reportUpdate();
  });

})();
