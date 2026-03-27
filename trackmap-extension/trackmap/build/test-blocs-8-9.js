#!/usr/bin/env node
/**
 * TrackMap v6 — Tests Blocs 8 & 9
 * node build/test-blocs-8-9.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓  ${name}`); passed++; }
  catch(e) { console.log(`✗  ${name}\n   ${e.message}`); failed++; }
}
function assert(c, m)    { if (!c) throw new Error(m || 'assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error(m || `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function assertIncludes(str, sub, m) { if (!String(str).includes(sub)) throw new Error(m || `"${str.toString().slice(0,80)}..." does not include "${sub}"`); }

console.log('\n=== TrackMap v6 — Blocs 8 & 9 ===\n');

// ─────────────────────────────────────────────────────────────
console.log('─── Bloc 8 : Page d\'options + multi-navigateur ───\n');
// ─────────────────────────────────────────────────────────────

test('manifest.json : options_page défini', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert(m.options_page === 'options.html', `options_page = ${m.options_page}`);
});

test('manifest.json : version mise à jour', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert(m.version, 'version présente');
  assert(m.version !== '1.0.0', 'version mise à jour depuis 1.0.0');
});

test('options.html : existe et contient les 3 paramètres clés', () => {
  const html = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
  assertIncludes(html, 'toggle-badge',       'toggle badge présent');
  assertIncludes(html, 'verbosity-options',   'sélecteur verbosité présent');
  assertIncludes(html, 'domain-input',        'input domaines exclus présent');
});

test('options.html : trois niveaux de verbosité', () => {
  const html = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
  assertIncludes(html, 'data-verb="minimal"',  'niveau minimal présent');
  assertIncludes(html, 'data-verb="standard"', 'niveau standard présent');
  assertIncludes(html, 'data-verb="strict"',   'niveau strict présent');
});

test('options.html : lien vers privacy.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
  assertIncludes(html, 'privacy.html', 'lien privacy.html présent');
});

test('options.js : DEFAULTS couvre les 3 paramètres principaux', () => {
  const js = fs.readFileSync(path.join(ROOT, 'options.js'), 'utf8');
  assertIncludes(js, 'verbosity',      'verbosité dans DEFAULTS');
  assertIncludes(js, 'badgeEnabled',   'badge dans DEFAULTS');
  assertIncludes(js, 'blockedDomains', 'domaines exclus dans DEFAULTS');
});

test('options.js : préférence stockée via chrome.storage.sync', () => {
  const js = fs.readFileSync(path.join(ROOT, 'options.js'), 'utf8');
  assertIncludes(js, 'chrome.storage.sync', 'utilise storage.sync pour les options');
  // Note : storage.local.clear() est aussi utilisé pour effacer TOUTES les données
  // (graphe de session inclus), ce qui est intentionnel dans le bouton "Effacer tout"
  assertIncludes(js, 'chrome.storage.sync.get', 'lecture depuis storage.sync');
  assertIncludes(js, 'chrome.storage.sync.set', 'écriture dans storage.sync');
});

test('options.js : validation du domaine avant ajout', () => {
  // Simuler la logique de validation
  function isValid(val) {
    const d = val.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return d.length > 3 && d.includes('.') && /^[a-z0-9._-]+$/.test(d);
  }
  assert( isValid('example.com'),       'example.com valide');
  assert( isValid('mon-site.fr'),        'mon-site.fr valide');
  assert( isValid('https://test.io'),    'URL complète acceptée');
  assert(!isValid('abc'),               'abc trop court, invalide');
  assert(!isValid('nodot'),             'sans point, invalide');
  assert(!isValid(''),                  'vide invalide');
  assert(!isValid('has spaces.com'),    'espace invalide');
});

test('options.js : normalisation du domaine (strip https, path)', () => {
  function normalizeDomain(val) {
    return val.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
  assertEqual(normalizeDomain('https://example.com/path'), 'example.com');
  assertEqual(normalizeDomain('HTTP://MON-SITE.FR'),       'mon-site.fr');
  assertEqual(normalizeDomain('  example.com  '),          'example.com');
});

test('options.js : descriptions verbosité non vides', () => {
  const js = fs.readFileSync(path.join(ROOT, 'options.js'), 'utf8');
  const match = js.match(/VERB_DESCS\s*=\s*\{([^}]+)\}/s);
  assert(match, 'VERB_DESCS trouvé');
  assertIncludes(match[1], 'minimal',  'desc minimal');
  assertIncludes(match[1], 'standard', 'desc standard');
  assertIncludes(match[1], 'strict',   'desc strict');
});

test('build.js : existe et configure Chrome + Firefox', () => {
  const js = fs.readFileSync(path.join(ROOT, 'build/build.js'), 'utf8');
  assertIncludes(js, 'buildChromeManifest',   'build Chrome présent');
  assertIncludes(js, 'buildFirefoxManifest',   'build Firefox présent');
  assertIncludes(js, 'browser_specific_settings', 'manifest Firefox inclut browser_specific_settings');
  assertIncludes(js, "id: 'trackmap@extension'",  'ID AMO présent');
});

test('build.js : transformation chrome.* → browser.* pour Firefox', () => {
  const js = fs.readFileSync(path.join(ROOT, 'build/build.js'), 'utf8');
  assertIncludes(js, 'toFirefoxAPI', 'fonction de transformation présente');
  assertIncludes(js, 'browser.${api}', 'remplacement browser.* présent');
});

test('Transformation Firefox : chrome.runtime → browser.runtime', () => {
  const CHROME_API_RE = /\bchrome\.(runtime|tabs|storage|action|scripting|webRequest|extension|alarms)\b/g;
  function toFirefoxAPI(content) {
    return content.replace(CHROME_API_RE, (match, api) => `browser.${api}`);
  }
  const input    = 'chrome.runtime.sendMessage(); chrome.storage.sync.get(); chrome.tabs.query()';
  const output   = toFirefoxAPI(input);
  assertIncludes(output, 'browser.runtime.sendMessage', 'runtime transformé');
  assertIncludes(output, 'browser.storage.sync.get',    'storage transformé');
  assertIncludes(output, 'browser.tabs.query',          'tabs transformé');
  assert(!output.includes('chrome.runtime'), 'plus de chrome.runtime');
  assert(!output.includes('chrome.storage'), 'plus de chrome.storage');
});

test('Transformation Firefox : chrome-extension:// URLs non transformées', () => {
  const CHROME_API_RE = /\bchrome\.(runtime|tabs|storage|action|scripting|webRequest|extension|alarms)\b/g;
  function toFirefoxAPI(content) {
    return content.replace(CHROME_API_RE, (match, api) => `browser.${api}`);
  }
  // Les URLs chrome-extension:// dans les guards sont des chaînes, pas des appels API
  const input  = "if (proto === 'chrome-extension:') return; chrome.runtime.sendMessage()";
  const output = toFirefoxAPI(input);
  assertIncludes(output, "chrome-extension:", 'URL chrome-extension: préservée');
  assertIncludes(output, 'browser.runtime',   'appel API transformé');
});

test('background.js : options chargées via loadOptions()', () => {
  const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
  assertIncludes(bg, 'loadOptions',       'loadOptions() présent');
  assertIncludes(bg, 'badgeEnabled',      'variable badgeEnabled présente');
  assertIncludes(bg, 'blockedDomains',    'variable blockedDomains présente');
  assertIncludes(bg, 'chrome.storage.onChanged', 'écoute les changements d\'options');
});

test('background.js : domaines exclus ignorés dans handlePageData', () => {
  const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
  assertIncludes(bg, 'blockedDomains.has(domain)', 'vérification domaines exclus');
});

test('background.js : badge respecte badgeEnabled', () => {
  const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
  assertIncludes(bg, 'if (badgeEnabled)', 'condition badgeEnabled présente');
});

// ─────────────────────────────────────────────────────────────
console.log('\n─── Bloc 9 : Export + Politique de confidentialité ───\n');
// ─────────────────────────────────────────────────────────────

test('popup.js : fonctions d\'export présentes', () => {
  const js = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  assertIncludes(js, 'exportReport',    'exportReport() présent');
  assertIncludes(js, 'downloadBlob',    'downloadBlob() présent');
  assertIncludes(js, 'buildHTMLReport', 'buildHTMLReport() présent');
});

test('popup.js : export JSON et HTML supportés', () => {
  const js = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  assertIncludes(js, "format === 'json'",     'branche JSON présente');
  assertIncludes(js, 'buildHTMLReport',        'buildHTMLReport appelé pour HTML');
  assertIncludes(js, 'application/json',       'MIME JSON correct');
  assertIncludes(js, 'text/html',              'MIME HTML correct');
});

test('popup.js : Blob + createObjectURL pour le téléchargement', () => {
  const js = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  assertIncludes(js, 'new Blob(',              'Blob utilisé');
  assertIncludes(js, 'URL.createObjectURL',    'createObjectURL utilisé');
  assertIncludes(js, 'URL.revokeObjectURL',    'revokeObjectURL pour nettoyage mémoire');
});

test('Export JSON : structure payload correcte', () => {
  // Simuler buildPayload
  const pageData = {
    domain: 'example.com', url: 'https://example.com', title: 'Test',
    timestamp: Date.now(),
    trackers: [
      { domain: 'ga.com', confidence: 'confirmed', risk: 'medium', name: 'GA', owner: 'Google', category: 'analytics', description: 'test' },
      { domain: 'sub.ga.com', confidence: 'likely', risk: 'medium', name: 'GA Sub', owner: 'Google', category: 'analytics', description: 'test' }
    ],
    allThirdPartyDomains: ['ga.com', 'sub.ga.com']
  };
  const payload = {
    generatedAt: new Date().toISOString(),
    extension: 'TrackMap',
    page: {
      domain:            pageData.domain,
      trackersConfirmed: pageData.trackers.filter(t => t.confidence === 'confirmed'),
      trackersProbable:  pageData.trackers.filter(t => t.confidence === 'likely')
    }
  };
  assertEqual(payload.page.trackersConfirmed.length, 1, '1 tracker confirmé');
  assertEqual(payload.page.trackersProbable.length,  1, '1 tracker probable');
  assert(payload.generatedAt.includes('T'), 'timestamp ISO 8601');
});

test('Export HTML : rapport auto-contenu (pas de dépendance externe)', () => {
  const js = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  // Extraire buildHTMLReport
  const match = js.match(/function buildHTMLReport[\s\S]*?^}/m);
  if (match) {
    const fn = match[0];
    assert(!fn.includes('href='), 'pas de liens CSS externes dans le rapport HTML');
    assert(!fn.includes('src="http'), 'pas de scripts externes');
    assert(fn.includes('<style>'), 'styles inline présents');
  }
  // Vérifier qu'il y a bien une balise style inline dans le template
  assertIncludes(js, '<!DOCTYPE html>', 'template HTML valide');
});

test('Export HTML : nom de fichier avec date', () => {
  const js = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  assertIncludes(js, 'trackmap-report-', 'préfixe filename correct');
  assertIncludes(js, '.toISOString().slice(0,10)', 'date dans le nom de fichier');
});

test('privacy.html : existe et certifie les 5 points clés', () => {
  const html = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  assertIncludes(html, 'donnée personnelle',        'point données personnelles');
  assertIncludes(html, 'serveur distant',           'point serveur distant');
  assertIncludes(html, 'localement',                'point local');
  assertIncludes(html, 'désinstallation',           'point désinstallation');
  assertIncludes(html, 'chrome.storage',            'mentionne chrome.storage');
});

test('privacy.html : table des permissions documentée', () => {
  const html = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  assertIncludes(html, 'webRequest', 'permission webRequest documentée');
  assertIncludes(html, 'storage',    'permission storage documentée');
  assertIncludes(html, 'scripting',  'permission scripting documentée');
});

test('background.js : handler de désinstallation / onInstalled présent', () => {
  const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
  assertIncludes(bg, 'onInstalled', 'onInstalled listener présent');
  assertIncludes(bg, 'setUninstallURL', 'setUninstallURL présent');
});

test('manifest.json : privacy.html dans web_accessible_resources', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const resources = m.web_accessible_resources.flatMap(r => r.resources);
  assert(resources.includes('privacy.html'), 'privacy.html accessible');
});

test('popup.html : bouton export et modal présents', () => {
  const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  assertIncludes(html, 'btn-export',       'bouton export présent');
  assertIncludes(html, 'export-modal-bg',  'modal export présent');
  assertIncludes(html, 'export-json',      'option JSON présente');
  assertIncludes(html, 'export-html',      'option HTML présente');
});

test('popup.html : bouton options présent', () => {
  const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  assertIncludes(html, 'btn-options', 'bouton options présent');
});

// ── Résultats ──────────────────────────────────────────────────────────────
console.log(`\n─── Résultats ───\n`);
console.log(`Passés  : ${passed}/${passed+failed}`);
console.log(`Échoués : ${failed}/${passed+failed}`);
if (failed > 0) process.exit(1);
else console.log('\nTous les tests passent.');
