// TrackMap Popup v4
// Bloc 4 : feedback temps réel NAV_UPDATE + barre de progression
// Bloc 5 : graphe SVG interactif — drag nœud, pan, zoom molette, mode cluster

'use strict';

// ── État global ────────────────────────────────────────────────────────────

let currentTabId   = null;
let pageData       = null;
let graphData      = null;
let graphMode      = 'force';   // 'force' | 'cluster'

// SVG graph state
const SVG_NS = 'http://www.w3.org/2000/svg';
let svgNodes   = [];   // { domain, x, y, vx, vy, radius, riskScore, visits, trackers, el, labelEl }
let svgEdges   = [];
let simHandle  = null;
let simFrame   = 0;
let simMax     = 180;

// Viewport transform : pan + zoom
let vpX = 0, vpY = 0, vpScale = 1;
const VP_MIN = 0.3, VP_MAX = 4;

// Drag state
let dragNode   = null;   // nœud en cours de drag
let dragOffset = { x: 0, y: 0 };
let isPanning  = false;
let panStart   = { x: 0, y: 0 };
let panOrigin  = { x: 0, y: 0 };

// ── Helpers ────────────────────────────────────────────────────────────────

const riskScore2Color = s => s >= 7 ? '#ff4757' : s >= 4 ? '#ffb347' : s >= 1 ? '#2ecc71' : '#555570';
const risk2Color      = r => r === 'high' ? '#ff4757' : r === 'medium' ? '#ffb347' : r === 'low' ? '#2ecc71' : '#555570';
const risk2Class      = r => r === 'high' ? 'high' : r === 'medium' ? 'medium' : r === 'low' ? 'low' : 'none';
const short           = d => d.replace(/^www\./, '').replace(/\.(com|fr|net|org|io|co)$/, '');
const domainShort     = d => d.replace(/^www\./, '');

function categoryLabel(cat) {
  const m = { analytics:'Analytique', advertising:'Publicité', social:'Social',
    'tag-manager':'Tag mgr', 'session-replay':'Enreg.', fingerprinting:'Fingerprint',
    support:'Support', infrastructure:'Infra', payment:'Paiement', marketing:'Marketing' };
  return m[cat] || cat || 'Autre';
}

// ── Bloc 4 : barre de progression & indicateur ────────────────────────────

const navProgress  = document.getElementById('nav-progress');
const navIndicator = document.getElementById('nav-indicator');

function startNavProgress() {
  navIndicator.classList.add('visible');
  navProgress.classList.remove('running');
  void navProgress.offsetWidth; // reflow pour relancer l'animation
  navProgress.classList.add('running');
  document.getElementById('panel-trackers').classList.add('refreshing');
}

function stopNavProgress() {
  navIndicator.classList.remove('visible');
  navProgress.classList.remove('running');
  document.getElementById('panel-trackers').classList.remove('refreshing');
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

// ── Chargement données ─────────────────────────────────────────────────────

async function loadData(showProgress = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;

  try {
    const u = new URL(tab.url);
    document.getElementById('site-domain').textContent = domainShort(u.hostname);
    document.getElementById('site-title').textContent  = tab.title || u.hostname;
  } catch(_) {
    document.getElementById('site-domain').textContent = 'Page locale';
    document.getElementById('site-title').textContent  = tab.title || '—';
  }

  if (showProgress) startNavProgress();

  chrome.runtime.sendMessage({ type: 'GET_PAGE_DATA', tabId: currentTabId }, response => {
    stopNavProgress();
    if (!response) { showEmpty(); return; }
    pageData  = response.page;
    graphData = response.graph;
    pageData ? renderTrackers(pageData) : showEmpty();
    renderGraphList();
    // Si l'onglet graphe est visible, mettre à jour le SVG
    if (document.getElementById('panel-graph').classList.contains('active')) {
      updateGraphSVG();
    }
  });
}

// ── Bloc 4 : écouter NAV_UPDATE depuis le background ──────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'NAV_UPDATE' && message.tabId === currentTabId) {
    // Délai court pour laisser le content script envoyer PAGE_DATA
    startNavProgress();
    setTimeout(() => loadData(false), 900);
  }
});

// ── Trackers ───────────────────────────────────────────────────────────────

function renderTrackers(data) {
  const trackers      = data.trackers          || [];
  const allThirdParty = data.allThirdPartyDomains || [];
  const breakdown     = data.breakdown         || [];

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
  if (high > 0)        { badge.className = 'risk-badge high';   badge.textContent = `${high} risque${high>1?'s':''} élevé${high>1?'s':''}`; }
  else if (medium > 0) { badge.className = 'risk-badge medium'; badge.textContent = `${medium} trackers`; }
  else if (low > 0)    { badge.className = 'risk-badge low';    badge.textContent = 'Faible risque'; }
  else                 { badge.className = 'risk-badge none';   badge.textContent = 'Propre'; }

  const content = document.getElementById('trackers-content');
  if (!trackers.length && !allThirdParty.length) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">✓</div><div class="empty-title">Aucun tracker détecté</div><div class="empty-desc">Cette page semble propre.</div></div>`;
    return;
  }

  let html = '';
  if (breakdown.length) {
    html += `<div class="section-label">Explication du score</div><div class="breakdown-list">`;
    breakdown.forEach(f => {
      html += `<div class="breakdown-item ${f.severity}"><span class="bd-label">${f.label}</span><span class="bd-pts">+${f.points} pts</span></div>`;
    });
    html += `</div>`;
  }

  if (trackers.length) {
    html += `<div class="section-label">Trackers identifiés (${trackers.length})</div><div class="tracker-list">`;
    trackers.forEach((t, i) => {
      const cb = t.confidence === 'likely' ? `<span class="conf-badge likely">probable</span>` : '';
      html += `<div class="tracker-item ${risk2Class(t.risk)}" style="animation-delay:${i*40}ms">
        <div class="tracker-icon ${risk2Class(t.risk)}">${t.icon || t.name.substring(0,2).toUpperCase()}</div>
        <div class="tracker-info">
          <div class="tracker-name">${t.name}${cb}<span class="tracker-owner">· ${t.owner||'?'}</span><span class="tracker-cat">${categoryLabel(t.category)}</span></div>
          <div class="tracker-desc">${t.description}</div>
          <div class="tracker-domain">${t.domain}${t.matchedOn&&t.matchedOn!==t.domain?` <span class="matched-on">→ ${t.matchedOn}</span>`:''}</div>
        </div></div>`;
    });
    html += `</div>`;
  }

  const knownD = new Set(trackers.map(t => t.domain));
  const unknD  = allThirdParty.filter(d => !knownD.has(d));
  if (unknD.length) {
    html += `<div class="section-label">Domaines tiers non identifiés (${unknD.length})</div>`;
    unknD.slice(0, 8).forEach(d => { html += `<div class="unknown-item">${domainShort(d)}</div>`; });
    if (unknD.length > 8) html += `<div class="unknown-item">+${unknD.length-8} autres…</div>`;
  }

  content.innerHTML = html;
}

function showEmpty() {
  ['stat-high','stat-medium','stat-low','stat-total'].forEach(id => document.getElementById(id).textContent = '—');
  document.getElementById('trackers-content').innerHTML = `
    <div class="empty"><div class="empty-icon">◎</div><div class="empty-title">Analyse en attente</div>
    <div class="empty-desc">Naviguez sur une page web pour démarrer l'analyse.</div></div>`;
}

// ── Graphe — liste ─────────────────────────────────────────────────────────

function renderGraphList() {
  if (!graphData) return;
  const nodes = Object.values(graphData.nodes || {});
  document.getElementById('tab-count-graph').textContent = nodes.length;
  const list = document.getElementById('graph-nodes-list');
  if (!nodes.length) {
    list.innerHTML = `<div style="padding:12px;font-size:11px;color:var(--text3);text-align:center">Naviguez sur plusieurs sites pour construire le graphe.</div>`;
    return;
  }
  list.innerHTML = [...nodes].sort((a,b) => b.visits-a.visits).map(n => `
    <div class="graph-node-item" data-domain="${n.domain}">
      <div class="gn-dot" style="background:${riskScore2Color(n.riskScore)}"></div>
      <div class="gn-domain">${domainShort(n.domain)}</div>
      <div class="gn-visits">${n.visits}×</div>
      ${n.trackers.length ? `<div class="gn-trackers">${n.trackers.length}T</div>` : ''}
    </div>`).join('');

  // Clic sur un nœud de la liste → le mettre en évidence dans le SVG
  list.querySelectorAll('.graph-node-item').forEach(item => {
    item.addEventListener('click', () => {
      const domain = item.dataset.domain;
      highlightNode(domain);
    });
  });
}

// ── Bloc 5 : Graphe SVG interactif ────────────────────────────────────────

const svgWrap = document.getElementById('graph-svg-wrap');
const svgEl   = document.getElementById('graph-svg');

// Groupe racine transformable (pan + zoom)
let svgRoot = null;

function ensureSVGRoot() {
  if (svgRoot) return;
  svgRoot = document.createElementNS(SVG_NS, 'g');
  svgRoot.setAttribute('id', 'svg-root');
  svgEl.appendChild(svgRoot);
  applyViewport();
}

function applyViewport() {
  if (!svgRoot) return;
  svgRoot.setAttribute('transform', `translate(${vpX},${vpY}) scale(${vpScale})`);
}

function resetViewport() {
  const W = svgWrap.clientWidth, H = svgWrap.clientHeight;
  vpX = W / 2; vpY = H / 2; vpScale = 1;
  applyViewport();
}

// ── Rendu principal du graphe ──────────────────────────────────────────────

function renderGraph() {
  if (!graphData) return;
  const nodesData = Object.values(graphData.nodes || {});
  const edgesData = graphData.edges || [];

  ensureSVGRoot();
  svgRoot.innerHTML = ''; // clear

  const W = svgWrap.clientWidth, H = svgWrap.clientHeight;
  if (!W || !H) return;

  if (!nodesData.length) {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '50%'); t.setAttribute('y', '50%');
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('fill', '#555570'); t.setAttribute('font-size', '11');
    t.setAttribute('font-family', 'DM Sans, sans-serif');
    t.textContent = 'Naviguez sur plusieurs sites pour voir le graphe';
    svgRoot.appendChild(t);
    return;
  }

  const hasSaved = nodesData.some(n => n.x !== null && n.x !== undefined);
  const cx = 0, cy = 0; // coordonnées centrées sur (0,0), le viewport fera le centrage

  // Initialiser les nœuds SVG
  svgNodes = nodesData.map((n, i) => {
    let x, y;
    if (hasSaved && n.x !== null) {
      x = n.x - W/2; y = n.y - H/2; // dé-normaliser
    } else if (graphMode === 'cluster') {
      const col = n.riskScore >= 7 ? 0 : n.riskScore >= 4 ? 1 : 2;
      const colW = 120, colX = (col - 1) * colW;
      const colNodes = nodesData.filter(nn => {
        const c = nn.riskScore >= 7 ? 0 : nn.riskScore >= 4 ? 1 : 2;
        return c === col;
      });
      const idx = colNodes.indexOf(n);
      x = colX + (Math.random() - 0.5) * 40;
      y = (idx - colNodes.length / 2) * 55;
    } else {
      const angle = (i / nodesData.length) * Math.PI * 2;
      const r = Math.min(W, H) * 0.28;
      x = Math.cos(angle) * r + (Math.random() - 0.5) * 20;
      y = Math.sin(angle) * r + (Math.random() - 0.5) * 20;
    }
    return {
      ...n, x, y, vx: 0, vy: 0,
      radius: Math.max(14, Math.min(26, 10 + n.visits * 3))
    };
  });
  svgEdges = edgesData;

  // Créer les éléments SVG — arêtes d'abord (en dessous)
  const edgeLayer = document.createElementNS(SVG_NS, 'g');
  edgeLayer.setAttribute('id', 'edge-layer');
  svgRoot.appendChild(edgeLayer);

  // Puis les nœuds
  const nodeLayer = document.createElementNS(SVG_NS, 'g');
  nodeLayer.setAttribute('id', 'node-layer');
  svgRoot.appendChild(nodeLayer);

  // Créer les éléments de nœud
  svgNodes.forEach(n => {
    const color = riskScore2Color(n.riskScore);

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'svg-node');
    g.setAttribute('cursor', 'pointer');
    g.setAttribute('data-domain', n.domain);

    // Halo
    const halo = document.createElementNS(SVG_NS, 'circle');
    halo.setAttribute('r', n.radius + 5);
    halo.setAttribute('fill', color + '18');
    halo.setAttribute('class', 'node-halo');
    g.appendChild(halo);

    // Cercle principal
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('r', n.radius);
    circle.setAttribute('fill', color + '30');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', '1.5');
    circle.setAttribute('class', 'node-circle');
    g.appendChild(circle);

    // Label
    const label = document.createElementNS(SVG_NS, 'text');
    const labelText = short(n.domain);
    const fontSize  = Math.max(8, n.radius * 0.52);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('fill', '#e8e8f0');
    label.setAttribute('font-size', fontSize);
    label.setAttribute('font-family', 'DM Sans, sans-serif');
    label.setAttribute('pointer-events', 'none');
    label.textContent = labelText.length > 9 ? labelText.substring(0,8)+'…' : labelText;
    g.appendChild(label);

    // Compteur visites
    const visits = document.createElementNS(SVG_NS, 'text');
    visits.setAttribute('y', n.radius + 10);
    visits.setAttribute('text-anchor', 'middle');
    visits.setAttribute('fill', color);
    visits.setAttribute('font-size', '8');
    visits.setAttribute('font-family', 'Space Mono, monospace');
    visits.setAttribute('pointer-events', 'none');
    visits.textContent = `×${n.visits}`;
    g.appendChild(visits);

    // Drag events sur le nœud
    g.addEventListener('mousedown', e => startNodeDrag(e, n));
    g.addEventListener('touchstart', e => startNodeDrag(e, n), { passive: false });

    nodeLayer.appendChild(g);
    n.el = g;
    n.labelEl = label;
  });

  // Positionner immédiatement
  updateSVGPositions(edgeLayer);

  // Lancer simulation
  if (simHandle) cancelAnimationFrame(simHandle);
  simFrame = 0;
  simMax   = hasSaved ? 30 : 180;
  runSim(edgeLayer);
}

// ── Simulation force-directed ──────────────────────────────────────────────

function runSim(edgeLayer) {
  const W = svgWrap.clientWidth, H = svgWrap.clientHeight;
  const cx = 0, cy = 0;

  function step() {
    // Répulsion entre nœuds
    for (let i = 0; i < svgNodes.length; i++) {
      const a = svgNodes[i];
      a.vx *= 0.85; a.vy *= 0.85;

      for (let j = 0; j < svgNodes.length; j++) {
        if (i === j) continue;
        const b  = svgNodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d  = Math.sqrt(dx*dx + dy*dy) || 1;
        const f  = 2200 / (d*d);
        a.vx += (dx/d) * f; a.vy += (dy/d) * f;
      }

      // Gravité vers le centre
      a.vx += (cx - a.x) * 0.012;
      a.vy += (cy - a.y) * 0.012;

      // Mode cluster : gravité vers colonne
      if (graphMode === 'cluster') {
        const targetX = a.riskScore >= 7 ? -130 : a.riskScore >= 4 ? 0 : 130;
        a.vx += (targetX - a.x) * 0.04;
      }
    }

    // Attraction des arêtes
    svgEdges.forEach(e => {
      const s = svgNodes.find(n => n.domain === e.from);
      const t = svgNodes.find(n => n.domain === e.to);
      if (!s || !t) return;
      const dx = t.x-s.x, dy = t.y-s.y;
      const d  = Math.sqrt(dx*dx+dy*dy) || 1;
      const f  = d * 0.025;
      s.vx += (dx/d)*f; s.vy += (dy/d)*f;
      t.vx -= (dx/d)*f; t.vy -= (dy/d)*f;
    });

    // Mettre à jour positions (sans borne — le viewport gère le pan)
    svgNodes.forEach(n => {
      if (n === dragNode) return; // ne pas bouger le nœud draggué
      n.x += n.vx; n.y += n.vy;
    });

    updateSVGPositions(edgeLayer);
    simFrame++;

    if (simFrame < simMax) {
      simHandle = requestAnimationFrame(step);
    } else {
      saveNodePositions();
    }
  }

  simHandle = requestAnimationFrame(step);
}

function updateSVGPositions(edgeLayer) {
  // Mettre à jour les nœuds
  svgNodes.forEach(n => {
    if (n.el) n.el.setAttribute('transform', `translate(${n.x},${n.y})`);
  });

  // Redessiner les arêtes
  if (!edgeLayer) {
    edgeLayer = document.getElementById('edge-layer');
    if (!edgeLayer) return;
  }
  edgeLayer.innerHTML = '';
  svgEdges.forEach(e => {
    const s = svgNodes.find(n => n.domain === e.from);
    const t = svgNodes.find(n => n.domain === e.to);
    if (!s || !t) return;

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', s.x); line.setAttribute('y1', s.y);
    line.setAttribute('x2', t.x); line.setAttribute('y2', t.y);
    line.setAttribute('stroke', 'rgba(120,110,200,0.22)');
    line.setAttribute('stroke-width', Math.min(3, e.count * 0.8 + 0.5));
    edgeLayer.appendChild(line);

    // Flèche
    const angle  = Math.atan2(t.y-s.y, t.x-s.x);
    const ax     = t.x - Math.cos(angle) * (t.radius + 4);
    const ay     = t.y - Math.sin(angle) * (t.radius + 4);
    const arrow  = document.createElementNS(SVG_NS, 'polygon');
    const p1x = ax, p1y = ay;
    const p2x = ax - 8*Math.cos(angle-0.45), p2y = ay - 8*Math.sin(angle-0.45);
    const p3x = ax - 8*Math.cos(angle+0.45), p3y = ay - 8*Math.sin(angle+0.45);
    arrow.setAttribute('points', `${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}`);
    arrow.setAttribute('fill', 'rgba(120,110,200,0.35)');
    edgeLayer.appendChild(arrow);
  });
}

// ── Mise à jour incrémentale (sans recréer les éléments) ───────────────────
// Appelée par loadData quand le graphe est déjà visible et qu'un NAV_UPDATE arrive

function updateGraphSVG() {
  if (!graphData) return;
  renderGraphList();
  // Si on est dans l'onglet graphe, re-render complet avec les nouvelles données
  if (document.getElementById('panel-graph').classList.contains('active')) {
    renderGraph();
  }
}

// ── Surligner un nœud depuis la liste ─────────────────────────────────────

function highlightNode(domain) {
  const n = svgNodes.find(n => n.domain === domain);
  if (!n || !n.el) return;

  // Animer un flash
  const circle = n.el.querySelector('.node-circle');
  if (circle) {
    const orig = circle.getAttribute('stroke-width');
    circle.setAttribute('stroke-width', '3.5');
    setTimeout(() => circle.setAttribute('stroke-width', orig), 600);
  }

  // Centrer la vue sur ce nœud
  const W = svgWrap.clientWidth, H = svgWrap.clientHeight;
  vpX = W/2 - n.x * vpScale;
  vpY = H/2 - n.y * vpScale;
  applyViewport();
}

// ── Sauvegarde positions ───────────────────────────────────────────────────

function saveNodePositions() {
  const W = svgWrap.clientWidth, H = svgWrap.clientHeight;
  const positions = {};
  svgNodes.forEach(n => {
    positions[n.domain] = { x: n.x + W/2, y: n.y + H/2 }; // renormaliser
  });
  chrome.runtime.sendMessage({
    type: 'SAVE_NODE_POSITIONS',
    positions, canvasW: W, canvasH: H
  }).catch(() => {});
}

// ── Mode graphe (force / cluster) ─────────────────────────────────────────

document.querySelectorAll('.graph-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.graph-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    graphMode = btn.dataset.mode;
    // Forcer une nouvelle simulation (reset positions)
    if (graphData) {
      Object.values(graphData.nodes).forEach(n => { n.x = null; n.y = null; });
      renderGraph();
    }
  });
});

// ── Reset vue ──────────────────────────────────────────────────────────────

document.getElementById('btn-reset-view').addEventListener('click', () => {
  resetViewport();
});

// ── Bloc 5 : Interactions pointeur — drag nœud ────────────────────────────

function startNodeDrag(e, node) {
  e.stopPropagation();
  e.preventDefault();

  // Arrêter la simulation pendant le drag
  if (simHandle) { cancelAnimationFrame(simHandle); simHandle = null; }

  dragNode = node;
  const pt = getPointerPos(e);
  // Convertir les coords écran en coords SVG (inverser le viewport)
  dragOffset.x = (pt.x - vpX) / vpScale - node.x;
  dragOffset.y = (pt.y - vpY) / vpScale - node.y;

  node.el.querySelector('.node-circle').setAttribute('stroke-width', '2.5');
}

function getPointerPos(e) {
  const rect = svgWrap.getBoundingClientRect();
  if (e.touches) {
    return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// ── Pan du graphe ──────────────────────────────────────────────────────────

svgWrap.addEventListener('mousedown', e => {
  if (dragNode) return;
  isPanning  = true;
  panStart   = { x: e.clientX, y: e.clientY };
  panOrigin  = { x: vpX, y: vpY };
  svgWrap.classList.add('dragging');
});

window.addEventListener('mousemove', e => {
  if (dragNode) {
    const pt = getPointerPos(e);
    dragNode.x = (pt.x - vpX) / vpScale - dragOffset.x;
    dragNode.y = (pt.y - vpY) / vpScale - dragOffset.y;
    dragNode.vx = 0; dragNode.vy = 0;
    updateSVGPositions(null);
    return;
  }
  if (isPanning) {
    vpX = panOrigin.x + (e.clientX - panStart.x);
    vpY = panOrigin.y + (e.clientY - panStart.y);
    applyViewport();
  }
});

window.addEventListener('mouseup', () => {
  if (dragNode) {
    dragNode.el.querySelector('.node-circle').setAttribute('stroke-width', '1.5');
    dragNode = null;
    saveNodePositions();
    // Reprendre la simulation doucement (quelques frames)
    simFrame = 0; simMax = 20;
    runSim(null);
  }
  if (isPanning) {
    isPanning = false;
    svgWrap.classList.remove('dragging');
  }
});

// Touch events pour mobile
svgWrap.addEventListener('touchmove', e => {
  if (dragNode) {
    e.preventDefault();
    const pt = getPointerPos(e);
    dragNode.x = (pt.x - vpX) / vpScale - dragOffset.x;
    dragNode.y = (pt.y - vpY) / vpScale - dragOffset.y;
    dragNode.vx = 0; dragNode.vy = 0;
    updateSVGPositions(null);
  }
}, { passive: false });

window.addEventListener('touchend', () => {
  if (dragNode) {
    dragNode.el.querySelector('.node-circle').setAttribute('stroke-width', '1.5');
    dragNode = null;
    saveNodePositions();
  }
});

// ── Zoom molette ───────────────────────────────────────────────────────────

svgWrap.addEventListener('wheel', e => {
  e.preventDefault();
  const rect   = svgWrap.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const delta    = e.deltaY < 0 ? 1.12 : 0.89;
  const newScale = Math.max(VP_MIN, Math.min(VP_MAX, vpScale * delta));

  // Zoomer sur le curseur (pas sur le centre)
  vpX = mouseX - (mouseX - vpX) * (newScale / vpScale);
  vpY = mouseY - (mouseY - vpY) * (newScale / vpScale);
  vpScale = newScale;

  applyViewport();
}, { passive: false });

// ── Refresh via PING/RESCAN ────────────────────────────────────────────────

document.getElementById('btn-refresh').addEventListener('click', async () => {
  document.getElementById('trackers-content').innerHTML = `
    <div class="loading"><div class="spinner"></div><div style="font-size:11px">Actualisation…</div></div>`;
  startNavProgress();

  if (!currentTabId) { await loadData(false); return; }

  try {
    const pong = await chrome.tabs.sendMessage(currentTabId, { type: 'PING' }).catch(() => null);
    if (pong?.type === 'PONG') {
      await chrome.tabs.sendMessage(currentTabId, { type: 'RESCAN' }).catch(() => {});
      setTimeout(() => loadData(false), 600);
    } else {
      setTimeout(() => loadData(false), 300);
    }
  } catch(_) {
    setTimeout(() => loadData(false), 300);
  }
});

// ── Clear session ──────────────────────────────────────────────────────────

document.getElementById('btn-clear').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' }, () => {
    graphData = { nodes: {}, edges: [] };
    svgNodes = []; svgEdges = [];
    if (svgRoot) svgRoot.innerHTML = '';
    renderGraphList();
    document.getElementById('tab-count-graph').textContent = '0';
  });
});

// ── Footer timestamp ───────────────────────────────────────────────────────

function updateFooter() {
  if (pageData?.timestamp) {
    const diff = Math.round((Date.now() - pageData.timestamp) / 1000);
    const txt  = diff < 60 ? `Analysé il y a ${diff}s` : `Analysé il y a ${Math.round(diff/60)}min`;
    document.getElementById('footer-text').textContent = txt + ' · 100% local';
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

// Centrer le viewport au démarrage
const W0 = svgWrap.clientWidth  || 380;
const H0 = svgWrap.clientHeight || 300;
vpX = W0 / 2; vpY = H0 / 2;

loadData(false);
setInterval(updateFooter, 5000);
