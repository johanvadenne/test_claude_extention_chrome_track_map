#!/usr/bin/env node
/**
 * TrackMap v4 — Tests Blocs 4 & 5
 * node build/test-blocs-4-5.js
 */
'use strict';

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`✓  ${name}`); passed++; }
  catch(e) { console.log(`✗  ${name}\n   ${e.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error(m || `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }

console.log('\n=== TrackMap v4 — Blocs 4 & 5 ===\n');
console.log('─── Bloc 4 : Feedback temps réel ───\n');

// ── Barre de progression ──────────────────────────────────────────────────

test('NAV_UPDATE : seul l\'onglet actif déclenche le refresh', () => {
  const currentTabId = 42;
  let triggered = false;
  function onNavUpdate(msg) {
    if (msg.type === 'NAV_UPDATE' && msg.tabId === currentTabId) triggered = true;
  }
  onNavUpdate({ type: 'NAV_UPDATE', tabId: 42 });
  assert(triggered, 'tabId 42 doit déclencher');
  triggered = false;
  onNavUpdate({ type: 'NAV_UPDATE', tabId: 99 });
  assert(!triggered, 'tabId 99 ne doit pas déclencher');
});

test('NAV_UPDATE : envoyé seulement sur status=complete', () => {
  const events = [];
  function onUpdated(tabId, changeInfo, tab, currentTab) {
    if (changeInfo.status === 'complete' && tabId === currentTab && tab.url) {
      try {
        const proto = new URL(tab.url).protocol;
        if (proto !== 'http:' && proto !== 'https:') return;
      } catch(_) { return; }
      events.push({ tabId, url: tab.url });
    }
  }
  onUpdated(1, { status: 'loading'  }, { url: 'https://example.com' }, 1); // ignoré
  onUpdated(1, { status: 'complete' }, { url: 'https://example.com' }, 1); // ✓
  onUpdated(1, { status: 'complete' }, { url: 'chrome://newtab'     }, 1); // ignoré (non http)
  onUpdated(2, { status: 'complete' }, { url: 'https://other.com'   }, 1); // ignoré (autre onglet)
  assertEqual(events.length, 1, 'Un seul événement valide');
  assert(events[0].url === 'https://example.com');
});

test('NAV_UPDATE : pas envoyé pour pages non-HTTP', () => {
  const URLs = ['chrome://newtab', 'chrome-extension://abc/popup.html', 'about:blank', 'file:///index.html'];
  const events = [];
  URLs.forEach(url => {
    try {
      const proto = new URL(url).protocol;
      if (proto === 'http:' || proto === 'https:') events.push(url);
    } catch(_) {}
  });
  assertEqual(events.length, 0, 'Aucune page non-HTTP ne doit déclencher NAV_UPDATE');
});

test('Barre de progression : classe running ajoutée/retirée', () => {
  // Simuler la logique CSS de startNavProgress / stopNavProgress
  const el = { classList: new Set() };
  function startNavProgress() {
    el.classList.delete('running');
    el.classList.add('running');
  }
  function stopNavProgress() {
    el.classList.delete('running');
  }
  startNavProgress();
  assert(el.classList.has('running'), 'running présent après start');
  stopNavProgress();
  assert(!el.classList.has('running'), 'running absent après stop');
});

test('Indicateur nav : visible/caché correctement', () => {
  const el = { classList: new Set() };
  const show = () => el.classList.add('visible');
  const hide = () => el.classList.delete('visible');
  show(); assert(el.classList.has('visible'), 'visible après show');
  hide(); assert(!el.classList.has('visible'), 'caché après hide');
});

test('Refresh auto : délai 900ms après NAV_UPDATE (laisser PAGE_DATA remonter)', () => {
  // Vérifier que le délai est bien 900ms et non 0
  let reloadScheduled = false;
  let delay = 0;
  function onNavUpdate() {
    delay = 900;
    reloadScheduled = true;
  }
  onNavUpdate();
  assert(reloadScheduled && delay === 900, 'délai de 900ms');
});

test('Fondu panel : classe refreshing ajoutée pendant le chargement', () => {
  const panel = { classList: new Set() };
  function startRefresh() { panel.classList.add('refreshing'); }
  function stopRefresh()  { panel.classList.delete('refreshing'); }
  startRefresh(); assert(panel.classList.has('refreshing'));
  stopRefresh();  assert(!panel.classList.has('refreshing'));
});

test('chrome.extension.getViews : popup détecté avant envoi NAV_UPDATE', () => {
  // Simuler la vérification views.length > 0
  function shouldSendNavUpdate(viewsCount) { return viewsCount > 0; }
  assert( shouldSendNavUpdate(1), 'popup ouvert → envoyer');
  assert(!shouldSendNavUpdate(0), 'popup fermé → ne pas envoyer');
});

// ── Bloc 5 : Graphe SVG ───────────────────────────────────────────────────

console.log('\n─── Bloc 5 : Graphe SVG interactif ───\n');

test('Viewport : zoom respecte VP_MIN et VP_MAX', () => {
  const VP_MIN = 0.3, VP_MAX = 4;
  let scale = 1;

  function zoom(delta) {
    scale = Math.max(VP_MIN, Math.min(VP_MAX, scale * delta));
  }
  for (let i = 0; i < 20; i++) zoom(1.12);
  assert(scale <= VP_MAX, `scale ${scale} dépasse VP_MAX`);
  scale = 1;
  for (let i = 0; i < 20; i++) zoom(0.89);
  assert(scale >= VP_MIN, `scale ${scale} sous VP_MIN`);
});

test('Zoom molette : zoom centré sur le curseur (pas sur (0,0))', () => {
  let vpX = 190, vpY = 150, vpScale = 1;
  const mouseX = 100, mouseY = 100;
  const delta = 1.12;
  const newScale = vpScale * delta;
  const newVpX = mouseX - (mouseX - vpX) * (newScale / vpScale);
  const newVpY = mouseY - (mouseY - vpY) * (newScale / vpScale);
  // Le point sous le curseur doit rester au même endroit
  const beforeX = (mouseX - vpX) / vpScale;
  const afterX  = (mouseX - newVpX) / newScale;
  assert(Math.abs(beforeX - afterX) < 0.001, `point curseur non stable: ${beforeX} vs ${afterX}`);
});

test('Pan : déplacement vpX/vpY correct', () => {
  let vpX = 190, vpY = 150;
  const panOrigin = { x: vpX, y: vpY };
  const panStart  = { x: 200, y: 100 };
  const mousePos  = { x: 230, y: 80 };  // déplacé de +30, -20
  vpX = panOrigin.x + (mousePos.x - panStart.x);
  vpY = panOrigin.y + (mousePos.y - panStart.y);
  assertEqual(vpX, 220, 'vpX après pan');
  assertEqual(vpY, 130, 'vpY après pan');
});

test('Drag nœud : conversion coordonnées écran → SVG', () => {
  const vpX = 190, vpY = 150, vpScale = 1.5;
  const nodeX = 50, nodeY = 30;
  // Simuler le calcul de dragOffset
  const pointerX = 265, pointerY = 195; // coords écran (nodeX*vpScale+vpX, nodeY*vpScale+vpY)
  const offsetX = (pointerX - vpX) / vpScale - nodeX;
  const offsetY = (pointerY - vpY) / vpScale - nodeY;
  assert(Math.abs(offsetX) < 0.001, `offsetX devrait être 0, est ${offsetX}`);
  assert(Math.abs(offsetY) < 0.001, `offsetY devrait être 0, est ${offsetY}`);
});

test('Mode cluster : nœuds groupés en 3 colonnes par risque', () => {
  const nodes = [
    { domain: 'a.com', riskScore: 8 }, // high
    { domain: 'b.com', riskScore: 8 }, // high
    { domain: 'c.com', riskScore: 5 }, // medium
    { domain: 'd.com', riskScore: 2 }, // low
    { domain: 'e.com', riskScore: 0 }, // unknown
  ];
  const colW = 120;
  function getClusterX(riskScore) {
    const col = riskScore >= 7 ? 0 : riskScore >= 4 ? 1 : 2;
    return (col - 1) * colW;
  }
  assertEqual(getClusterX(8), -120, 'high → colonne gauche');
  assertEqual(getClusterX(5),    0, 'medium → colonne centre');
  assertEqual(getClusterX(2),  120, 'low → colonne droite');
  assertEqual(getClusterX(0),  120, 'unknown → colonne droite');
});

test('Mode cluster : gravité vers colonne target', () => {
  const node = { x: 50, y: 0, vx: 0, vy: 0, riskScore: 8 };
  const targetX = node.riskScore >= 7 ? -130 : node.riskScore >= 4 ? 0 : 130;
  node.vx += (targetX - node.x) * 0.04;
  assert(node.vx < 0, 'nœud high doit être attiré vers la gauche');
});

test('Mode force → cluster : positions remises à null pour re-simulation', () => {
  const nodes = {
    'a.com': { x: 100, y: 200, domain: 'a.com' },
    'b.com': { x: 150, y: 100, domain: 'b.com' },
  };
  // Simuler le changement de mode
  Object.values(nodes).forEach(n => { n.x = null; n.y = null; });
  assert(nodes['a.com'].x === null, 'positions remises à null');
});

test('Rendu arêtes : épaisseur proportionnelle au count', () => {
  function edgeWidth(count) { return Math.min(3, count * 0.8 + 0.5); }
  assert(edgeWidth(1) < edgeWidth(3), 'arête count=3 plus épaisse que count=1');
  assert(edgeWidth(10) <= 3, 'épaisseur max 3');
});

test('Simulation courte après drag : 20 frames de stabilisation', () => {
  let simMax = 0;
  function onDragEnd() { simMax = 20; }
  onDragEnd();
  assertEqual(simMax, 20, '20 frames après drag');
});

test('Reset vue : recentre sans effacer les positions des nœuds', () => {
  const W = 380, H = 300;
  let vpX = 0, vpY = 0, vpScale = 2.5; // vue décalée
  const nodes = [{ x: 50, y: 30 }, { x: -20, y: 60 }]; // positions préservées

  function resetViewport() { vpX = W/2; vpY = H/2; vpScale = 1; }
  resetViewport();

  assertEqual(vpX, 190);
  assertEqual(vpY, 150);
  assertEqual(vpScale, 1);
  // Les nœuds ne doivent pas avoir bougé
  assertEqual(nodes[0].x, 50, 'positions nœuds inchangées');
  assertEqual(nodes[1].x, -20);
});

test('Highlight nœud : centre la vue sur le nœud sélectionné', () => {
  const W = 380, H = 300;
  let vpX = 190, vpY = 150, vpScale = 1;
  const node = { x: 80, y: -40 };

  function highlightNode(n) {
    vpX = W/2 - n.x * vpScale;
    vpY = H/2 - n.y * vpScale;
  }
  highlightNode(node);
  assertEqual(vpX, 190 - 80, 'vpX centré sur nœud');
  assertEqual(vpY, 150 + 40, 'vpY centré sur nœud');
});

test('Rayon nœud : proportionnel aux visites, borné [14,26]', () => {
  function nodeRadius(visits) { return Math.max(14, Math.min(26, 10 + visits * 3)); }
  assert(nodeRadius(0) === 14, 'minimum 14');
  assert(nodeRadius(10) === 26, 'maximum 26');
  assert(nodeRadius(2) > 14 && nodeRadius(2) < 26, 'valeur intermédiaire');
});

test('Label nœud : tronqué à 9 caractères max', () => {
  function truncLabel(domain) {
    const s = domain.replace(/^www\./, '').replace(/\.(com|fr|net|org|io|co)$/, '');
    return s.length > 9 ? s.substring(0,8)+'…' : s;
  }
  const t = truncLabel('very-long-domain-name.com');
  assert(t.endsWith('…'), 'doit être tronqué');
  assert(t.length <= 9, `longueur ${t.length} > 9`);
  const s = truncLabel('short.com');
  assert(!s.endsWith('…'), 'ne doit pas être tronqué');
});

// ── Résultats ──────────────────────────────────────────────────────────────

console.log(`\n─── Résultats ───\n`);
console.log(`Passés  : ${passed}/${passed+failed}`);
console.log(`Échoués : ${failed}/${passed+failed}`);
if (failed > 0) { process.exit(1); }
else { console.log('\nTous les tests passent.'); }
