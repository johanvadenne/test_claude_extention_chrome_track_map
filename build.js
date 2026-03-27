#!/usr/bin/env node
/**
 * TrackMap — Script de build multi-navigateur
 *
 * Génère deux bundles depuis la même source :
 *   dist/chrome/  — Chrome (Manifest V3, API chrome.*)
 *   dist/firefox/ — Firefox (WebExtensions, API browser.*, manifest browser_specific_settings)
 *
 * Usage :
 *   node build/build.js           # les deux navigateurs
 *   node build/build.js --chrome  # Chrome seulement
 *   node build/build.js --firefox # Firefox seulement
 *   node build/build.js --db      # re-build la DB de trackers aussi
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC  = ROOT;
const DIST = path.join(ROOT, 'dist');

const BUILD_CHROME  = !process.argv.includes('--firefox');
const BUILD_FIREFOX = !process.argv.includes('--chrome');
const BUILD_DB      =  process.argv.includes('--db');

function log(msg)  { console.log(`[build] ${msg}`); }
function warn(msg) { console.log(`[warn]  ${msg}`); }

// ── Fichiers à copier dans les deux bundles ────────────────────────────────

const COMMON_FILES = [
  'src/content.js',
  'src/background.js',
  'src/trackers-db-full.json',
  'src/trackers-overrides.json',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js',
  'privacy.html',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

// ── Transformations Firefox ────────────────────────────────────────────────
// Remplace chrome.* par browser.* dans les fichiers JS.
// Exceptions : chrome-extension:// URLs dans les guards (chaînes, pas appels API).

const CHROME_API_RE = /\bchrome\.(runtime|tabs|storage|action|scripting|webRequest|extension|alarms)\b/g;

function toFirefoxAPI(content) {
  return content.replace(CHROME_API_RE, (match, api) => `browser.${api}`);
}

// ── Manifest Chrome ───────────────────────────────────────────────────────

function buildChromeManifest(base) {
  return { ...base };
}

// ── Manifest Firefox ──────────────────────────────────────────────────────
// Différences MV3 Firefox vs Chrome :
// - browser_specific_settings avec l'ID AMO
// - action → browser_action dans les anciennes versions, mais MV3 Firefox supporte action
// - background.service_worker → background.scripts (Firefox MV3 supporte les deux)
// - gecko_android si besoin

function buildFirefoxManifest(base) {
  const ff = JSON.parse(JSON.stringify(base)); // deep clone

  ff.browser_specific_settings = {
    gecko: {
      id: 'trackmap@extension',
      strict_min_version: '109.0'
    },
    gecko_android: {
      strict_min_version: '113.0'
    }
  };

  // Firefox MV3 supporte service_worker mais aussi scripts[]
  // On garde service_worker — supporté depuis Firefox 128
  // Pas de changement nécessaire ici

  // Firefox ne supporte pas chrome.action.setBadgeBackgroundColor avec {tabId} avant FF 127
  // On laisse le code tel quel, le try/catch dans background.js absorbe les erreurs

  // Retirer les permissions non supportées par Firefox
  const ffUnsupported = [];
  ff.permissions = (ff.permissions || []).filter(p => !ffUnsupported.includes(p));

  return ff;
}

// ── Copier et transformer les fichiers ────────────────────────────────────

function copyFile(srcPath, destPath, transform) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (transform && (srcPath.endsWith('.js') || srcPath.endsWith('.json'))) {
    let content = fs.readFileSync(srcPath, 'utf8');
    content = transform(content);
    fs.writeFileSync(destPath, content, 'utf8');
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
}

function buildBundle(target, manifestFn, transformFn) {
  const outDir = path.join(DIST, target);
  log(`Building ${target} bundle → ${outDir}`);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Copier les fichiers communs
  let copied = 0;
  for (const file of COMMON_FILES) {
    const src  = path.join(SRC, file);
    const dest = path.join(outDir, file);
    if (!fs.existsSync(src)) { warn(`Fichier manquant : ${file}`); continue; }
    copyFile(src, dest, transformFn);
    copied++;
  }

  // Générer le manifest
  const baseManifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const manifest     = manifestFn(baseManifest);
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  // Vérification : pas de chrome.* dans le bundle Firefox
  if (target === 'firefox') {
    let violations = 0;
    for (const file of COMMON_FILES.filter(f => f.endsWith('.js'))) {
      const dest    = path.join(outDir, file);
      if (!fs.existsSync(dest)) continue;
      const content = fs.readFileSync(dest, 'utf8');
      const matches = content.match(/\bchrome\.(runtime|tabs|storage|action|scripting|webRequest)\b/g);
      if (matches) {
        warn(`API chrome.* non remplacée dans ${file} : ${matches.slice(0,3).join(', ')}`);
        violations++;
      }
    }
    if (violations === 0) {
      log(`  ✓ Aucune référence chrome.* résiduelle`);
    }
  }

  log(`  ✓ ${copied + 1} fichiers écrits`);
  return outDir;
}

// ── Calculer la taille d'un dossier ───────────────────────────────────────

function dirSize(dir) {
  let total = 0;
  function walk(d) {
    fs.readdirSync(d).forEach(f => {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    });
  }
  walk(dir);
  return total;
}

// ── Point d'entrée ────────────────────────────────────────────────────────

async function main() {
  log(`=== TrackMap — Build multi-navigateur ===`);

  // Optionnel : re-build la DB de trackers d'abord
  if (BUILD_DB) {
    log('Re-build de la DB de trackers…');
    const { execSync } = require('child_process');
    execSync(`node ${path.join(__dirname, 'build-trackers-db.js')} --offline`, { stdio: 'inherit' });
    log('');
  }

  const results = [];

  if (BUILD_CHROME) {
    const out  = buildBundle('chrome',  buildChromeManifest,  null);
    const size = Math.round(dirSize(out) / 1024);
    results.push({ target: 'chrome', out, size });
  }

  if (BUILD_FIREFOX) {
    const out  = buildBundle('firefox', buildFirefoxManifest, toFirefoxAPI);
    const size = Math.round(dirSize(out) / 1024);
    results.push({ target: 'firefox', out, size });
  }

  log('');
  log('=== Résumé ===');
  results.forEach(r => {
    log(`  ${r.target.padEnd(10)} → ${r.out}  (${r.size} KB)`);
  });

  // Vérification croisée : s'assurer que les deux bundles ont le même nombre de fichiers
  if (results.length === 2) {
    function countFiles(dir) {
      let n = 0;
      function walk(d) { fs.readdirSync(d).forEach(f => { const p = path.join(d,f); fs.statSync(p).isDirectory() ? walk(p) : n++; }); }
      walk(dir);
      return n;
    }
    const nC = countFiles(results[0].out);
    const nF = countFiles(results[1].out);
    if (nC !== nF) warn(`Nombre de fichiers différent : Chrome=${nC}, Firefox=${nF}`);
    else log(`  ✓ Parité de fichiers : ${nC} fichiers dans chaque bundle`);
  }

  log('');
  log('Build terminé.');
}

main().catch(err => { console.error('[ERROR]', err); process.exit(1); });
