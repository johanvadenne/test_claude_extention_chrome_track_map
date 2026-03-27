// TrackMap Background Service Worker v2
// Matching O(1) deux passes — exactIndex + suffixIndex

'use strict';

// ── State ──

let sessionGraph   = { nodes: {}, edges: [] };
let currentTab     = null;
let previousDomain = null;
let exactIndex     = null;
let suffixIndex    = null;
let dbMeta         = null;
let dbVersion      = null;

// ── Chargement DB ──

async function loadTrackersDB() {
  if (exactIndex) return;
  try {
    const url = chrome.runtime.getURL('src/trackers-db-full.json');
    const response = await fetch(url);
    const db = await response.json();
    exactIndex  = new Map(Object.entries(db.exactIndex  || {}));
    suffixIndex = new Map(Object.entries(db.suffixIndex || {}));
    dbMeta      = db.meta    || {};
    dbVersion   = db.version || '?';
    console.log(`TrackMap DB v${dbVersion} — ${exactIndex.size} domaines chargés`);
  } catch (e) {
    console.error('TrackMap: échec chargement DB', e);
    exactIndex  = new Map();
    suffixIndex = new Map();
    dbMeta      = {};
  }
}

// ── Matching deux passes O(1) ──

function matchDomain(domain) {
  if (!domain || domain.length < 4) return null;
  const clean = domain.toLowerCase().replace(/^www\./, '');

  // Passe 1 : exacte
  const exact = exactIndex.get(clean);
  if (exact) return { entry: exact, domain: clean, matchedOn: clean, confidence: 'confirmed' };

  // Passe 2 : remontée de segments
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

// ── Helpers ──

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

// ── Analyse ──

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
      unknown.push({ domain, confidence: 'unknown' });
    }
  }

  const riskOrder = { high: 0, medium: 1, low: 2 };
  const confOrder = { confirmed: 0, likely: 1 };
  confirmed.sort((a, b) => {
    const cd = (confOrder[a.confidence]??2) - (confOrder[b.confidence]??2);
    return cd !== 0 ? cd : (riskOrder[a.risk]??3) - (riskOrder[b.risk]??3);
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
  const high   = trackers.filter(t => t.risk === 'high' && t.confidence === 'confirmed');
  const medium = trackers.filter(t => t.risk === 'medium');
  const replay = trackers.filter(t => t.category === 'session-replay');
  const fp     = trackers.filter(t => t.category === 'fingerprinting');
  if (high.length)   factors.push({ label: `${high.length} tracker${high.length>1?'s':''} pub. à risque élevé`,       points: high.length*3,   severity: 'high'   });
  if (replay.length) factors.push({ label: `${replay.length} outil${replay.length>1?'s':''} d'enregistrement session`, points: replay.length*4, severity: 'high'   });
  if (fp.length)     factors.push({ label: `${fp.length} script${fp.length>1?'s':''} de fingerprinting`,               points: fp.length*4,     severity: 'high'   });
  if (medium.length) factors.push({ label: `${medium.length} tracker${medium.length>1?'s':''} à risque modéré`,         points: medium.length*2, severity: 'medium' });
  if (unknown.length)factors.push({ label: `${unknown.length} domaine${unknown.length>1?'s':''} tiers non identifiés`,  points: unknown.length,  severity: 'low'    });
  return factors;
}

// ── Graphe ──

function updateNode(domain, data) {
  if (!sessionGraph.nodes[domain]) {
    sessionGraph.nodes[domain] = { domain, visits: 0, trackers: [], riskScore: 0, lastSeen: Date.now(), title: domain, x: null, y: null };
  }
  const node = sessionGraph.nodes[domain];
  node.visits++;
  node.lastSeen = Date.now();
  if (data.title) node.title = data.title;
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

// ── Handler principal ──

async function handlePageData(data, tabId) {
  await loadTrackersDB();
  const { domain, title, requestedDomains = [], scripts = [], iframes = [] } = data;

  const allThirdParty = [...new Set([
    ...requestedDomains,
    ...scripts.map(s => s.domain),
    ...iframes.map(i => i.domain)
  ])].filter(d => d && d !== domain && d.includes('.'));

  const { confirmed: trackers, unknown } = analyzeTrackers(allThirdParty);
  const breakdown = buildRiskBreakdown(trackers, unknown);

  updateNode(domain, { title, trackers });
  if (previousDomain && previousDomain !== domain) addEdge(previousDomain, domain);

  await chrome.storage.local.set({
    [`page_${tabId}`]: { domain, title, url: data.url, trackers, unknown, breakdown, allThirdPartyDomains: allThirdParty, timestamp: Date.now() },
    sessionGraph: { nodes: sessionGraph.nodes, edges: sessionGraph.edges }
  });

  const count   = trackers.length;
  const hasHigh = trackers.some(t => t.risk === 'high');
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
  chrome.action.setBadgeBackgroundColor({ color: hasHigh ? '#ef4444' : count >= 2 ? '#f59e0b' : '#22c55e', tabId });
}

// ── Messagerie ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_DATA' && sender.tab) {
    handlePageData(message.data, sender.tab.id).catch(console.error);
    return false;
  }
  if (message.type === 'GET_PAGE_DATA') {
    chrome.storage.local.get([`page_${message.tabId}`, 'sessionGraph'], result => {
      sendResponse({ page: result[`page_${message.tabId}`] || null, graph: result.sessionGraph || { nodes:{}, edges:[] } });
    });
    return true;
  }
  if (message.type === 'CLEAR_SESSION') {
    sessionGraph = { nodes:{}, edges:[] };
    previousDomain = null;
    chrome.storage.local.clear(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'GET_DB_META') {
    sendResponse({ version: dbVersion, count: exactIndex?.size || 0, meta: dbMeta });
    return false;
  }
  if (message.type === 'LOOKUP_DOMAIN') {
    sendResponse(matchDomain(message.domain) || null);
    return false;
  }
});

// ── Navigation ──

chrome.tabs.onActivated.addListener(async info => {
  currentTab = info.tabId;
  const tab = await chrome.tabs.get(info.tabId).catch(() => null);
  if (tab?.url) { try { previousDomain = new URL(tab.url).hostname; } catch(e){} }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url && tabId === currentTab) {
    try { const d = new URL(tab.url).hostname; if (d && d !== previousDomain) previousDomain = d; } catch(e){}
  }
});

loadTrackersDB();
