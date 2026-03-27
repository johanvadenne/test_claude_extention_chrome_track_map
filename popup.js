// TrackMap Popup v3
// Bloc 2 : restauration positions graphe + simulation courte (30 frames)
// Bloc 3 : refresh via PING/RESCAN au lieu de executeScript

'use strict';

let currentTabId   = null;
let pageData       = null;
let graphData      = null;
let graphAnimation = null;
let graphNodes     = [];
let graphEdges     = [];
let simRunning     = false;

// ── Helpers ────────────────────────────────────────────────────────────────

function riskColor(score) {
  return score >= 7 ? '#ff4757' : score >= 4 ? '#ffb347' : score >= 1 ? '#2ecc71' : '#555570';
}
function riskColorByLevel(risk) {
  return risk === 'high' ? '#ff4757' : risk === 'medium' ? '#ffb347' : risk === 'low' ? '#2ecc71' : '#555570';
}
function riskClass(risk) {
  return risk === 'high' ? 'high' : risk === 'medium' ? 'medium' : risk === 'low' ? 'low' : 'none';
}
function domainShort(d) { return d.replace(/^www\./, ''); }

function categoryLabel(cat) {
  const map = {
    analytics: 'Analytique', advertising: 'Publicité', social: 'Social',
    'tag-manager': 'Tag manager', 'session-replay': 'Enreg. session',
    fingerprinting: 'Fingerprint', support: 'Support',
    infrastructure: 'Infra', payment: 'Paiement', marketing: 'Marketing'
  };
  return map[cat] || cat || 'Autre';
}

// ── Tabs ───────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'graph') renderGraph();
  });
});

// ── Chargement des données ─────────────────────────────────────────────────

async function loadData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;

  try {
    const url = new URL(tab.url);
    document.getElementById('site-domain').textContent = domainShort(url.hostname);
    document.getElementById('site-title').textContent  = tab.title || url.hostname;
  } catch (_) {
    document.getElementById('site-domain').textContent = 'Page locale';
    document.getElementById('site-title').textContent  = tab.title || '—';
  }

  chrome.runtime.sendMessage({ type: 'GET_PAGE_DATA', tabId: currentTabId }, response => {
    if (!response) { showEmpty(); return; }
    pageData  = response.page;
    graphData = response.graph;
    pageData ? renderTrackers(pageData) : showEmpty();
    renderGraphList();
  });
}

// ── Trackers ───────────────────────────────────────────────────────────────

function renderTrackers(data) {
  const trackers          = data.trackers          || [];
  const unknown           = data.unknown           || [];
  const allThirdParty     = data.allThirdPartyDomains || [];
  const breakdown         = data.breakdown         || [];

  const high   = trackers.filter(t => t.risk === 'high').length;
  const medium = trackers.filter(t => t.risk === 'medium').length;
  const low    = trackers.filter(t => t.risk === 'low').length;

  document.getElementById('stat-high').textContent   = high;
  document.getElementById('stat-medium').textContent = medium;
  document.getElementById('stat-low').textContent    = low;
  document.getElementById('stat-total').textContent  = allThirdParty.length;
  document.getElementById('stats-bar').style.display = 'flex';
  document.getElementById('tab-count-trackers').textContent = trackers.length;

  const badge = document.getElementById('risk-badge');
  if (high > 0) {
    badge.className = 'risk-badge high';
    badge.textContent = `${high} risque${high>1?'s':''} élevé${high>1?'s':''}`;
  } else if (medium > 0) {
    badge.className = 'risk-badge medium';
    badge.textContent = `${medium} trackers`;
  } else if (low > 0) {
    badge.className = 'risk-badge low';
    badge.textContent = 'Faible risque';
  } else {
    badge.className = 'risk-badge none';
    badge.textContent = 'Propre';
  }

  const content = document.getElementById('trackers-content');

  if (!trackers.length && !allThirdParty.length) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">✓</div><div class="empty-title">Aucun tracker détecté</div><div class="empty-desc">Cette page semble propre.</div></div>`;
    return;
  }

  let html = '';

  // Score breakdown
  if (breakdown.length > 0) {
    html += `<div class="section-label">Explication du score</div>`;
    html += `<div class="breakdown-list">`;
    breakdown.forEach(f => {
      html += `<div class="breakdown-item ${f.severity}">
        <span class="bd-label">${f.label}</span>
        <span class="bd-pts">+${f.points} pts</span>
      </div>`;
    });
    html += `</div>`;
  }

  // Trackers identifiés
  if (trackers.length > 0) {
    html += `<div class="section-label">Trackers identifiés (${trackers.length})</div>`;
    html += `<div class="tracker-list">`;
    trackers.forEach((t, i) => {
      const confBadge = t.confidence === 'likely'
        ? `<span class="conf-badge likely">probable</span>` : '';
      html += `<div class="tracker-item ${riskClass(t.risk)}" style="animation-delay:${i*40}ms">
        <div class="tracker-icon ${riskClass(t.risk)}">${t.icon || t.name.substring(0,2).toUpperCase()}</div>
        <div class="tracker-info">
          <div class="tracker-name">${t.name}${confBadge}<span class="tracker-owner">· ${t.owner||'?'}</span><span class="tracker-cat">${categoryLabel(t.category)}</span></div>
          <div class="tracker-desc">${t.description}</div>
          <div class="tracker-domain">${t.domain}${t.matchedOn && t.matchedOn !== t.domain ? ` <span class="matched-on">→ ${t.matchedOn}</span>` : ''}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // Domaines inconnus
  const knownDomains = new Set(trackers.map(t => t.domain));
  const unknownDomains = allThirdParty.filter(d => !knownDomains.has(d));
  if (unknownDomains.length > 0) {
    html += `<div class="section-label">Domaines tiers non identifiés (${unknownDomains.length})</div>`;
    unknownDomains.slice(0, 8).forEach(d => { html += `<div class="unknown-item">${domainShort(d)}</div>`; });
    if (unknownDomains.length > 8) html += `<div class="unknown-item">+${unknownDomains.length-8} autres…</div>`;
  }

  content.innerHTML = html;
}

function showEmpty() {
  ['stat-high','stat-medium','stat-low','stat-total'].forEach(id => {
    document.getElementById(id).textContent = '—';
  });
  document.getElementById('trackers-content').innerHTML = `
    <div class="empty">
      <div class="empty-icon">◎</div>
      <div class="empty-title">Analyse en attente</div>
      <div class="empty-desc">Naviguez sur une page web pour démarrer l'analyse.</div>
    </div>`;
}

// ── Graphe de session ──────────────────────────────────────────────────────

function renderGraphList() {
  if (!graphData) return;
  const nodes = Object.values(graphData.nodes || {});
  document.getElementById('tab-count-graph').textContent = nodes.length;
  const list = document.getElementById('graph-nodes-list');
  if (!nodes.length) {
    list.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text3);text-align:center">Naviguez sur plusieurs sites pour construire le graphe.</div>';
    return;
  }
  list.innerHTML = [...nodes].sort((a,b) => b.visits-a.visits).map(n => `
    <div class="graph-node-item">
      <div class="gn-dot" style="background:${riskColor(n.riskScore)}"></div>
      <div class="gn-domain">${domainShort(n.domain)}</div>
      <div class="gn-visits">${n.visits} visite${n.visits>1?'s':''}</div>
      ${n.trackers.length > 0 ? `<div class="gn-trackers">${n.trackers.length} tracker${n.trackers.length>1?'s':''}</div>` : ''}
    </div>`).join('');
}

// ── Bloc 2 : Rendu du graphe avec restauration de positions ───────────────
//
// Si les nœuds ont des positions x,y sauvegardées (depuis la session précédente
// ou la dernière ouverture du popup), on les utilise directement et on ne fait
// qu'une courte simulation de stabilisation (30 frames au lieu de 180).
// Si aucune position n'est sauvegardée, on part d'un layout circulaire et on
// lance la simulation complète (180 frames).

function renderGraph() {
  const canvas = document.getElementById('graph-canvas');
  const ctx    = canvas.getContext('2d');
  const wrap   = document.getElementById('graph-canvas-wrap');
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;

  if (!graphData) return;
  const nodesData = Object.values(graphData.nodes || {});
  const edgesData = graphData.edges || [];

  if (!nodesData.length) {
    ctx.fillStyle = '#555570';
    ctx.font = '12px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Naviguez sur plusieurs sites pour voir le graphe', canvas.width/2, canvas.height/2);
    return;
  }

  const W = canvas.width, H = canvas.height;
  const cx = W/2, cy = H/2;

  // Bloc 2 : Vérifier si des positions sauvegardées existent
  const hasSavedPositions = nodesData.some(n => n.x !== null && n.y !== null && n.x !== undefined);

  graphNodes = nodesData.map((n, i) => {
    let x, y;
    if (hasSavedPositions && n.x !== null && n.y !== null) {
      // Restaurer les positions sauvegardées, en les recalant dans les bounds actuels
      x = Math.max(20, Math.min(W - 20, n.x * (W / (graphData._canvasW || W))));
      y = Math.max(20, Math.min(H - 20, n.y * (H / (graphData._canvasH || H))));
    } else {
      // Position initiale circulaire (première fois ou nœud nouveau)
      const angle = (i / nodesData.length) * Math.PI * 2;
      const r = Math.min(W, H) * 0.3;
      x = cx + Math.cos(angle) * r + (Math.random() - 0.5) * 30;
      y = cy + Math.sin(angle) * r + (Math.random() - 0.5) * 30;
    }
    return {
      ...n, x, y, vx: 0, vy: 0,
      radius: Math.max(14, Math.min(26, 10 + n.visits * 3))
    };
  });

  graphEdges = edgesData;

  if (graphAnimation) { cancelAnimationFrame(graphAnimation); simRunning = false; }

  // Bloc 2 : Nombre de frames selon qu'on a des positions ou non
  const maxFrames = hasSavedPositions ? 30 : 180;
  let frame = 0;
  simRunning = true;

  function simulate() {
    if (!simRunning) return;

    for (let i = 0; i < graphNodes.length; i++) {
      const a = graphNodes[i];
      a.vx *= 0.85; a.vy *= 0.85;
      for (let j = 0; j < graphNodes.length; j++) {
        if (i === j) continue;
        const b = graphNodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx*dx + dy*dy) || 1;
        const force = 1800 / (dist*dist);
        a.vx += (dx/dist) * force;
        a.vy += (dy/dist) * force;
      }
      a.vx += (cx - a.x) * 0.015;
      a.vy += (cy - a.y) * 0.015;
    }

    graphEdges.forEach(e => {
      const src = graphNodes.find(n => n.domain === e.from);
      const tgt = graphNodes.find(n => n.domain === e.to);
      if (!src || !tgt) return;
      const dx = tgt.x - src.x, dy = tgt.y - src.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;
      const force = dist * 0.03;
      src.vx += (dx/dist) * force; src.vy += (dy/dist) * force;
      tgt.vx -= (dx/dist) * force; tgt.vy -= (dy/dist) * force;
    });

    graphNodes.forEach(n => {
      n.x = Math.max(n.radius+5, Math.min(W-n.radius-5, n.x + n.vx));
      n.y = Math.max(n.radius+5, Math.min(H-n.radius-5, n.y + n.vy));
    });

    draw();
    frame++;

    if (frame < maxFrames) {
      graphAnimation = requestAnimationFrame(simulate);
    } else {
      simRunning = false;
      // Bloc 2 : Sauvegarder les positions finales dans le background
      saveNodePositions();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    graphEdges.forEach(e => {
      const src = graphNodes.find(n => n.domain === e.from);
      const tgt = graphNodes.find(n => n.domain === e.to);
      if (!src || !tgt) return;
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = 'rgba(120,110,200,0.25)';
      ctx.lineWidth = Math.min(3, e.count * 0.8 + 0.5);
      ctx.stroke();
      const angle  = Math.atan2(tgt.y-src.y, tgt.x-src.x);
      const arrowX = tgt.x - Math.cos(angle) * (tgt.radius + 4);
      const arrowY = tgt.y - Math.sin(angle) * (tgt.radius + 4);
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - 8*Math.cos(angle-0.4), arrowY - 8*Math.sin(angle-0.4));
      ctx.lineTo(arrowX - 8*Math.cos(angle+0.4), arrowY - 8*Math.sin(angle+0.4));
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,110,200,0.4)';
      ctx.fill();
    });
    graphNodes.forEach(n => {
      const color = riskColor(n.riskScore || 0);
      ctx.beginPath(); ctx.arc(n.x, n.y, n.radius+4, 0, Math.PI*2);
      ctx.fillStyle = color + '22'; ctx.fill();
      ctx.beginPath(); ctx.arc(n.x, n.y, n.radius, 0, Math.PI*2);
      ctx.fillStyle = color+'33'; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();
      const label = domainShort(n.domain).replace(/\.(com|fr|net|org|io)$/, '');
      const short = label.length > 10 ? label.substring(0,9)+'…' : label;
      ctx.font = `${Math.max(9, n.radius*0.55)}px DM Sans, sans-serif`;
      ctx.fillStyle = '#e8e8f0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(short, n.x, n.y);
      ctx.font = '9px Space Mono, monospace'; ctx.fillStyle = color;
      ctx.fillText(`×${n.visits}`, n.x, n.y + n.radius + 9);
    });
  }

  simulate();
}

// Bloc 2 : Envoie les positions finales au background pour persistance
function saveNodePositions() {
  const canvas = document.getElementById('graph-canvas');
  const positions = {};
  graphNodes.forEach(n => {
    positions[n.domain] = { x: n.x, y: n.y };
  });
  chrome.runtime.sendMessage({
    type: 'SAVE_NODE_POSITIONS',
    positions,
    canvasW: canvas.width,
    canvasH: canvas.height
  }).catch(() => {});
}

// ── Bloc 3 : Refresh — PING/RESCAN au lieu de executeScript ───────────────
//
// Avant : chrome.scripting.executeScript → ré-injectait le script, doublait les détections.
// Après : on envoie PING au content script. S'il répond PONG, il est vivant :
//         on lui envoie RESCAN (ré-collecte DOM). Sinon, le manifest s'en charge
//         automatiquement au prochain chargement de page.

document.getElementById('btn-refresh').addEventListener('click', async () => {
  document.getElementById('trackers-content').innerHTML = `
    <div class="loading"><div class="spinner"></div><div style="font-size:11px">Actualisation…</div></div>`;

  if (!currentTabId) { await loadData(); return; }

  try {
    // Bloc 3 : PING d'abord
    const pong = await chrome.tabs.sendMessage(currentTabId, { type: 'PING' })
      .catch(() => null);

    if (pong?.type === 'PONG') {
      // Content script vivant → RESCAN
      await chrome.tabs.sendMessage(currentTabId, { type: 'RESCAN' }).catch(() => {});
      // Attendre que le rapport remonte (le content script a un debounce 400ms)
      setTimeout(loadData, 600);
    } else {
      // Content script absent (page système, PDF, ou non encore chargé)
      // On recharge juste les données depuis le storage
      setTimeout(loadData, 300);
    }
  } catch (_) {
    setTimeout(loadData, 300);
  }
});

// ── Clear session ──────────────────────────────────────────────────────────

document.getElementById('btn-clear').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' }, () => {
    graphData = { nodes: {}, edges: [] };
    graphNodes = []; graphEdges = [];
    renderGraphList();
    const canvas = document.getElementById('graph-canvas');
    const ctx    = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('tab-count-graph').textContent = '0';
  });
});

// ── Footer ─────────────────────────────────────────────────────────────────

function updateFooter() {
  if (pageData?.timestamp) {
    const diff = Math.round((Date.now() - pageData.timestamp) / 1000);
    const txt  = diff < 60 ? `Analysé il y a ${diff}s` : `Analysé il y a ${Math.round(diff/60)}min`;
    document.getElementById('footer-text').textContent = txt + ' · 100% local';
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

loadData();
setInterval(updateFooter, 5000);
