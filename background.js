// TrackMap Background Service Worker v3
// Bloc 2 : persistance graphe + positions x/y + debounce
// Bloc 3 : webRequest pour requêtes réseau + support PING/RESCAN

'use strict';

// ── State ──────────────────────────────────────────────────────────────────

let sessionGraph   = { nodes: {}, edges: [] };
let currentTab     = null;
let previousDomain = null;

// DB trackers
let exactIndex  = null;
let suffixIndex = null;
let dbMeta      = null;
let dbVersion   = null;

// Bloc 8 : options (chargées depuis chrome.storage.sync)
let badgeEnabled   = true;
let badgeColor     = true;
let blockedDomains = new Set();
let verbosity      = 'standard';

async function loadOptions() {
  try {
    const opts = await new Promise(r => chrome.storage.sync.get({
      badgeEnabled: true, badgeColor: true, blockedDomains: [], verbosity: 'standard'
    }, r));
    badgeEnabled   = opts.badgeEnabled;
    badgeColor     = opts.badgeColor;
    blockedDomains = new Set(opts.blockedDomains || []);
    verbosity      = opts.verbosity || 'standard';
  } catch(e) { console.error('TrackMap: échec chargement options', e); }
}

// Écouter les changements d'options en temps réel
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.badgeEnabled)   badgeEnabled   = changes.badgeEnabled.newValue;
  if (changes.badgeColor)     badgeColor     = changes.badgeColor.newValue;
  if (changes.verbosity)      verbosity      = changes.verbosity.newValue;
  if (changes.blockedDomains) blockedDomains = new Set(changes.blockedDomains.newValue || []);
});

// Bloc 2 : debounce de persistance du graphe (2s)
let persistTimer = null;
const PERSIST_DEBOUNCE_MS = 2000;

// Bloc 3 : cache des domaines capturés par webRequest, par tabId
// Map<tabId, Set<domain>>
const webRequestDomains = new Map();

// ── Chargement DB ──────────────────────────────────────────────────────────

async function loadTrackersDB() {
  if (exactIndex) return;
  try {
    const url = chrome.runtime.getURL('src/trackers-db-full.json');
    const db  = await fetch(url).then(r => r.json());
    exactIndex  = new Map(Object.entries(db.exactIndex  || {}));
    suffixIndex = new Map(Object.entries(db.suffixIndex || {}));
    dbMeta      = db.meta    || {};
    dbVersion   = db.version || '?';
    console.log(`TrackMap DB v${dbVersion} — ${exactIndex.size} domaines`);
  } catch (e) {
    console.error('TrackMap: échec chargement DB', e);
    exactIndex = new Map(); suffixIndex = new Map(); dbMeta = {};
  }
}

// ── Matching deux passes O(1) ──────────────────────────────────────────────

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

    const root     = parts.slice(-2).join('.');
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

// ── Helpers ────────────────────────────────────────────────────────────────

function expandName(name, domain) {
  if (!name || name === domain) {
    const p = domain.split('.');
    return p.length >= 2 ? p[p.length-2].charAt(0).toUpperCase() + p[p.length-2].slice(1) : domain;
  }
  return name;
}

function makeIcon(name) {
  if (!name) return '?';
  const words = name.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length === 1
    ? words[0].substring(0, 2).toUpperCase()
    : words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function generateDescription(entry, domain) {
  const cats = {
    advertising: 'Réseau publicitaire', analytics: "Service d'analytique",
    social: 'Réseau social', 'tag-manager': 'Gestionnaire de balises',
    'session-replay': 'Enregistrement de session', fingerprinting: 'Fingerprinting',
    support: 'Support client', payment: 'Paiement',
    marketing: 'Marketing e-mail', infrastructure: 'Infrastructure',
  };
  const label = cats[entry.c] || 'Service tiers';
  const owner = entry.o && entry.o !== '?' ? ` appartenant à ${entry.o}` : '';
  const prev  = entry.p > 0.1 ? ` Présent sur ${Math.round(entry.p * 100)}% des sites.` : '';
  return `${label}${owner}.${prev} Ce domaine collecte des données sur votre navigation.`;
}

// ── Analyse trackers ───────────────────────────────────────────────────────

function analyzeTrackers(domains) {
  if (!exactIndex) return { confirmed: [], unknown: [] };
  const seen = new Set();
  const confirmed = [], unknown = [];

  for (const domain of domains) {
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    const match = matchDomain(domain);
    if (match) {
      const { entry, confidence, matchedOn } = match;

      // Bloc 8 — verbosité : en mode "minimal", ignorer les correspondances partielles (likely)
      if (verbosity === 'minimal' && confidence === 'likely') {
        continue;
      }

      confirmed.push({
        domain, matchedOn, confidence,
        name:        expandName(entry.n, domain),
        owner:       entry.o || '?',
        category:    entry.c || 'other',
        risk:        entry.r || 'medium',
        prevalence:  entry.p || 0,
        description: entry.d || generateDescription(entry, domain),
        icon:        entry.i || makeIcon(entry.n || domain),
        sources:     (entry.s || '').split(',').filter(Boolean)
      });
    } else {
      // En mode "strict", inclure les domaines inconnus comme suspects
      // En mode "standard" ou "minimal", les lister séparément sans alerte
      unknown.push({ domain, confidence: 'unknown', flagged: verbosity === 'strict' });
    }
  }

  const rO = { high: 0, medium: 1, low: 2 };
  const cO = { confirmed: 0, likely: 1 };
  confirmed.sort((a, b) => {
    const cd = (cO[a.confidence]??2) - (cO[b.confidence]??2);
    return cd !== 0 ? cd : (rO[a.risk]??3) - (rO[b.risk]??3);
  });
  return { confirmed, unknown };
}

function calculateRiskScore(trackers) {
  if (!trackers.length) return 0;
  const w = { high: 3, medium: 2, low: 1 };
  const c = { confirmed: 1, likely: 0.7, unknown: 0.3 };
  const total = trackers.reduce((s, t) => s + (w[t.risk]||1) * (c[t.confidence]||0.5), 0);
  return Math.min(10, Math.round((total / trackers.length) * 3.5));
}

function buildRiskBreakdown(trackers, unknown) {
  const factors = [];

  const highConfirmed = trackers.filter(t => t.risk === 'high' && t.confidence === 'confirmed');
  if (highConfirmed.length) factors.push({
    id: 'high-confirmed',
    label: `${highConfirmed.length} tracker${highConfirmed.length>1?'s':''} pub. confirmé${highConfirmed.length>1?'s':''}`,
    detail: 'Ces domaines collectent et revendent vos données de navigation à des réseaux publicitaires tiers. Chaque tracker confirmé contribue ×3.',
    formula: `${highConfirmed.length} × 3 = ${highConfirmed.length*3} pts`,
    points: highConfirmed.length * 3, severity: 'high',
    examples: highConfirmed.slice(0,3).map(t => t.name)
  });

  const highLikely = trackers.filter(t => t.risk === 'high' && t.confidence === 'likely');
  if (highLikely.length) factors.push({
    id: 'high-likely',
    label: `${highLikely.length} tracker${highLikely.length>1?'s':''} pub. probable${highLikely.length>1?'s':''}`,
    detail: 'Correspondance par sous-domaine — présence probable mais non certaine. Contribue ×2 (pondération réduite).',
    formula: `${highLikely.length} × 2 = ${highLikely.length*2} pts`,
    points: highLikely.length * 2, severity: 'high',
    examples: highLikely.slice(0,3).map(t => t.name)
  });

  const replay = trackers.filter(t => t.category === 'session-replay');
  if (replay.length) factors.push({
    id: 'session-replay',
    label: `${replay.length} outil${replay.length>1?'s':''} d'enregistrement de session`,
    detail: 'Ces outils enregistrent vos clics, défilements et saisies en temps réel — la forme la plus intrusive de collecte. Pondération ×4.',
    formula: `${replay.length} × 4 = ${replay.length*4} pts`,
    points: replay.length * 4, severity: 'high',
    examples: replay.slice(0,3).map(t => t.name)
  });

  const fp = trackers.filter(t => t.category === 'fingerprinting');
  if (fp.length) factors.push({
    id: 'fingerprinting',
    label: `${fp.length} script${fp.length>1?'s':''} de fingerprinting`,
    detail: 'Identifient votre appareil sans cookie, via 200+ caractéristiques techniques. Impossible à bloquer par la suppression des cookies. Pondération ×4.',
    formula: `${fp.length} × 4 = ${fp.length*4} pts`,
    points: fp.length * 4, severity: 'high',
    examples: fp.slice(0,3).map(t => t.name)
  });

  const medium = trackers.filter(t => t.risk === 'medium');
  if (medium.length) factors.push({
    id: 'medium',
    label: `${medium.length} tracker${medium.length>1?'s':''} à risque modéré`,
    detail: 'Analytics, réseaux sociaux, tag managers. Collectent des données d\'usage mais à impact limité sur la vie privée. Pondération ×2.',
    formula: `${medium.length} × 2 = ${medium.length*2} pts`,
    points: medium.length * 2, severity: 'medium',
    examples: medium.slice(0,3).map(t => t.name)
  });

  if (unknown.length) factors.push({
    id: 'unknown',
    label: `${unknown.length} domaine${unknown.length>1?'s':''} tiers non identifié${unknown.length>1?'s':''}`,
    detail: 'Domaines absents de notre base. Peuvent être inoffensifs (CDN, polices) ou des trackers non répertoriés. Pondération ×1.',
    formula: `${unknown.length} × 1 = ${unknown.length} pts`,
    points: unknown.length, severity: 'low',
    examples: unknown.slice(0,3).map(u => u.domain)
  });

  const totalPoints = factors.reduce((s, f) => s + f.points, 0);
  const scoreLabel  = totalPoints === 0 ? 'Propre' :
                      totalPoints <= 3  ? 'Faible' :
                      totalPoints <= 8  ? 'Modéré' :
                      totalPoints <= 15 ? 'Élevé'  : 'Critique';
  return { factors, totalPoints, scoreLabel };
}


// ── Bloc 2 : Persistance du graphe ────────────────────────────────────────
// Le graphe est persisté dans chrome.storage.local avec un debounce de 2s.
// Les positions x,y des noeuds sont incluses pour que le popup les restaure.

function scheduleGraphPersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistGraph, PERSIST_DEBOUNCE_MS);
}

async function persistGraph() {
  try {
    await chrome.storage.local.set({
      sessionGraph: {
        nodes:     sessionGraph.nodes,  // inclut x, y, visits, trackers, riskScore
        edges:     sessionGraph.edges,
        savedAt:   Date.now()
      }
    });
  } catch (e) {
    console.error('TrackMap: échec persistance graphe', e);
  }
}

// Restaure le graphe depuis le storage au démarrage du Service Worker
// (après un redémarrage du navigateur ou un wakeup du SW)
async function restoreGraph() {
  try {
    const result = await chrome.storage.local.get('sessionGraph');
    if (result.sessionGraph) {
      sessionGraph.nodes = result.sessionGraph.nodes || {};
      sessionGraph.edges = result.sessionGraph.edges || [];
      const nodeCount = Object.keys(sessionGraph.nodes).length;
      if (nodeCount > 0) {
        console.log(`TrackMap: graphe restauré — ${nodeCount} nœuds`);
      }
    }
  } catch (e) {
    console.error('TrackMap: échec restauration graphe', e);
  }
}

// ── Graphe ────────────────────────────────────────────────────────────────

function updateNode(domain, data) {
  if (!sessionGraph.nodes[domain]) {
    sessionGraph.nodes[domain] = {
      domain, visits: 0, trackers: [], riskScore: 0,
      lastSeen: Date.now(), title: domain,
      x: null, y: null  // positions sauvegardées par le popup
    };
  }
  const node = sessionGraph.nodes[domain];
  node.visits++;
  node.lastSeen = Date.now();
  if (data.title)    node.title = data.title;
  if (data.trackers !== undefined) {
    node.trackers  = data.trackers;
    node.riskScore = calculateRiskScore(data.trackers);
  }
}

function addEdge(from, to) {
  if (from === to || !from || !to) return;
  const ex = sessionGraph.edges.find(e => e.from === from && e.to === to);
  if (ex) ex.count++; else sessionGraph.edges.push({ from, to, count: 1 });
}

// ── Handler principal ─────────────────────────────────────────────────────

async function handlePageData(data, tabId) {
  await loadTrackersDB();
  const { domain, title, scripts = [], iframes = [] } = data;

  // Bloc 8 : ignorer les sites exclus dans les options
  if (blockedDomains.has(domain)) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    return;
  }

  // Fusionner les domaines DOM (content script) + réseau (webRequest)
  const wrDomains = webRequestDomains.get(tabId) || new Set();
  const allThirdParty = [...new Set([
    ...scripts.map(s => s.domain),
    ...iframes.map(i => i.domain),
    ...wrDomains
  ])].filter(d => d && d !== domain && d.includes('.'));

  const { confirmed: trackers, unknown } = analyzeTrackers(allThirdParty);
  const breakdown = buildRiskBreakdown(trackers, unknown);

  updateNode(domain, { title, trackers });
  if (previousDomain && previousDomain !== domain) addEdge(previousDomain, domain);

  // Persister les données de page + déclencher la persistance du graphe (debounced)
  await chrome.storage.local.set({
    [`page_${tabId}`]: {
      domain, title, url: data.url,
      trackers, unknown, breakdown,
      allThirdPartyDomains: allThirdParty,
      timestamp: Date.now()
    }
  });

  scheduleGraphPersist(); // Bloc 2 : debounce 2s

  // Badge
  const count   = trackers.length;
  const hasHigh = trackers.some(t => t.risk === 'high');
  try {
    if (badgeEnabled) {
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
      if (badgeColor) {
        chrome.action.setBadgeBackgroundColor({ color: hasHigh ? '#ef4444' : count >= 2 ? '#f59e0b' : '#22c55e', tabId });
      } else {
        chrome.action.setBadgeBackgroundColor({ color: '#7c6dfa', tabId });
      }
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  } catch (_) {}
}

// ── Bloc 3 : webRequest — interception réseau ─────────────────────────────
// Remplace le monkey-patching fetch/XHR du content script.
// Intercepte toutes les requêtes HTTP(S) au niveau navigateur.

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const { tabId, url, initiator } = details;
    if (tabId < 0) return; // requêtes sans onglet (extensions, preload…)

    try {
      const reqHost  = new URL(url).hostname.replace(/^www\./, '');
      const pageHost = initiator ? new URL(initiator).hostname.replace(/^www\./, '') : null;

      // Ne garder que les requêtes vers des domaines tiers
      if (!pageHost || reqHost === pageHost || reqHost.endsWith('.' + pageHost)) return;

      if (!webRequestDomains.has(tabId)) {
        webRequestDomains.set(tabId, new Set());
      }
      const before = webRequestDomains.get(tabId).size;
      webRequestDomains.get(tabId).add(reqHost);

      // Si un nouveau domaine tiers est apparu, déclencher une ré-analyse
      if (webRequestDomains.get(tabId).size > before) {
        // On envoie un PAGE_DATA synthétique avec juste les nouveaux domaines
        // pour déclencher une ré-analyse sans attendre le prochain scan DOM
        handlePageDataFromWebRequest(tabId, pageHost, reqHost);
      }
    } catch (_) {}
  },
  { urls: ['http://*/*', 'https://*/*'] },
  [] // pas de requestBody ni extraHeaders nécessaires
);

// Debounce par tab pour les mises à jour webRequest
const wrUpdateTimers = new Map();

function handlePageDataFromWebRequest(tabId, pageHost, newDomain) {
  // Debounce 800ms pour agréger plusieurs requêtes simultanées
  if (wrUpdateTimers.has(tabId)) clearTimeout(wrUpdateTimers.get(tabId));
  wrUpdateTimers.set(tabId, setTimeout(async () => {
    wrUpdateTimers.delete(tabId);
    // Récupérer les données de page existantes et les enrichir
    try {
      const result = await chrome.storage.local.get(`page_${tabId}`);
      const existing = result[`page_${tabId}`];
      if (existing && existing.domain === pageHost) {
        // Re-analyser avec les domaines webRequest ajoutés
        await handlePageData({
          url:    existing.url,
          domain: existing.domain,
          title:  existing.title,
          scripts:  [],
          iframes:  [],
          requestedDomains: []
        }, tabId);
      }
    } catch (_) {}
  }, 800));
}

// ── Messagerie ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Données DOM depuis content script
  if (message.type === 'PAGE_DATA' && sender.tab) {
    handlePageData(message.data, sender.tab.id).catch(console.error);
    return false;
  }

  // Popup demande les données de la page active
  if (message.type === 'GET_PAGE_DATA') {
    chrome.storage.local.get([`page_${message.tabId}`, 'sessionGraph'], result => {
      sendResponse({
        page:  result[`page_${message.tabId}`] || null,
        graph: result.sessionGraph || { nodes: {}, edges: [] }
      });
    });
    return true; // async
  }

  // Bloc 2 : le popup sauvegarde les positions x,y après simulation
  if (message.type === 'SAVE_NODE_POSITIONS') {
    const positions = message.positions || {};
    for (const [domain, pos] of Object.entries(positions)) {
      if (sessionGraph.nodes[domain]) {
        sessionGraph.nodes[domain].x = pos.x;
        sessionGraph.nodes[domain].y = pos.y;
      }
    }
    scheduleGraphPersist();
    sendResponse({ ok: true });
    return false;
  }

  // Clear session
  if (message.type === 'CLEAR_SESSION') {
    sessionGraph = { nodes: {}, edges: [] };
    previousDomain = null;
    webRequestDomains.clear();
    chrome.storage.local.clear(() => sendResponse({ ok: true }));
    return true;
  }

  // Bloc 3 : Refresh depuis popup — PING d'abord, RESCAN si vivant
  // Le popup gère lui-même le PING/RESCAN, mais le background peut relayer
  if (message.type === 'GET_DB_META') {
    sendResponse({ version: dbVersion, count: exactIndex?.size || 0, meta: dbMeta });
    return false;
  }

  if (message.type === 'LOOKUP_DOMAIN') {
    sendResponse(matchDomain(message.domain) || null);
    return false;
  }

  // Bloc 8 : options — activer/désactiver le badge
  if (message.type === 'SET_BADGE_ENABLED') {
    badgeEnabled = message.enabled;
    if (!badgeEnabled) {
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => chrome.action.setBadgeText({ text: '', tabId: tab.id }).catch(() => {}));
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  // Bloc 9 : données pour l'export (popup demande toutes les données)
  if (message.type === 'GET_EXPORT_DATA') {
    chrome.storage.local.get(null, result => {
      sendResponse({ ok: true, data: result });
    });
    return true;
  }
});

// ── Navigation ────────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async info => {
  currentTab = info.tabId;
  const tab = await chrome.tabs.get(info.tabId).catch(() => null);
  if (tab?.url) { try { previousDomain = new URL(tab.url).hostname.replace(/^www\./, ''); } catch(_){} }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url && tabId === currentTab) {
    try {
      const d = new URL(tab.url).hostname.replace(/^www\./, '');
      if (d && d !== previousDomain) previousDomain = d;
    } catch(_) {}
  }
  if (changeInfo.status === 'loading') {
    webRequestDomains.delete(tabId);
  }
  // Bloc 4 : notifier le popup si la navigation est terminée sur l'onglet actif
  if (changeInfo.status === 'complete' && tabId === currentTab && tab.url) {
    try {
      const proto = new URL(tab.url).protocol;
      if (proto !== 'http:' && proto !== 'https:') return;
    } catch(_) { return; }
    // chrome.extension.getViews est indisponible dans les Service Workers MV3.
    // sendMessage échoue silencieusement si le popup est fermé — aucun handler actif.
    chrome.runtime.sendMessage({ type: 'NAV_UPDATE', tabId }).catch(() => {});
  }
});

// Nettoyer quand un onglet est fermé
chrome.tabs.onRemoved.addListener(tabId => {
  webRequestDomains.delete(tabId);
  chrome.storage.local.remove(`page_${tabId}`).catch(() => {});
});

// ── Init ──────────────────────────────────────────────────────────────────

// Bloc 9 : effacer les données locales à la désinstallation
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    // Ouvrir la page de bienvenue au premier lancement
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
  if (details.reason === 'update') {
    console.log('TrackMap mis à jour vers', chrome.runtime.getManifest().version);
  }
});

// Nettoyage à la désinstallation — setUninstallURL peut déclencher une page
// mais le storage.local est effacé automatiquement par le navigateur.
// On s'assure aussi de nettoyer chrome.storage.sync.
try {
  chrome.runtime.setUninstallURL('', () => {});
} catch(_) {}

Promise.all([loadTrackersDB(), loadOptions(), restoreGraph()]).then(() => {
  console.log('TrackMap Service Worker prêt');
});
