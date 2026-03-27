#!/usr/bin/env node
/**
 * TrackMap — Tests du matcher de domaines
 * node build/test-matcher.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// Charger la DB
const dbPath = path.join(__dirname, '../src/trackers-db-full.json');
if (!fs.existsSync(dbPath)) {
  console.error('trackers-db-full.json introuvable. Lancez d\'abord: node build/build-trackers-db.js --offline');
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const exactIndex  = new Map(Object.entries(db.exactIndex));
const suffixIndex = new Map(Object.entries(db.suffixIndex));

// ── Copie locale du matcher (même algo que background.js) ──

function matchDomain(domain) {
  if (!domain || domain.length < 4) return null;
  const clean = domain.toLowerCase().replace(/^www\./, '');

  const exact = exactIndex.get(clean);
  if (exact) return { entry: exact, domain: clean, matchedOn: clean, confidence: 'confirmed' };

  const parts = clean.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const hit = exactIndex.get(candidate);
    if (hit) return { entry: hit, domain: clean, matchedOn: candidate, confidence: 'likely' };

    const root = parts.slice(-2).join('.');
    const rootList = suffixIndex.get(root);
    if (rootList) {
      for (const known of rootList) {
        if (clean.endsWith('.' + known) || clean === known) {
          const e = exactIndex.get(known);
          if (e) return { entry: e, domain: clean, matchedOn: known, confidence: 'likely' };
        }
      }
    }
  }
  return null;
}

// ── Cas de test ──

const tests = [
  // Correspondances exactes attendues
  { domain: 'google-analytics.com',          expect: { match: true, confidence: 'confirmed', risk: 'medium' } },
  { domain: 'doubleclick.net',               expect: { match: true, confidence: 'confirmed', risk: 'high'   } },
  { domain: 'hotjar.com',                    expect: { match: true, confidence: 'confirmed'                  } },
  { domain: 'connect.facebook.net',          expect: { match: true, confidence: 'confirmed', risk: 'high'   } },
  { domain: 'criteo.com',                    expect: { match: true, confidence: 'confirmed'                  } },

  // Sous-domaines → matching par suffixe
  { domain: 'www.google-analytics.com',      expect: { match: true, confidence: 'confirmed' } },
  { domain: 'cdn.segment.com',               expect: { match: true } },
  { domain: 'js.hotjar.com',                 expect: { match: true, confidence: 'likely'    } },
  { domain: 'static.ads.doubleclick.net',    expect: { match: true, confidence: 'likely'    } },
  { domain: 'analytics.tiktok.com',          expect: { match: true, confidence: 'confirmed' } },
  { domain: 'pixel.advertising.com',         expect: { match: true                          } },
  { domain: 'b.scorecardresearch.com',       expect: { match: true } },

  // Domaines légitimes → pas de match attendu
  { domain: 'example.com',                   expect: { match: false } },
  { domain: 'github.com',                    expect: { match: false } },
  { domain: 'wikipedia.org',                 expect: { match: false } },
  { domain: 'localhost',                     expect: { match: false } },
  { domain: 'cdn.jsdelivr.net',              expect: { match: false } },

  // Edge cases
  { domain: 'a.b',                           expect: { match: false } },
  { domain: '',                              expect: { match: false } },
  { domain: 'www.github.com',               expect: { match: false } },

  // Performance — batch de domaines réels
];

// ── Exécution ──

let passed = 0, failed = 0;

console.log('\n=== TrackMap — Tests du matcher ===\n');
console.log(`DB v${db.version} — ${exactIndex.size} domaines, ${suffixIndex.size} clés suffixe\n`);

for (const test of tests) {
  const result  = matchDomain(test.domain);
  const matched = result !== null;
  const exp     = test.expect;

  let ok = matched === exp.match;
  if (ok && exp.confidence) ok = result?.confidence === exp.confidence;
  if (ok && exp.risk)       ok = result?.entry?.r === exp.risk;

  const icon   = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : 'FAIL';

  if (!ok) {
    console.log(`${icon} [${status}] ${test.domain.padEnd(40)}`);
    console.log(`       Attendu  : match=${exp.match}${exp.confidence ? ' confidence='+exp.confidence : ''}${exp.risk ? ' risk='+exp.risk : ''}`);
    console.log(`       Obtenu   : match=${matched}${result ? ` confidence=${result.confidence} matchedOn=${result.matchedOn}` : ''}`);
    failed++;
  } else {
    const detail = result ? ` → ${result.matchedOn} [${result.confidence}]` : ' → no match';
    console.log(`${icon} [${status}] ${test.domain.padEnd(40)} ${detail}`);
    passed++;
  }
}

// ── Benchmark de performance ──

console.log('\n─── Benchmark matching ───\n');

const sampleDomains = [
  'cdn.amplitude.com', 'js.stripe.com', 'widget.freshworks.com',
  'api.segment.io', 'static.hotjar.com', 'unknown-domain-xyz.com',
  'cdn.heapanalytics.com', 'pagead2.googlesyndication.com',
  'bat.bing.com', 'px.ads.linkedin.com', 'tr.snapchat.com',
  'analytics.google.com', 'cdn.mxpnl.com', 'random.unknown.net',
  'js.intercomcdn.com', 'widget.intercom.io', 'cdn.logrocket.io'
];

const iterations = 10000;
const t0 = Date.now();

for (let i = 0; i < iterations; i++) {
  for (const domain of sampleDomains) {
    matchDomain(domain);
  }
}

const elapsed   = Date.now() - t0;
const totalOps  = iterations * sampleDomains.length;
const opsPerSec = Math.round(totalOps / (elapsed / 1000));

console.log(`${totalOps.toLocaleString()} lookups en ${elapsed}ms`);
console.log(`→ ${opsPerSec.toLocaleString()} lookups/seconde`);
console.log(`→ ${(elapsed / totalOps * 1000).toFixed(3)} µs/lookup`);

// ── Résultat ──

console.log(`\n─── Résultats ───\n`);
console.log(`Passés  : ${passed}/${tests.length}`);
console.log(`Échoués : ${failed}/${tests.length}`);

if (failed > 0) {
  console.log('\nDes tests ont échoué.');
  process.exit(1);
} else {
  console.log('\nTous les tests passent.');
}
