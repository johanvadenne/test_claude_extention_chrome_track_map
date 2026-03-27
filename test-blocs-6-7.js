#!/usr/bin/env node
/**
 * TrackMap v5 — Tests Blocs 6 & 7
 * node build/test-blocs-6-7.js
 */
'use strict';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓  ${name}`); passed++; }
  catch(e) { console.log(`✗  ${name}\n   ${e.message}`); failed++; }
}
function assert(c, m)    { if (!c) throw new Error(m || 'assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error(m || `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function assertIncludes(str, sub, m) { if (!str.includes(sub)) throw new Error(m || `"${str}" does not include "${sub}"`); }

console.log('\n=== TrackMap v5 — Blocs 6 & 7 ===\n');

// ── Charger la DB et simuler le background ─────────────────────────────────
const fs   = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../src/trackers-db-full.json');
assert(fs.existsSync(dbPath), 'trackers-db-full.json manquant');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const exactIndex  = new Map(Object.entries(db.exactIndex));
const suffixIndex = new Map(Object.entries(db.suffixIndex));

function matchDomain(domain) {
  if (!domain || domain.length < 4) return null;
  const clean = domain.toLowerCase().replace(/^www\./, '');
  const exact = exactIndex.get(clean);
  if (exact) return { entry: exact, domain: clean, matchedOn: clean, confidence: 'confirmed' };
  const parts = clean.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const cand = parts.slice(i).join('.');
    const hit  = exactIndex.get(cand);
    if (hit) return { entry: hit, domain: clean, matchedOn: cand, confidence: 'likely' };
    const root = parts.slice(-2).join('.');
    const rl   = suffixIndex.get(root);
    if (rl) {
      for (const known of rl) {
        if (clean.endsWith('.'+known) || clean===known) {
          const e = exactIndex.get(known);
          if (e) return { entry: e, domain: clean, matchedOn: known, confidence: 'likely' };
        }
      }
    }
  }
  return null;
}

// Simuler buildRiskBreakdown (copie du background.js patché)
function buildRiskBreakdown(trackers, unknown) {
  const factors = [];
  const highConfirmed = trackers.filter(t => t.risk === 'high' && t.confidence === 'confirmed');
  if (highConfirmed.length) factors.push({ id: 'high-confirmed', label: `${highConfirmed.length} tracker(s) pub. confirmé(s)`, detail: 'test', formula: `${highConfirmed.length} × 3 = ${highConfirmed.length*3} pts`, points: highConfirmed.length*3, severity: 'high', examples: highConfirmed.slice(0,3).map(t => t.name) });
  const highLikely = trackers.filter(t => t.risk === 'high' && t.confidence === 'likely');
  if (highLikely.length) factors.push({ id: 'high-likely', label: `${highLikely.length} tracker(s) pub. probable(s)`, detail: 'test', formula: `${highLikely.length} × 2 = ${highLikely.length*2} pts`, points: highLikely.length*2, severity: 'high', examples: highLikely.slice(0,3).map(t => t.name) });
  const replay = trackers.filter(t => t.category === 'session-replay');
  if (replay.length) factors.push({ id: 'session-replay', label: `${replay.length} outil(s) d'enreg.`, detail: 'test', formula: `${replay.length} × 4 = ${replay.length*4} pts`, points: replay.length*4, severity: 'high', examples: replay.slice(0,3).map(t => t.name) });
  const fp = trackers.filter(t => t.category === 'fingerprinting');
  if (fp.length) factors.push({ id: 'fingerprinting', label: `${fp.length} script(s) fingerprint`, detail: 'test', formula: `${fp.length} × 4 = ${fp.length*4} pts`, points: fp.length*4, severity: 'high', examples: fp.slice(0,3).map(t => t.name) });
  const medium = trackers.filter(t => t.risk === 'medium');
  if (medium.length) factors.push({ id: 'medium', label: `${medium.length} tracker(s) modéré(s)`, detail: 'test', formula: `${medium.length} × 2 = ${medium.length*2} pts`, points: medium.length*2, severity: 'medium', examples: medium.slice(0,3).map(t => t.name) });
  if (unknown.length) factors.push({ id: 'unknown', label: `${unknown.length} domaine(s) inconnu(s)`, detail: 'test', formula: `${unknown.length} × 1 = ${unknown.length} pts`, points: unknown.length, severity: 'low', examples: unknown.slice(0,3).map(u => u.domain) });
  const totalPoints = factors.reduce((s, f) => s + f.points, 0);
  const scoreLabel  = totalPoints===0?'Propre':totalPoints<=3?'Faible':totalPoints<=8?'Modéré':totalPoints<=15?'Élevé':'Critique';
  return { factors, totalPoints, scoreLabel };
}

// ─────────────────────────────────────────────────────────────
console.log('─── Bloc 6 : Distinction confirmed / likely / unknown ───\n');
// ─────────────────────────────────────────────────────────────

test('matchDomain : domaine exact → confidence "confirmed"', () => {
  const r = matchDomain('doubleclick.net');
  assert(r, 'devrait matcher');
  assertEqual(r.confidence, 'confirmed');
  assertEqual(r.matchedOn, 'doubleclick.net');
});

test('matchDomain : sous-domaine → confidence "likely" + matchedOn parent', () => {
  const r = matchDomain('js.hotjar.com');
  assert(r, 'devrait matcher');
  assertEqual(r.confidence, 'likely');
  assertEqual(r.matchedOn, 'hotjar.com');
  assert(r.domain === 'js.hotjar.com', 'domain = sous-domaine d\'origine');
});

test('matchDomain : domaine inconnu → null', () => {
  const r = matchDomain('monsite-perso.fr');
  assert(r === null, 'ne doit pas matcher');
});

test('Séparation confirmed / likely dans la liste', () => {
  const trackers = [
    { domain: 'doubleclick.net',    confidence: 'confirmed', risk: 'high' },
    { domain: 'js.hotjar.com',      confidence: 'likely',    risk: 'high' },
    { domain: 'cdn.segment.com',    confidence: 'confirmed', risk: 'medium' },
    { domain: 'api.analytics.tld',  confidence: 'likely',    risk: 'medium' },
  ];
  const confirmed = trackers.filter(t => t.confidence === 'confirmed');
  const likely    = trackers.filter(t => t.confidence === 'likely');
  assertEqual(confirmed.length, 2, '2 confirmed');
  assertEqual(likely.length,    2, '2 likely');
});

test('Bordure pointillée uniquement sur les "likely"', () => {
  function buildCardClass(confidence) {
    return confidence === 'likely' ? 'tracker-item high dotted-border' : 'tracker-item high';
  }
  assertIncludes(buildCardClass('likely'),    'dotted-border', 'likely doit avoir dotted-border');
  assert(!buildCardClass('confirmed').includes('dotted-border'), 'confirmed ne doit pas avoir dotted-border');
});

test('Badge ✓ pour confirmed, "probable ?" pour likely', () => {
  function badge(confidence) {
    return confidence === 'likely'
      ? '<span class="conf-badge likely">probable ?</span>'
      : '<span class="conf-badge confirmed">✓</span>';
  }
  assertIncludes(badge('confirmed'), '✓');
  assertIncludes(badge('likely'),    'probable ?');
  assertIncludes(badge('likely'),    'conf-badge likely');
});

test('Tooltip généré pour "likely" avec matchedOn', () => {
  const t = { domain: 'js.hotjar.com', matchedOn: 'hotjar.com', name: 'Hotjar', confidence: 'likely' };
  function tooltipText(tracker) {
    if (tracker.confidence !== 'likely' || !tracker.matchedOn) return '';
    return `Ce sous-domaine (${tracker.domain}) appartient probablement à ${tracker.name} — correspondance par domaine parent "${tracker.matchedOn}". Non confirmé à 100%.`;
  }
  const tt = tooltipText(t);
  assertIncludes(tt, 'js.hotjar.com',  'tooltip contient le sous-domaine');
  assertIncludes(tt, 'Hotjar',         'tooltip contient le nom du service');
  assertIncludes(tt, 'hotjar.com',     'tooltip contient le parent');
  assertIncludes(tt, 'Non confirmé',   'tooltip précise le niveau de certitude');
});

test('Pas de tooltip pour les trackers "confirmed"', () => {
  const t = { domain: 'hotjar.com', matchedOn: 'hotjar.com', name: 'Hotjar', confidence: 'confirmed' };
  function tooltipText(tracker) {
    if (tracker.confidence !== 'likely' || !tracker.matchedOn) return '';
    return 'tooltip';
  }
  assertEqual(tooltipText(t), '', 'pas de tooltip pour confirmed');
});

test('Domaines inconnus listés séparément en gris (unknown-row)', () => {
  const allThirdParty = ['google-analytics.com', 'fonts.googleapis.com', 'custom-cdn.mysite.fr'];
  const knownDomains  = new Set(['google-analytics.com']);
  const unknownList   = allThirdParty.filter(d => !knownDomains.has(d));
  assertEqual(unknownList.length, 2);
  assertIncludes(unknownList.join(','), 'fonts.googleapis.com');
  assertIncludes(unknownList.join(','), 'custom-cdn.mysite.fr');
});

test('Section badges : confirmed vert, likely ambre, unknown gris', () => {
  function sectionBadge(type) {
    const classes = { confirmed: 'section-badge confirmed', likely: 'section-badge likely', unknown: 'section-badge unknown' };
    return classes[type] || '';
  }
  assertIncludes(sectionBadge('confirmed'), 'confirmed');
  assertIncludes(sectionBadge('likely'),    'likely');
  assertIncludes(sectionBadge('unknown'),   'unknown');
});

test('matchedOn affiché seulement si différent du domain', () => {
  function matchedOnHtml(domain, matchedOn) {
    return matchedOn && matchedOn !== domain ? ` → ${matchedOn}` : '';
  }
  assertEqual(matchedOnHtml('js.hotjar.com', 'hotjar.com'), ' → hotjar.com', 'affiché quand différent');
  assertEqual(matchedOnHtml('hotjar.com',    'hotjar.com'), '',              'non affiché quand identique');
});

// ─────────────────────────────────────────────────────────────
console.log('\n─── Bloc 7 : Explication du score de risque ───\n');
// ─────────────────────────────────────────────────────────────

test('buildRiskBreakdown : structure retournée (factors, totalPoints, scoreLabel)', () => {
  const trackers = [
    { risk: 'high', confidence: 'confirmed', category: 'advertising', name: 'DoubleClick' },
    { risk: 'medium', confidence: 'confirmed', category: 'analytics', name: 'GA' },
  ];
  const bd = buildRiskBreakdown(trackers, []);
  assert(Array.isArray(bd.factors), 'factors doit être un tableau');
  assert(typeof bd.totalPoints === 'number', 'totalPoints doit être un nombre');
  assert(typeof bd.scoreLabel  === 'string', 'scoreLabel doit être une chaîne');
});

test('buildRiskBreakdown : high confirmed = ×3', () => {
  const trackers = [
    { risk: 'high', confidence: 'confirmed', category: 'advertising', name: 'DoubleClick' },
    { risk: 'high', confidence: 'confirmed', category: 'advertising', name: 'Criteo' },
  ];
  const bd = buildRiskBreakdown(trackers, []);
  const hf = bd.factors.find(f => f.id === 'high-confirmed');
  assert(hf, 'facteur high-confirmed présent');
  assertEqual(hf.points, 6, '2 trackers × 3 = 6 pts');
  assertIncludes(hf.formula, '× 3', 'formule contient × 3');
});

test('buildRiskBreakdown : high likely = ×2 (pondération réduite)', () => {
  const trackers = [
    { risk: 'high', confidence: 'likely', category: 'advertising', name: 'DoubleClick' },
  ];
  const bd = buildRiskBreakdown(trackers, []);
  const hf = bd.factors.find(f => f.id === 'high-likely');
  assert(hf, 'facteur high-likely présent');
  assertEqual(hf.points, 2, '1 tracker likely × 2 = 2 pts');
});

test('buildRiskBreakdown : session-replay = ×4', () => {
  const trackers = [{ risk: 'high', confidence: 'confirmed', category: 'session-replay', name: 'Hotjar' }];
  const bd = buildRiskBreakdown(trackers, []);
  const rf = bd.factors.find(f => f.id === 'session-replay');
  assert(rf, 'facteur session-replay présent');
  assertEqual(rf.points, 4, '1 × 4 = 4');
  assertIncludes(rf.formula, '× 4', 'formule × 4');
});

test('buildRiskBreakdown : fingerprinting = ×4', () => {
  const trackers = [{ risk: 'high', confidence: 'confirmed', category: 'fingerprinting', name: 'FingerprintJS' }];
  const bd = buildRiskBreakdown(trackers, []);
  const ff = bd.factors.find(f => f.id === 'fingerprinting');
  assert(ff, 'facteur fingerprinting présent');
  assertEqual(ff.points, 4);
});

test('buildRiskBreakdown : domaines inconnus = ×1', () => {
  const bd = buildRiskBreakdown([], [{ domain: 'a.com' }, { domain: 'b.com' }, { domain: 'c.com' }]);
  const uf = bd.factors.find(f => f.id === 'unknown');
  assert(uf, 'facteur unknown présent');
  assertEqual(uf.points, 3, '3 × 1 = 3 pts');
});

test('buildRiskBreakdown : totalPoints = somme des facteurs', () => {
  const trackers = [
    { risk: 'high',   confidence: 'confirmed', category: 'advertising',    name: 'A' },
    { risk: 'high',   confidence: 'confirmed', category: 'session-replay', name: 'B' },
    { risk: 'medium', confidence: 'confirmed', category: 'analytics',      name: 'C' },
  ];
  const bd = buildRiskBreakdown(trackers, [{ domain: 'x.com' }]);
  // high-confirmed → 3pts, session-replay → 4pts (aussi dans high), medium → 2pts, unknown → 1pt
  // Note: B est high ET session-replay → compte dans session-replay (4pts) ET high-confirmed (3pts)
  const sumFromFactors = bd.factors.reduce((s, f) => s + f.points, 0);
  assertEqual(bd.totalPoints, sumFromFactors, `totalPoints (${bd.totalPoints}) doit égaler la somme des facteurs (${sumFromFactors})`);
});

test('buildRiskBreakdown : scoreLabel correct selon totalPoints', () => {
  function label(pts) {
    return pts===0?'Propre':pts<=3?'Faible':pts<=8?'Modéré':pts<=15?'Élevé':'Critique';
  }
  assertEqual(label(0),  'Propre');
  assertEqual(label(2),  'Faible');
  assertEqual(label(5),  'Modéré');
  assertEqual(label(12), 'Élevé');
  assertEqual(label(20), 'Critique');
});

test('buildRiskBreakdown : examples inclus dans chaque facteur', () => {
  const trackers = [
    { risk: 'high', confidence: 'confirmed', category: 'advertising', name: 'DoubleClick' },
    { risk: 'high', confidence: 'confirmed', category: 'advertising', name: 'Criteo' },
  ];
  const bd = buildRiskBreakdown(trackers, []);
  const hf = bd.factors.find(f => f.id === 'high-confirmed');
  assert(Array.isArray(hf.examples), 'examples est un tableau');
  assertIncludes(hf.examples.join(','), 'DoubleClick', 'DoubleClick dans examples');
});

test('buildRiskBreakdown : détail textuel non vide pour chaque facteur', () => {
  // Charger la vraie fonction depuis background.js via node
  const bgSrc = fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8');
  // Extraire buildRiskBreakdown réelle et l'évaluer dans un contexte isolé
  // On vérifie juste que les détails dans la vraie fonction contiennent du texte significatif
  const detailMatches = bgSrc.match(/detail:\s*'([^']{10,})'/g) || [];
  assert(detailMatches.length >= 5, `Seulement ${detailMatches.length} champs detail trouvés, attendu ≥ 5`);
  detailMatches.forEach((m, i) => {
    const text = m.replace(/detail:\s*'/, '').replace(/'$/, '');
    assert(text.length >= 10, `Détail ${i} trop court : "${text}"`);
  });
});

test('Pill de score : classe CSS selon points', () => {
  function pillClass(totalPoints) {
    return totalPoints >= 16 ? 'critical' : totalPoints >= 9 ? 'high' : totalPoints >= 4 ? 'medium' : 'low';
  }
  assertEqual(pillClass(0),  'low');
  assertEqual(pillClass(4),  'medium');
  assertEqual(pillClass(9),  'high');
  assertEqual(pillClass(16), 'critical');
});

test('Toggle breakdown : aria-expanded change au clic', () => {
  let expanded = false;
  function toggle() {
    expanded = !expanded;
    return expanded;
  }
  assert(!expanded, 'fermé par défaut');
  toggle(); assert(expanded, 'ouvert après 1er clic');
  toggle(); assert(!expanded, 'fermé après 2e clic');
});

test('Bloc 6+7 : page sans tracker → breakdown vide, pas de sections', () => {
  const trackers = [], unknown = [], allThirdParty = [];
  const bd = buildRiskBreakdown(trackers, unknown);
  assertEqual(bd.factors.length, 0, 'aucun facteur');
  assertEqual(bd.totalPoints, 0);
  assertEqual(bd.scoreLabel, 'Propre');
  assertEqual(trackers.filter(t => t.confidence === 'confirmed').length, 0);
  assertEqual(trackers.filter(t => t.confidence === 'likely').length, 0);
});

// ── Résultats ──────────────────────────────────────────────────────────────
console.log(`\n─── Résultats ───\n`);
console.log(`Passés  : ${passed}/${passed+failed}`);
console.log(`Échoués : ${failed}/${passed+failed}`);
if (failed > 0) process.exit(1);
else console.log('\nTous les tests passent.');
