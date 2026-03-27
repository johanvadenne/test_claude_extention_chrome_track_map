#!/usr/bin/env node
/**
 * TrackMap — Pipeline de build de la base de trackers
 *
 * Sources fusionnées :
 *   1. Disconnect.me (https://disconnect.me/trackerprotection)
 *   2. DuckDuckGo Tracker Radar (https://github.com/duckduckgo/tracker-radar)
 *   3. EasyPrivacy hosts (https://easylist.to/easylist/easyprivacy.txt)
 *   4. trackers-overrides.json (manuel — descriptions FR + risques affinés)
 *
 * Usage :
 *   node build/build-trackers-db.js           # télécharge les listes en ligne
 *   node build/build-trackers-db.js --offline  # utilise les snapshots embarqués
 *   node build/build-trackers-db.js --stats    # affiche les statistiques
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http  = require('https');
const zlib  = require('zlib');

const ROOT    = path.join(__dirname, '..');
const SRC     = path.join(ROOT, 'src');
const OFFLINE = process.argv.includes('--offline');
const STATS   = process.argv.includes('--stats');

// ─────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────

function log(msg)  { process.stdout.write(`[build] ${msg}\n`); }
function warn(msg) { process.stdout.write(`[warn]  ${msg}\n`); }

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
  });
}

// ─────────────────────────────────────────────────────────────
// Normalisation des niveaux de risque
// ─────────────────────────────────────────────────────────────

const CATEGORY_RISK = {
  // Disconnect.me categories
  'Advertising':        'high',
  'Analytics':          'medium',
  'Social':             'medium',
  'Disconnect':         'medium',
  'Content':            'low',
  'FingerprintingInvasive': 'high',
  'FingerprintingGeneral':  'medium',
  // DuckDuckGo categories
  'Ad Motivated Tracking': 'high',
  'Advertising':           'high',
  'Analytics':             'medium',
  'Social Network':        'medium',
  'Audience Measurement':  'medium',
  'Third-Party Analytics': 'medium',
  'Federated Login':       'low',
  'Non-Tracking':          'low',
  'CDN':                   'low',
  'Tag Manager':           'medium',
  'Action Pixels':         'high',
  'Badge':                 'low',
  'Online Payment':        'low',
  'Session Replay':        'high',
  'Customer Interaction':  'low',
  'Email Marketing':       'medium',
  'Embedded Content':      'low',
  'Unknown':               'medium',
};

function normalizeRisk(category) {
  return CATEGORY_RISK[category] || 'medium';
}

function normalizeCategory(raw) {
  const map = {
    'Advertising': 'advertising',
    'Ad Motivated Tracking': 'advertising',
    'Action Pixels': 'advertising',
    'Analytics': 'analytics',
    'Third-Party Analytics': 'analytics',
    'Audience Measurement': 'analytics',
    'Social': 'social',
    'Social Network': 'social',
    'Tag Manager': 'tag-manager',
    'Session Replay': 'session-replay',
    'Customer Interaction': 'support',
    'Federated Login': 'auth',
    'Online Payment': 'payment',
    'CDN': 'infrastructure',
    'Content': 'infrastructure',
    'Disconnect': 'analytics',
    'FingerprintingInvasive': 'fingerprinting',
    'FingerprintingGeneral': 'fingerprinting',
    'Email Marketing': 'marketing',
    'Embedded Content': 'content',
    'Badge': 'social',
  };
  return map[raw] || 'other';
}

// ─────────────────────────────────────────────────────────────
// Source 1 — Disconnect.me
// ─────────────────────────────────────────────────────────────

const DISCONNECT_URL = 'https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json';

// Snapshot partiel (top domains) pour le mode offline
const DISCONNECT_SNAPSHOT = {
  "categories": {
    "Advertising": {
      "Google": { "Google Ads": { "googleadservices.com": 1, "googlesyndication.com": 1, "doubleclick.net": 1, "googletagservices.com": 1 } },
      "Meta": { "Facebook Ads": { "connect.facebook.net": 1, "facebook.com": 1, "fbcdn.net": 1, "instagram.com": 1 } },
      "Amazon": { "Amazon Ads": { "amazon-adsystem.com": 1, "amazonadsystem.com": 1 } },
      "Twitter": { "Twitter Ads": { "ads-twitter.com": 1, "t.co": 1 } },
      "TikTok": { "TikTok Pixel": { "analytics.tiktok.com": 1, "ads.tiktok.com": 1 } },
      "Criteo": { "Criteo": { "criteo.com": 1, "criteo.net": 1 } },
      "Taboola": { "Taboola": { "taboola.com": 1, "taboolasyndication.com": 1 } },
      "Outbrain": { "Outbrain": { "outbrain.com": 1, "outbrainimg.com": 1 } },
      "AppNexus": { "Xandr": { "appnexus.com": 1, "adnxs.com": 1 } },
      "Quantcast": { "Quantcast": { "quantserve.com": 1, "quantcast.com": 1 } },
      "The Trade Desk": { "The Trade Desk": { "adsrvr.org": 1 } },
      "Pubmatic": { "Pubmatic": { "pubmatic.com": 1 } },
      "Rubicon": { "Magnite": { "rubiconproject.com": 1 } },
      "Index Exchange": { "Index Exchange": { "casalemedia.com": 1 } },
      "OpenX": { "OpenX": { "openx.net": 1 } },
      "Sovrn": { "Sovrn": { "lijit.com": 1, "sovrn.com": 1 } },
      "Conversant": { "Conversant": { "conversantmedia.com": 1, "emjcd.com": 1 } },
      "Yahoo": { "Yahoo Advertising": { "yahooapis.com": 1, "oath.com": 1, "yimg.com": 1 } },
      "Pinterest": { "Pinterest": { "pinimg.com": 1 } },
      "LinkedIn": { "LinkedIn Ads": { "licdn.com": 1, "linkedin.com": 1 } },
      "Snap": { "Snap Pixel": { "sc-static.net": 1, "snapchat.com": 1 } }
    },
    "Analytics": {
      "Google": { "Google Analytics": { "google-analytics.com": 1, "googletagmanager.com": 1, "ga.js": 1 } },
      "Adobe": { "Adobe Analytics": { "omtrdc.net": 1, "2o7.net": 1, "adobedtm.com": 1, "demdex.net": 1 } },
      "New Relic": { "New Relic": { "nr-data.net": 1, "newrelic.com": 1 } },
      "Hotjar": { "Hotjar": { "hotjar.com": 1 } },
      "Mouseflow": { "Mouseflow": { "mouseflow.com": 1 } },
      "FullStory": { "FullStory": { "fullstory.com": 1, "rs6.net": 1 } },
      "Heap": { "Heap": { "heapanalytics.com": 1 } },
      "Mixpanel": { "Mixpanel": { "mixpanel.com": 1 } },
      "Amplitude": { "Amplitude": { "amplitude.com": 1 } },
      "Segment": { "Segment": { "segment.com": 1, "segment.io": 1 } },
      "Comscore": { "Comscore": { "scorecardresearch.com": 1, "comscore.com": 1 } },
      "Nielsen": { "Nielsen": { "exelate.com": 1 } },
      "Chartbeat": { "Chartbeat": { "chartbeat.com": 1, "chartbeat.net": 1 } },
      "Parse.ly": { "Parse.ly": { "parsely.com": 1 } },
      "Lytics": { "Lytics": { "lytics.io": 1 } }
    },
    "Social": {
      "Facebook": { "Facebook Connect": { "connect.facebook.net": 1 } },
      "Twitter": { "Twitter Button": { "platform.twitter.com": 1 } },
      "LinkedIn": { "LinkedIn Button": { "platform.linkedin.com": 1 } },
      "Pinterest": { "Pinterest Button": { "widgets.pinterest.com": 1 } },
      "AddThis": { "AddThis": { "addthis.com": 1, "addthiscdn.com": 1 } },
      "ShareThis": { "ShareThis": { "sharethis.com": 1 } }
    },
    "FingerprintingInvasive": {
      "ThreatMetrix": { "ThreatMetrix": { "h.online-metrix.net": 1 } },
      "MaxMind": { "MaxMind": { "maxmind.com": 1 } },
      "FingerprintJS": { "FingerprintJS": { "fingerprintjs.com": 1, "fpjs.pro": 1 } }
    }
  }
};

async function parseDisconnect(offline) {
  log('Source 1 : Disconnect.me…');
  let raw;
  if (offline) {
    raw = DISCONNECT_SNAPSHOT;
    log('  → snapshot offline');
  } else {
    try {
      const text = await fetchURL(DISCONNECT_URL);
      raw = JSON.parse(text);
      log('  → téléchargé');
    } catch (e) {
      warn(`  → échec réseau (${e.message}), fallback snapshot`);
      raw = DISCONNECT_SNAPSHOT;
    }
  }

  const entries = {};
  const categories = raw.categories || {};

  for (const [cat, owners] of Object.entries(categories)) {
    for (const [owner, services] of Object.entries(owners)) {
      for (const [serviceName, domains] of Object.entries(services)) {
        for (const domain of Object.keys(domains)) {
          if (!domain || domain.length < 3) continue;
          const cleanDomain = domain.replace(/^www\./, '').toLowerCase().trim();
          if (!entries[cleanDomain]) {
            entries[cleanDomain] = {
              name: serviceName,
              owner,
              category: normalizeCategory(cat),
              risk: normalizeRisk(cat),
              sources: ['disconnect'],
              prevalence: 0
            };
          }
        }
      }
    }
  }

  log(`  → ${Object.keys(entries).length} domaines extraits`);
  return entries;
}

// ─────────────────────────────────────────────────────────────
// Source 2 — DuckDuckGo Tracker Radar (top domains)
// ─────────────────────────────────────────────────────────────

// Le Tracker Radar complet fait >200 MB — on utilise le fichier
// de résumé "domains" qui liste les domaines avec leurs métadonnées.
const DDG_DOMAINS_URL = 'https://raw.githubusercontent.com/duckduckgo/tracker-radar/main/build-data/generated/domain_summary.json';

// Snapshot des 200 domaines les plus prévalents
const DDG_SNAPSHOT = {
  "google-analytics.com":     { "owner": { "name": "Google LLC" }, "categories": ["Analytics"], "prevalence": 0.584 },
  "googletagmanager.com":     { "owner": { "name": "Google LLC" }, "categories": ["Tag Manager"], "prevalence": 0.512 },
  "doubleclick.net":          { "owner": { "name": "Google LLC" }, "categories": ["Advertising"], "prevalence": 0.498 },
  "googlesyndication.com":    { "owner": { "name": "Google LLC" }, "categories": ["Advertising"], "prevalence": 0.421 },
  "googleadservices.com":     { "owner": { "name": "Google LLC" }, "categories": ["Advertising"], "prevalence": 0.318 },
  "facebook.com":             { "owner": { "name": "Facebook, Inc." }, "categories": ["Social Network","Advertising"], "prevalence": 0.302 },
  "connect.facebook.net":     { "owner": { "name": "Facebook, Inc." }, "categories": ["Advertising","Social Network"], "prevalence": 0.285 },
  "amazon-adsystem.com":      { "owner": { "name": "Amazon Technologies, Inc." }, "categories": ["Advertising"], "prevalence": 0.198 },
  "cloudflare.com":           { "owner": { "name": "Cloudflare, Inc." }, "categories": ["CDN"], "prevalence": 0.195 },
  "hotjar.com":               { "owner": { "name": "Hotjar Ltd" }, "categories": ["Session Replay","Analytics"], "prevalence": 0.129 },
  "twitter.com":              { "owner": { "name": "Twitter, Inc." }, "categories": ["Social Network"], "prevalence": 0.124 },
  "ads-twitter.com":          { "owner": { "name": "Twitter, Inc." }, "categories": ["Advertising"], "prevalence": 0.098 },
  "linkedin.com":             { "owner": { "name": "LinkedIn" }, "categories": ["Social Network","Advertising"], "prevalence": 0.095 },
  "criteo.com":               { "owner": { "name": "Criteo" }, "categories": ["Advertising"], "prevalence": 0.092 },
  "criteo.net":               { "owner": { "name": "Criteo" }, "categories": ["Advertising"], "prevalence": 0.088 },
  "taboola.com":              { "owner": { "name": "Taboola" }, "categories": ["Advertising"], "prevalence": 0.087 },
  "outbrain.com":             { "owner": { "name": "Outbrain" }, "categories": ["Advertising"], "prevalence": 0.082 },
  "scorecardresearch.com":    { "owner": { "name": "Comscore, Inc." }, "categories": ["Audience Measurement"], "prevalence": 0.078 },
  "segment.com":              { "owner": { "name": "Twilio Segment" }, "categories": ["Analytics"], "prevalence": 0.074 },
  "segment.io":               { "owner": { "name": "Twilio Segment" }, "categories": ["Analytics"], "prevalence": 0.071 },
  "amplitude.com":            { "owner": { "name": "Amplitude" }, "categories": ["Analytics"], "prevalence": 0.068 },
  "mixpanel.com":             { "owner": { "name": "Mixpanel, Inc." }, "categories": ["Analytics"], "prevalence": 0.065 },
  "intercom.io":              { "owner": { "name": "Intercom" }, "categories": ["Customer Interaction"], "prevalence": 0.063 },
  "intercom.com":             { "owner": { "name": "Intercom" }, "categories": ["Customer Interaction"], "prevalence": 0.061 },
  "fullstory.com":            { "owner": { "name": "FullStory" }, "categories": ["Session Replay"], "prevalence": 0.059 },
  "heapanalytics.com":        { "owner": { "name": "Heap" }, "categories": ["Analytics"], "prevalence": 0.055 },
  "chartbeat.com":            { "owner": { "name": "Chartbeat" }, "categories": ["Analytics"], "prevalence": 0.054 },
  "chartbeat.net":            { "owner": { "name": "Chartbeat" }, "categories": ["Analytics"], "prevalence": 0.052 },
  "nr-data.net":              { "owner": { "name": "New Relic" }, "categories": ["Analytics"], "prevalence": 0.051 },
  "parsely.com":              { "owner": { "name": "Automattic" }, "categories": ["Analytics"], "prevalence": 0.049 },
  "omtrdc.net":               { "owner": { "name": "Adobe Inc." }, "categories": ["Analytics"], "prevalence": 0.048 },
  "demdex.net":               { "owner": { "name": "Adobe Inc." }, "categories": ["Advertising","Analytics"], "prevalence": 0.046 },
  "adobedtm.com":             { "owner": { "name": "Adobe Inc." }, "categories": ["Tag Manager"], "prevalence": 0.045 },
  "pinterest.com":            { "owner": { "name": "Pinterest" }, "categories": ["Social Network"], "prevalence": 0.044 },
  "pinimg.com":               { "owner": { "name": "Pinterest" }, "categories": ["Advertising"], "prevalence": 0.043 },
  "snapchat.com":             { "owner": { "name": "Snap Inc." }, "categories": ["Advertising"], "prevalence": 0.041 },
  "sc-static.net":            { "owner": { "name": "Snap Inc." }, "categories": ["Advertising"], "prevalence": 0.039 },
  "tiktok.com":               { "owner": { "name": "ByteDance" }, "categories": ["Advertising","Social Network"], "prevalence": 0.038 },
  "analytics.tiktok.com":     { "owner": { "name": "ByteDance" }, "categories": ["Advertising"], "prevalence": 0.036 },
  "appnexus.com":             { "owner": { "name": "Xandr" }, "categories": ["Advertising"], "prevalence": 0.035 },
  "adnxs.com":                { "owner": { "name": "Xandr" }, "categories": ["Advertising"], "prevalence": 0.034 },
  "quantserve.com":           { "owner": { "name": "Quantcast" }, "categories": ["Advertising","Audience Measurement"], "prevalence": 0.033 },
  "adsrvr.org":               { "owner": { "name": "The Trade Desk" }, "categories": ["Advertising"], "prevalence": 0.032 },
  "rubiconproject.com":       { "owner": { "name": "Magnite" }, "categories": ["Advertising"], "prevalence": 0.031 },
  "pubmatic.com":             { "owner": { "name": "PubMatic" }, "categories": ["Advertising"], "prevalence": 0.030 },
  "casalemedia.com":          { "owner": { "name": "Index Exchange" }, "categories": ["Advertising"], "prevalence": 0.029 },
  "openx.net":                { "owner": { "name": "OpenX" }, "categories": ["Advertising"], "prevalence": 0.028 },
  "sovrn.com":                { "owner": { "name": "Sovrn" }, "categories": ["Advertising"], "prevalence": 0.027 },
  "lijit.com":                { "owner": { "name": "Sovrn" }, "categories": ["Advertising"], "prevalence": 0.026 },
  "addthis.com":              { "owner": { "name": "Oracle" }, "categories": ["Social Network","Advertising"], "prevalence": 0.025 },
  "sharethis.com":            { "owner": { "name": "ShareThis" }, "categories": ["Social Network"], "prevalence": 0.024 },
  "mouseflow.com":            { "owner": { "name": "Mouseflow" }, "categories": ["Session Replay"], "prevalence": 0.022 },
  "stripe.com":               { "owner": { "name": "Stripe" }, "categories": ["Online Payment"], "prevalence": 0.021 },
  "paypal.com":               { "owner": { "name": "PayPal" }, "categories": ["Online Payment"], "prevalence": 0.021 },
  "braintreegateway.com":     { "owner": { "name": "PayPal" }, "categories": ["Online Payment"], "prevalence": 0.018 },
  "newrelic.com":             { "owner": { "name": "New Relic" }, "categories": ["Analytics"], "prevalence": 0.017 },
  "fingerprintjs.com":        { "owner": { "name": "FingerprintJS" }, "categories": ["Ad Motivated Tracking"], "prevalence": 0.015 },
  "fpjs.pro":                 { "owner": { "name": "FingerprintJS" }, "categories": ["Ad Motivated Tracking"], "prevalence": 0.014 },
  "h.online-metrix.net":      { "owner": { "name": "LexisNexis" }, "categories": ["Ad Motivated Tracking"], "prevalence": 0.013 },
  "bazaarvoice.com":          { "owner": { "name": "Bazaarvoice" }, "categories": ["Analytics"], "prevalence": 0.012 },
  "trustarc.com":             { "owner": { "name": "TrustArc" }, "categories": ["Analytics"], "prevalence": 0.012 },
  "onetrust.com":             { "owner": { "name": "OneTrust" }, "categories": ["Analytics"], "prevalence": 0.011 },
  "tiqcdn.com":               { "owner": { "name": "Tealium" }, "categories": ["Tag Manager"], "prevalence": 0.011 },
  "tealiumiq.com":            { "owner": { "name": "Tealium" }, "categories": ["Tag Manager","Analytics"], "prevalence": 0.010 },
  "mparticle.com":            { "owner": { "name": "mParticle" }, "categories": ["Analytics"], "prevalence": 0.010 },
  "lytics.io":                { "owner": { "name": "Lytics" }, "categories": ["Analytics"], "prevalence": 0.009 },
  "contentsquare.net":        { "owner": { "name": "ContentSquare" }, "categories": ["Session Replay","Analytics"], "prevalence": 0.009 },
  "clicktale.net":            { "owner": { "name": "Contentsquare" }, "categories": ["Session Replay"], "prevalence": 0.009 },
  "mouseflow.com":            { "owner": { "name": "Mouseflow" }, "categories": ["Session Replay"], "prevalence": 0.008 },
  "cdn.speedcurve.com":       { "owner": { "name": "SpeedCurve" }, "categories": ["Analytics"], "prevalence": 0.008 },
  "driftt.com":               { "owner": { "name": "Drift" }, "categories": ["Customer Interaction"], "prevalence": 0.008 },
  "drift.com":                { "owner": { "name": "Drift" }, "categories": ["Customer Interaction"], "prevalence": 0.008 },
  "zendesk.com":              { "owner": { "name": "Zendesk" }, "categories": ["Customer Interaction"], "prevalence": 0.007 },
  "zopim.com":                { "owner": { "name": "Zendesk" }, "categories": ["Customer Interaction"], "prevalence": 0.007 },
  "crisp.chat":               { "owner": { "name": "Crisp IM" }, "categories": ["Customer Interaction"], "prevalence": 0.007 },
  "freshdesk.com":            { "owner": { "name": "Freshworks" }, "categories": ["Customer Interaction"], "prevalence": 0.006 },
  "freshchat.com":            { "owner": { "name": "Freshworks" }, "categories": ["Customer Interaction"], "prevalence": 0.006 },
  "hubspot.com":              { "owner": { "name": "HubSpot" }, "categories": ["Email Marketing","Analytics"], "prevalence": 0.006 },
  "hs-scripts.com":           { "owner": { "name": "HubSpot" }, "categories": ["Email Marketing","Analytics"], "prevalence": 0.006 },
  "hs-analytics.net":         { "owner": { "name": "HubSpot" }, "categories": ["Analytics"], "prevalence": 0.005 },
  "klaviyo.com":              { "owner": { "name": "Klaviyo" }, "categories": ["Email Marketing"], "prevalence": 0.005 },
  "mailchimp.com":            { "owner": { "name": "Mailchimp" }, "categories": ["Email Marketing"], "prevalence": 0.005 },
  "mc.us2.list-manage.com":   { "owner": { "name": "Mailchimp" }, "categories": ["Email Marketing"], "prevalence": 0.004 },
  "brevo.com":                { "owner": { "name": "Brevo (Sendinblue)" }, "categories": ["Email Marketing"], "prevalence": 0.004 },
  "hs-banner.com":            { "owner": { "name": "HubSpot" }, "categories": ["Analytics"], "prevalence": 0.004 },
  "optimizely.com":           { "owner": { "name": "Optimizely" }, "categories": ["Analytics"], "prevalence": 0.004 },
  "launchdarkly.com":         { "owner": { "name": "LaunchDarkly" }, "categories": ["Analytics"], "prevalence": 0.003 },
  "split.io":                 { "owner": { "name": "Split" }, "categories": ["Analytics"], "prevalence": 0.003 },
  "marketo.net":              { "owner": { "name": "Adobe Marketo" }, "categories": ["Email Marketing","Advertising"], "prevalence": 0.003 },
  "mkto-ab12345.com":         { "owner": { "name": "Adobe Marketo" }, "categories": ["Email Marketing"], "prevalence": 0.003 },
  "bizible.com":              { "owner": { "name": "Adobe" }, "categories": ["Advertising","Analytics"], "prevalence": 0.003 },
  "pardot.com":               { "owner": { "name": "Salesforce" }, "categories": ["Email Marketing","Analytics"], "prevalence": 0.003 },
  "salesforceliveagent.com":  { "owner": { "name": "Salesforce" }, "categories": ["Customer Interaction"], "prevalence": 0.002 },
  "osano.com":                { "owner": { "name": "Osano" }, "categories": ["Analytics"], "prevalence": 0.002 },
  "cookiebot.com":            { "owner": { "name": "Cybot A/S" }, "categories": ["Analytics"], "prevalence": 0.002 },
  "didomi.io":                { "owner": { "name": "Didomi" }, "categories": ["Analytics"], "prevalence": 0.002 }
};

async function parseDuckDuckGo(offline) {
  log('Source 2 : DuckDuckGo Tracker Radar…');
  let raw;
  if (offline) {
    raw = DDG_SNAPSHOT;
    log('  → snapshot offline');
  } else {
    try {
      const text = await fetchURL(DDG_DOMAINS_URL);
      raw = JSON.parse(text);
      log('  → téléchargé');
    } catch (e) {
      warn(`  → échec réseau (${e.message}), fallback snapshot`);
      raw = DDG_SNAPSHOT;
    }
  }

  const entries = {};

  for (const [domain, data] of Object.entries(raw)) {
    if (!domain || domain.length < 3) continue;
    const cleanDomain = domain.replace(/^www\./, '').toLowerCase().trim();
    const categories = data.categories || [];
    const primaryCat = categories[0] || 'Unknown';

    entries[cleanDomain] = {
      name: data.displayName || data.owner?.displayName || cleanDomain,
      owner: data.owner?.name || data.owner?.displayName || '?',
      category: normalizeCategory(primaryCat),
      risk: normalizeRisk(primaryCat),
      prevalence: data.prevalence || 0,
      sources: ['duckduckgo']
    };
  }

  log(`  → ${Object.keys(entries).length} domaines extraits`);
  return entries;
}

// ─────────────────────────────────────────────────────────────
// Source 3 — EasyPrivacy (format hosts / adblock)
// ─────────────────────────────────────────────────────────────

const EASYPRIVACY_URL = 'https://easylist.to/easylist/easyprivacy.txt';

// Snapshot des domaines EasyPrivacy les plus bloqués
const EASYPRIVACY_SNAPSHOT = [
  'trackingmachine.com', 'tracking.openx.net', 'pixel.advertising.com',
  'pixel.quantserve.com', 'beacon.krxd.net', 'stags.bluekai.com',
  'analytics.yahoo.com', 'ad.doubleclick.net', 'pixel.facebook.com',
  'tr.snapchat.com', 'pixel.twitter.com', 'ct.pinterest.com',
  'px.ads.linkedin.com', 'analytics.google.com', 'stats.g.doubleclick.net',
  'bat.bing.com', 'sc.omtrdc.net', 'b.scorecardresearch.com',
  'cdn.heapanalytics.com', 'api.mixpanel.com', 'cdn.mxpnl.com',
  'cdn2.hubspot.net', 'js.hs-scripts.com', 'js.hsleadflows.net',
  'track.customer.io', 'e.customerio.com', 'api.segment.io',
  'cdn.segment.com', 'cdn.amplitude.com', 'api.amplitude.com',
  'cdn.rudderlabs.com', 'dataplane.rudderstack.com', 'events.launchdarkly.com',
  'app.launchdarkly.com', 'events.split.io', 'sdk.split.io',
  'cdn.optimizely.com', 'logx.optimizely.com', 'api.rollbar.com',
  'browser.sentry-cdn.com', 'js.sentry-cdn.com', 'cdn.logrocket.io',
  'cdn.logrocket.com', 'r.lr-ingest.io', 'r.logr-ingest.com',
  'cdn.mouseflow.com', 'a.clarity.ms', 'c.clarity.ms',
  'analytics.pinterest.com', 'log.pinterest.com', 'pdst.fm',
  'pagead2.googlesyndication.com', 'www3.doubleclick.net',
  'consent.cookiebot.com', 'consentcdn.cookiebot.com',
  'app.didomi.io', 'sdk.privacy-center.org',
  'ping.chartbeat.net', 'static.chartbeat.com',
  'srv.clickfuse.com', 'sync.mathtag.com', 'cm.mgid.com',
  'rb.mgid.com', 'cm.adform.net', 'track.adform.net',
  'cm.g.doubleclick.net', 'id5-sync.com', 'lexicon.33across.com',
  'ssum.casalemedia.com', 'image4.pubmatic.com', 'ads.yahoo.com',
  'gem.godaddy.com', 'img.prfct.co', 'events.framer.com',
  'js.usemessages.com', 'widget.intercom.io', 'nexus.ensighten.com',
  'tag.demandbase.com', 'api.demandbase.com', 'collect.mopinion.com',
  'js.mopinion.com', 'api.contentsquare.net', 'tag.contentsquare.com',
  'analytics.tiktok.com', 'business-api.tiktok.com', 'gtag.js',
  'cdn.getbeamer.com', 'app.getbeamer.com', 'static.zdassets.com',
  'ekr.zdassets.com', 'v2.zopim.com', 'widget.freshworks.com',
  'wchat.freshchat.com', 'client.crisp.chat', 'settings.crisp.chat',
  'api.giosg.com', 'ps.giosg.com', 'cdn.livechatinc.com',
  'api.livechatinc.com', 'a.klaviyo.com', 'b.klaviyo.com',
  'cdn-images.mailchimp.com', 'links.iterable.com', 'js.appboycdn.com',
  'sdk.iad-01.braze.com', 'js.braze.com', 'cdn.braze.eu'
];

async function parseEasyPrivacy(offline) {
  log('Source 3 : EasyPrivacy…');
  let domains;

  if (offline) {
    domains = EASYPRIVACY_SNAPSHOT;
    log('  → snapshot offline');
  } else {
    try {
      const text = await fetchURL(EASYPRIVACY_URL);
      // Parser les règles de type "||domain.tld^"
      const lines = text.split('\n');
      domains = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('!') || trimmed.startsWith('[') || trimmed === '') continue;
        // Extraire le domaine des règles ||domain.tld^
        const match = trimmed.match(/^\|\|([a-z0-9._-]+)\^/);
        if (match) {
          const d = match[1].replace(/^www\./, '').toLowerCase();
          if (d.includes('.') && d.length > 4) domains.push(d);
        }
      }
      log(`  → ${domains.length} domaines extraits du fichier`);
    } catch (e) {
      warn(`  → échec réseau (${e.message}), fallback snapshot`);
      domains = EASYPRIVACY_SNAPSHOT;
    }
  }

  const entries = {};
  for (const domain of domains) {
    const clean = domain.toLowerCase().replace(/^www\./, '').trim();
    if (!clean || clean.length < 4) continue;
    if (!entries[clean]) {
      entries[clean] = {
        name: clean,
        owner: '?',
        category: 'advertising',
        risk: 'medium',
        prevalence: 0,
        sources: ['easyprivacy']
      };
    }
  }

  log(`  → ${Object.keys(entries).length} domaines uniques`);
  return entries;
}

// ─────────────────────────────────────────────────────────────
// Source 4 — Overrides manuels (descriptions FR + risques)
// ─────────────────────────────────────────────────────────────

async function loadOverrides() {
  const filePath = path.join(SRC, 'trackers-overrides.json');
  if (!fs.existsSync(filePath)) {
    warn('trackers-overrides.json introuvable, ignoré');
    return {};
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  log(`Overrides : ${Object.keys(raw).length} entrées chargées`);
  return raw;
}

// ─────────────────────────────────────────────────────────────
// Fusion + déduplication
// ─────────────────────────────────────────────────────────────

function mergeEntries(disconnect, ddg, easyprivacy, overrides) {
  log('Fusion des sources…');

  // Priorité : overrides > ddg (prevalence) > disconnect > easyprivacy
  const merged = {};

  // 1. EasyPrivacy (priorité la plus basse)
  for (const [domain, data] of Object.entries(easyprivacy)) {
    merged[domain] = { ...data };
  }

  // 2. Disconnect
  for (const [domain, data] of Object.entries(disconnect)) {
    if (merged[domain]) {
      merged[domain] = {
        ...merged[domain],
        ...data,
        sources: [...new Set([...(merged[domain].sources || []), ...(data.sources || [])])],
        prevalence: Math.max(merged[domain].prevalence || 0, data.prevalence || 0)
      };
    } else {
      merged[domain] = { ...data };
    }
  }

  // 3. DuckDuckGo (prevalence + owner fiable)
  for (const [domain, data] of Object.entries(ddg)) {
    if (merged[domain]) {
      merged[domain] = {
        ...merged[domain],
        ...data,
        // Garder le meilleur owner
        owner: data.owner !== '?' ? data.owner : merged[domain].owner,
        sources: [...new Set([...(merged[domain].sources || []), ...(data.sources || [])])],
        prevalence: Math.max(merged[domain].prevalence || 0, data.prevalence || 0)
      };
    } else {
      merged[domain] = { ...data };
    }
  }

  // 4. Overrides (priorité maximale — écrase tout)
  for (const [domain, data] of Object.entries(overrides)) {
    merged[domain] = {
      ...(merged[domain] || {}),
      ...data,
      sources: [...new Set([...((merged[domain] || {}).sources || []), 'override'])]
    };
  }

  log(`Fusion : ${Object.keys(merged).length} domaines uniques`);
  return merged;
}

// ─────────────────────────────────────────────────────────────
// Construction de la DB finale
// ─────────────────────────────────────────────────────────────

function buildFinalDB(merged) {
  // Construire deux index pour le matching O(1)
  // exactIndex : domain -> entry (lookup direct)
  // suffixIndex : tld+1 -> [entries] (pour subdomain matching)

  const exactIndex = {};
  const suffixIndex = {};

  for (const [domain, data] of Object.entries(merged)) {
    const entry = {
      n: data.name || domain,      // name (compressé)
      o: data.owner || '?',        // owner
      c: data.category || 'other', // category
      r: data.risk || 'medium',    // risk
      p: Math.round((data.prevalence || 0) * 1000) / 1000, // prevalence
      s: (data.sources || []).join(','), // sources
      ...(data.description ? { d: data.description } : {}),
      ...(data.icon ? { i: data.icon } : {})
    };

    exactIndex[domain] = entry;

    // Construire l'index de suffixe (domaine racine = derniers deux segments)
    const parts = domain.split('.');
    if (parts.length >= 2) {
      const root = parts.slice(-2).join('.');
      if (!suffixIndex[root]) suffixIndex[root] = [];
      if (!suffixIndex[root].includes(domain)) {
        suffixIndex[root].push(domain);
      }
    }
  }

  return {
    version: new Date().toISOString().split('T')[0],
    count: Object.keys(exactIndex).length,
    exactIndex,
    suffixIndex,
    meta: {
      categories: {
        advertising: 'Publicité',
        analytics: 'Analytique',
        social: 'Réseaux sociaux',
        'tag-manager': 'Gestionnaire de balises',
        'session-replay': 'Enregistrement de session',
        fingerprinting: 'Fingerprinting',
        support: 'Support client',
        auth: 'Authentification',
        payment: 'Paiement',
        infrastructure: 'Infrastructure',
        marketing: 'E-mail marketing',
        content: 'Contenu embarqué',
        other: 'Autre'
      },
      risks: {
        low: { label: 'Faible', color: '#22c55e' },
        medium: { label: 'Modéré', color: '#f59e0b' },
        high: { label: 'Élevé', color: '#ef4444' }
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Point d'entrée
// ─────────────────────────────────────────────────────────────

async function main() {
  log(`=== TrackMap — Build trackers DB ===`);
  log(`Mode : ${OFFLINE ? 'offline (snapshots)' : 'online'}`);
  log('');

  const [disconnect, ddg, easyprivacy, overrides] = await Promise.all([
    parseDisconnect(OFFLINE),
    parseDuckDuckGo(OFFLINE),
    parseEasyPrivacy(OFFLINE),
    loadOverrides()
  ]);

  const merged = mergeEntries(disconnect, ddg, easyprivacy, overrides);
  const db = buildFinalDB(merged);

  if (STATS) {
    log('');
    log('=== Statistiques ===');
    const byRisk = { high: 0, medium: 0, low: 0 };
    const byCat = {};
    const bySrc = {};
    for (const entry of Object.values(db.exactIndex)) {
      byRisk[entry.r] = (byRisk[entry.r] || 0) + 1;
      byCat[entry.c] = (byCat[entry.c] || 0) + 1;
      for (const src of (entry.s || '').split(',')) {
        bySrc[src] = (bySrc[src] || 0) + 1;
      }
    }
    log(`Total domaines : ${db.count}`);
    log(`Risque élevé   : ${byRisk.high}`);
    log(`Risque modéré  : ${byRisk.medium}`);
    log(`Risque faible  : ${byRisk.low}`);
    log('');
    log('Par catégorie :');
    for (const [cat, n] of Object.entries(byCat).sort((a,b) => b[1]-a[1])) {
      log(`  ${cat.padEnd(20)} ${n}`);
    }
    log('');
    log('Par source :');
    for (const [src, n] of Object.entries(bySrc).sort((a,b) => b[1]-a[1])) {
      log(`  ${src.padEnd(20)} ${n}`);
    }
  }

  // Écrire le fichier de sortie
  const outPath = path.join(SRC, 'trackers-db-full.json');
  const json = JSON.stringify(db);
  fs.writeFileSync(outPath, json, 'utf8');

  const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
  log('');
  log(`Fichier écrit : ${outPath}`);
  log(`Taille        : ${sizeKB} KB`);
  log(`Domaines      : ${db.count}`);
  log(`Clés suffixe  : ${Object.keys(db.suffixIndex).length}`);
  log('');
  log('Build terminé.');
}

main().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});
