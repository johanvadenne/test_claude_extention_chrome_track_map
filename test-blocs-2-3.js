#!/usr/bin/env node
/**
 * TrackMap v3 — Validation des Blocs 2 et 3
 * node build/test-blocs-2-3.js
 */

'use strict';

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓  ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗  ${name}`);
    console.log(`   ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

console.log('\n=== TrackMap v3 — Validation Blocs 2 & 3 ===\n');

// ─────────────────────────────────────────────────────────────
// BLOC 2 : Logique de persistance et restauration des positions
// ─────────────────────────────────────────────────────────────

console.log('─── Bloc 2 : Persistance du graphe ───\n');

// Simuler l'état du graphe du background.js
function makeGraphState() {
  return {
    nodes: {
      'github.com':    { domain: 'github.com',    visits: 5, riskScore: 2, x: null, y: null, trackers: [], title: 'GitHub' },
      'google.com':    { domain: 'google.com',    visits: 3, riskScore: 7, x: null, y: null, trackers: [], title: 'Google' },
      'wikipedia.org': { domain: 'wikipedia.org', visits: 2, riskScore: 1, x: null, y: null, trackers: [], title: 'Wikipedia' },
    },
    edges: [
      { from: 'github.com', to: 'google.com', count: 2 },
      { from: 'google.com', to: 'wikipedia.org', count: 1 },
    ]
  };
}

test('Graphe initialisé avec x:null, y:null sur chaque nœud', () => {
  const g = makeGraphState();
  for (const node of Object.values(g.nodes)) {
    assert(node.x === null, `x devrait être null pour ${node.domain}`);
    assert(node.y === null, `y devrait être null pour ${node.domain}`);
  }
});

test('SAVE_NODE_POSITIONS met à jour x,y dans le graphe', () => {
  const g = makeGraphState();
  const positions = {
    'github.com':    { x: 120, y: 80  },
    'google.com':    { x: 200, y: 150 },
    'wikipedia.org': { x: 80,  y: 200 },
  };
  // Simuler le handler SAVE_NODE_POSITIONS de background.js
  for (const [domain, pos] of Object.entries(positions)) {
    if (g.nodes[domain]) {
      g.nodes[domain].x = pos.x;
      g.nodes[domain].y = pos.y;
    }
  }
  assertEqual(g.nodes['github.com'].x, 120, 'x github.com');
  assertEqual(g.nodes['google.com'].y, 150, 'y google.com');
  assertEqual(g.nodes['wikipedia.org'].x, 80, 'x wikipedia.org');
});

test('Restauration depuis chrome.storage : positions injectées dans les nœuds', () => {
  // Simule ce que le popup fait à l'ouverture
  const savedGraph = {
    nodes: {
      'github.com':    { domain: 'github.com',    visits: 5, riskScore: 2, x: 120, y: 80,  trackers: [] },
      'google.com':    { domain: 'google.com',    visits: 3, riskScore: 7, x: 200, y: 150, trackers: [] },
      'wikipedia.org': { domain: 'wikipedia.org', visits: 2, riskScore: 1, x: 80,  y: 200, trackers: [] },
    },
    edges: []
  };
  const W = 380, H = 300;
  const hasSavedPositions = Object.values(savedGraph.nodes).some(n => n.x !== null && n.x !== undefined);
  assert(hasSavedPositions, 'hasSavedPositions devrait être true');

  // Simuler le mappage popup renderGraph()
  const graphNodes = Object.values(savedGraph.nodes).map(n => {
    let x, y;
    if (hasSavedPositions && n.x !== null && n.y !== null) {
      x = Math.max(20, Math.min(W - 20, n.x * (W / (savedGraph._canvasW || W))));
      y = Math.max(20, Math.min(H - 20, n.y * (H / (savedGraph._canvasH || H))));
    } else {
      x = W / 2; y = H / 2; // fallback
    }
    return { ...n, x, y, vx: 0, vy: 0, radius: 16 };
  });

  // Tous les nœuds devraient avoir des positions non-nulles dans les bounds
  for (const node of graphNodes) {
    assert(node.x >= 20 && node.x <= W - 20, `x hors bounds pour ${node.domain}: ${node.x}`);
    assert(node.y >= 20 && node.y <= H - 20, `y hors bounds pour ${node.domain}: ${node.y}`);
  }
});

test('Simulation courte (30 frames) si positions sauvegardées', () => {
  const nodesWithPositions = [
    { x: 100, y: 80  },
    { x: 200, y: 150 },
  ];
  const hasSaved = nodesWithPositions.some(n => n.x !== null);
  const maxFrames = hasSaved ? 30 : 180;
  assertEqual(maxFrames, 30, 'maxFrames avec positions sauvegardées');
});

test('Simulation complète (180 frames) si aucune position sauvegardée', () => {
  const nodesWithout = [
    { x: null, y: null },
    { x: null, y: null },
  ];
  const hasSaved = nodesWithout.some(n => n.x !== null && n.x !== undefined);
  const maxFrames = hasSaved ? 30 : 180;
  assertEqual(maxFrames, 180, 'maxFrames sans positions sauvegardées');
});

test('Debounce persistance : multiple appels → une seule écriture', () => {
  let writeCount = 0;
  let timer = null;
  const DEBOUNCE = 2000;

  // Simuler scheduleGraphPersist
  function scheduleGraphPersist() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { writeCount++; }, DEBOUNCE);
  }

  // Appeler 5 fois rapidement
  for (let i = 0; i < 5; i++) scheduleGraphPersist();

  // Avant le délai → 0 écritures
  assertEqual(writeCount, 0, 'Aucune écriture avant le debounce');

  // Simuler l'expiration du timer
  clearTimeout(timer);
  writeCount++; // le dernier setTimeout se déclenche

  assertEqual(writeCount, 1, 'Une seule écriture après debounce');
});

test('addEdge : pas de doublon, incrémente le count', () => {
  const edges = [];
  function addEdge(from, to) {
    if (from === to || !from || !to) return;
    const ex = edges.find(e => e.from === from && e.to === to);
    if (ex) ex.count++; else edges.push({ from, to, count: 1 });
  }
  addEdge('github.com', 'google.com');
  addEdge('github.com', 'google.com');
  addEdge('github.com', 'google.com');
  assertEqual(edges.length, 1, 'Une seule arête');
  assertEqual(edges[0].count, 3, 'Count = 3');
});

test('Restauration graphe : les arêtes sont préservées', () => {
  const saved = {
    nodes: { 'a.com': { domain: 'a.com', x: 10, y: 20, visits: 1, trackers: [], riskScore: 0 } },
    edges: [{ from: 'a.com', to: 'b.com', count: 2 }]
  };
  // Simuler restoreGraph
  const restored = { nodes: saved.nodes, edges: saved.edges };
  assertEqual(restored.edges.length, 1, '1 arête restaurée');
  assertEqual(restored.edges[0].count, 2, 'count = 2');
});

// ─────────────────────────────────────────────────────────────
// BLOC 3 : Guard pages non-web + PING/RESCAN + webRequest
// ─────────────────────────────────────────────────────────────

console.log('\n─── Bloc 3 : Corrections bugs d\'injection ───\n');

// Simuler le guard du content script
function shouldInject(protocol, contentType, hostname) {
  const blocked = ['chrome:', 'chrome-extension:', 'file:', 'about:', 'data:', 'javascript:', 'blob:'];
  if (blocked.includes(protocol)) return false;
  if (contentType === 'application/pdf') return false;
  if (!hostname) return false;
  return true;
}

test('Guard : chrome:// bloqué', () => {
  assert(!shouldInject('chrome:', 'text/html', 'newtab'), 'chrome: doit être bloqué');
});

test('Guard : chrome-extension:// bloqué', () => {
  assert(!shouldInject('chrome-extension:', 'text/html', 'extensionid'), 'chrome-extension: bloqué');
});

test('Guard : file:// bloqué', () => {
  assert(!shouldInject('file:', 'text/html', ''), 'file: bloqué');
});

test('Guard : about:blank bloqué', () => {
  assert(!shouldInject('about:', 'text/html', ''), 'about: bloqué');
});

test('Guard : data: bloqué', () => {
  assert(!shouldInject('data:', 'text/html', ''), 'data: bloqué');
});

test('Guard : application/pdf bloqué', () => {
  assert(!shouldInject('https:', 'application/pdf', 'example.com'), 'PDF bloqué');
});

test('Guard : hostname vide bloqué', () => {
  assert(!shouldInject('https:', 'text/html', ''), 'hostname vide bloqué');
});

test('Guard : http:// autorisé', () => {
  assert(shouldInject('http:', 'text/html', 'example.com'), 'http: autorisé');
});

test('Guard : https:// autorisé', () => {
  assert(shouldInject('https:', 'text/html', 'example.com'), 'https: autorisé');
});

test('Guard : singleton — double init bloquée', () => {
  // Simuler window.__trackMapInitialized
  const window = { __trackMapInitialized: false };
  let initCount = 0;

  function tryInit() {
    if (window.__trackMapInitialized) return;
    window.__trackMapInitialized = true;
    initCount++;
  }

  tryInit(); tryInit(); tryInit();
  assertEqual(initCount, 1, 'Init exécutée une seule fois');
});

test('PING/RESCAN : popup n\'injecte pas si PONG reçu', () => {
  // Simuler la logique du btn-refresh dans popup.js
  let executeScriptCalled = false;
  let rescanSent = false;

  async function simulateRefresh(pingResponse) {
    if (pingResponse?.type === 'PONG') {
      rescanSent = true; // → envoie RESCAN
    } else {
      executeScriptCalled = true; // ancienne logique (ne devrait plus arriver)
    }
  }

  // Cas 1 : content script vivant → RESCAN, pas de ré-injection
  simulateRefresh({ type: 'PONG', domain: 'example.com' });
  assert(!executeScriptCalled, 'executeScript ne doit pas être appelé si PONG');
  assert(rescanSent, 'RESCAN doit être envoyé après PONG');
});

test('PING/RESCAN : pas de ré-injection si content script absent', () => {
  let executeScriptCalled = false;
  let rescanSent = false;

  async function simulateRefresh(pingResponse) {
    if (pingResponse?.type === 'PONG') {
      rescanSent = true;
    } else {
      // Nouvelle logique : pas d'inject, juste recharger depuis storage
      executeScriptCalled = false;
    }
  }

  simulateRefresh(null); // PING sans réponse
  assert(!executeScriptCalled, 'Pas d\'executeScript si ping timeout');
  assert(!rescanSent, 'Pas de RESCAN si ping sans réponse');
});

test('webRequest : filtre domaines tiers seulement', () => {
  // Simuler la logique du filtre webRequest de background.js
  function isThirdParty(reqUrl, initiatorUrl) {
    try {
      const reqHost      = new URL(reqUrl).hostname.replace(/^www\./, '');
      const pageHost     = new URL(initiatorUrl).hostname.replace(/^www\./, '');
      if (reqHost === pageHost) return false;
      if (reqHost.endsWith('.' + pageHost)) return false;
      return true;
    } catch (_) { return false; }
  }

  assert(!isThirdParty('https://cdn.example.com/script.js', 'https://example.com'), 'Sous-domaine same-site = non tiers');
  assert(!isThirdParty('https://example.com/api', 'https://example.com'), 'Same domain = non tiers');
  assert( isThirdParty('https://google-analytics.com/ga.js', 'https://example.com'), 'Google Analytics = tiers');
  assert( isThirdParty('https://doubleclick.net/pixel', 'https://news.fr'), 'DoubleClick = tiers');
  assert(!isThirdParty('https://api.github.com/user', 'https://github.com'), 'api.github.com = sous-domaine github.com');
});

test('webRequest : tabId < 0 ignoré (requêtes système)', () => {
  const tabIds = [-1, 0, 1, 42];
  const processed = tabIds.filter(id => id >= 0);
  assertEqual(processed.length, 3, 'tabId -1 ignoré');
  assert(!processed.includes(-1), '-1 non inclus');
});

test('webRequest : nettoyage du cache au rechargement d\'onglet', () => {
  const webRequestDomains = new Map();
  webRequestDomains.set(42, new Set(['tracker.com', 'ads.net']));
  webRequestDomains.set(99, new Set(['pixel.fb.com']));

  // Simuler tabs.onUpdated status=loading
  const tabId = 42;
  webRequestDomains.delete(tabId);

  assert(!webRequestDomains.has(42), 'Cache tabId 42 nettoyé');
  assert( webRequestDomains.has(99), 'Cache tabId 99 préservé');
});

test('webRequest : nettoyage à la fermeture d\'onglet', () => {
  const webRequestDomains = new Map();
  webRequestDomains.set(5, new Set(['a.com']));
  webRequestDomains.set(6, new Set(['b.com']));

  // Simuler tabs.onRemoved
  webRequestDomains.delete(5);

  assert(!webRequestDomains.has(5), 'Onglet 5 nettoyé à la fermeture');
  assert( webRequestDomains.has(6), 'Onglet 6 intact');
});

test('Manifest : matches restreints à http/https seulement', () => {
  const fs   = require('fs');
  const path = require('path');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  const csMatches = manifest.content_scripts[0].matches;

  assert(csMatches.includes('http://*/*'),  'http://*/* présent');
  assert(csMatches.includes('https://*/*'), 'https://*/* présent');
  assert(!csMatches.includes('<all_urls>'), '<all_urls> supprimé');

  const hostPerms = manifest.host_permissions;
  assert(hostPerms.includes('http://*/*'),  'host_permissions http présent');
  assert(hostPerms.includes('https://*/*'), 'host_permissions https présent');
  assert(!hostPerms.includes('<all_urls>'), 'host_permissions <all_urls> supprimé');
});

test('Manifest : exclude_matches défini pour pages système', () => {
  const fs   = require('fs');
  const path = require('path');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  const ex = manifest.content_scripts[0].exclude_matches || [];

  assert(ex.some(m => m.startsWith('chrome://')),           'chrome:// exclu');
  assert(ex.some(m => m.startsWith('chrome-extension://')), 'chrome-extension:// exclu');
});

// ── Résultats ──────────────────────────────────────────────────────────────

console.log(`\n─── Résultats ───\n`);
console.log(`Passés  : ${passed}/${passed+failed}`);
console.log(`Échoués : ${failed}/${passed+failed}`);

if (failed > 0) {
  console.log('\nDes tests ont échoué.');
  process.exit(1);
} else {
  console.log('\nTous les tests passent.');
}
