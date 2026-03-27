// TrackMap Background Service Worker
// Agrège les données de navigation, construit le graphe de session

'use strict';

// --- State ---
let sessionGraph = {
  nodes: {},   // domain -> { domain, visits, trackers, riskScore, lastSeen, title }
  edges: []    // { from, to, count }
};

let currentTab = null;
let previousDomain = null;
let trackersDB = null;

// --- Load trackers database ---
async function loadTrackersDB() {
  try {
    const url = chrome.runtime.getURL('src/trackers-db.json');
    const response = await fetch(url);
    trackersDB = await response.json();
  } catch (e) {
    console.error('TrackMap: Failed to load trackers DB', e);
    trackersDB = { trackers: {}, riskLevels: {}, categories: {} };
  }
}

// --- Analyze trackers for a domain list ---
function analyzeTrackers(domains) {
  const found = [];
  const db = trackersDB?.trackers || {};

  domains.forEach(domain => {
    // Exact match
    if (db[domain]) {
      found.push({ domain, ...db[domain] });
      return;
    }
    // Partial match (subdomain)
    for (const key of Object.keys(db)) {
      if (domain.endsWith(key) || domain.includes(key)) {
        found.push({ domain, ...db[key] });
        return;
      }
    }
  });

  return found;
}

// --- Calculate risk score ---
function calculateRiskScore(trackers) {
  if (!trackers.length) return 0;
  const weights = { high: 3, medium: 2, low: 1 };
  const total = trackers.reduce((sum, t) => sum + (weights[t.risk] || 1), 0);
  return Math.min(10, Math.round((total / trackers.length) * 3.3));
}

// --- Add or update a node in the graph ---
function updateNode(domain, data) {
  if (!sessionGraph.nodes[domain]) {
    sessionGraph.nodes[domain] = {
      domain,
      visits: 0,
      trackers: [],
      riskScore: 0,
      lastSeen: Date.now(),
      title: domain
    };
  }
  const node = sessionGraph.nodes[domain];
  node.visits++;
  node.lastSeen = Date.now();
  if (data.title) node.title = data.title;
  if (data.trackers) {
    node.trackers = data.trackers;
    node.riskScore = calculateRiskScore(data.trackers);
  }
}

// --- Add edge between two domains ---
function addEdge(from, to) {
  if (from === to || !from || !to) return;
  const existing = sessionGraph.edges.find(e => e.from === from && e.to === to);
  if (existing) {
    existing.count++;
  } else {
    sessionGraph.edges.push({ from, to, count: 1 });
  }
}

// --- Handle page data from content script ---
async function handlePageData(data, tabId) {
  if (!trackersDB) await loadTrackersDB();

  const { domain, title, requestedDomains = [], scripts = [], iframes = [] } = data;

  // Analyze trackers
  const allDomains = [...new Set([
    ...requestedDomains,
    ...scripts.map(s => s.domain),
    ...iframes.map(i => i.domain)
  ])].filter(d => d && d !== domain);

  const trackers = analyzeTrackers(allDomains);

  // Update graph node
  updateNode(domain, { title, trackers });

  // Add navigation edge
  if (previousDomain && previousDomain !== domain) {
    addEdge(previousDomain, domain);
  }

  // Store current page trackers for popup
  await chrome.storage.local.set({
    [`page_${tabId}`]: {
      domain,
      title,
      url: data.url,
      trackers,
      allThirdPartyDomains: allDomains,
      timestamp: Date.now()
    },
    sessionGraph: {
      nodes: sessionGraph.nodes,
      edges: sessionGraph.edges
    }
  });

  // Update badge
  const count = trackers.length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
  chrome.action.setBadgeBackgroundColor({
    color: count >= 5 ? '#ef4444' : count >= 2 ? '#f59e0b' : '#22c55e',
    tabId
  });
}

// --- Listen for messages from content scripts ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_DATA' && sender.tab) {
    handlePageData(message.data, sender.tab.id).catch(console.error);
  }
  if (message.type === 'GET_PAGE_DATA') {
    chrome.storage.local.get([`page_${message.tabId}`, 'sessionGraph'], (result) => {
      sendResponse({
        page: result[`page_${message.tabId}`] || null,
        graph: result.sessionGraph || { nodes: {}, edges: [] }
      });
    });
    return true; // async
  }
  if (message.type === 'CLEAR_SESSION') {
    sessionGraph = { nodes: {}, edges: [] };
    previousDomain = null;
    chrome.storage.local.clear(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'GET_DB') {
    sendResponse(trackersDB);
  }
});

// --- Track tab navigation ---
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  currentTab = activeInfo.tabId;
  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  if (tab?.url) {
    try {
      previousDomain = new URL(tab.url).hostname;
    } catch (e) {}
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    try {
      const domain = new URL(tab.url).hostname;
      if (domain && domain !== previousDomain) {
        if (tabId === currentTab) {
          previousDomain = domain;
        }
      }
    } catch (e) {}
  }
});

// --- Init ---
loadTrackersDB();
