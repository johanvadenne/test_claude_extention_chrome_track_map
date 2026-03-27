// TrackMap Popup Script

'use strict';

let currentTabId = null;
let pageData = null;
let graphData = null;
let graphAnimation = null;
let graphNodes = [];
let graphEdges = [];
let simRunning = false;

// ── Helpers ──

function riskColor(risk) {
  return risk === 'high' ? '#ff4757' : risk === 'medium' ? '#ffb347' : risk === 'low' ? '#2ecc71' : '#555570';
}

function riskLabel(risk) {
  return risk === 'high' ? 'Élevé' : risk === 'medium' ? 'Modéré' : risk === 'low' ? 'Faible' : '?';
}

function riskClass(risk) {
  return risk === 'high' ? 'high' : risk === 'medium' ? 'medium' : risk === 'low' ? 'low' : 'none';
}

function domainShort(domain) {
  return domain.replace(/^www\./, '');
}

// ── Tab switching ──

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'graph') renderGraph();
  });
});

// ── Load data ──

async function loadData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;

  // Update site banner
  try {
    const url = new URL(tab.url);
    document.getElementById('site-domain').textContent = domainShort(url.hostname);
    document.getElementById('site-title').textContent = tab.title || url.hostname;
  } catch (e) {
    document.getElementById('site-domain').textContent = 'Page locale';
    document.getElementById('site-title').textContent = tab.title || '—';
  }

  // Get data from background
  chrome.runtime.sendMessage({ type: 'GET_PAGE_DATA', tabId: currentTabId }, (response) => {
    if (!response) {
      showEmpty();
      return;
    }
    pageData = response.page;
    graphData = response.graph;

    if (pageData) {
      renderTrackers(pageData);
    } else {
      showEmpty();
    }
    renderGraphList();
  });
}

// ── Render trackers ──

function renderTrackers(data) {
  const { trackers = [], allThirdPartyDomains = [] } = data;

  // Stats
  const high = trackers.filter(t => t.risk === 'high').length;
  const medium = trackers.filter(t => t.risk === 'medium').length;
  const low = trackers.filter(t => t.risk === 'low').length;

  document.getElementById('stat-high').textContent = high;
  document.getElementById('stat-medium').textContent = medium;
  document.getElementById('stat-low').textContent = low;
  document.getElementById('stat-total').textContent = allThirdPartyDomains.length;
  document.getElementById('stats-bar').style.display = 'flex';

  // Tab count
  document.getElementById('tab-count-trackers').textContent = trackers.length;

  // Risk badge
  const badge = document.getElementById('risk-badge');
  if (high > 0) {
    badge.className = 'risk-badge high';
    badge.textContent = `${high} risque${high > 1 ? 's' : ''} élevé${high > 1 ? 's' : ''}`;
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

  if (trackers.length === 0 && allThirdPartyDomains.length === 0) {
    content.innerHTML = `
      <div class="empty">
        <div class="empty-icon">✓</div>
        <div class="empty-title">Aucun tracker détecté</div>
        <div class="empty-desc">Cette page semble propre.<br>Pas de scripts tiers identifiés.</div>
      </div>`;
    return;
  }

  let html = '';

  if (trackers.length > 0) {
    html += `<div class="section-label">Trackers identifiés (${trackers.length})</div>`;
    html += '<div class="tracker-list">';

    // Sort by risk
    const sorted = [...trackers].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.risk] ?? 3) - (order[b.risk] ?? 3);
    });

    sorted.forEach((tracker, i) => {
      html += `
        <div class="tracker-item ${riskClass(tracker.risk)}" style="animation-delay:${i * 40}ms">
          <div class="tracker-icon ${riskClass(tracker.risk)}">${tracker.icon || tracker.name.substring(0, 2).toUpperCase()}</div>
          <div class="tracker-info">
            <div class="tracker-name">
              ${tracker.name}
              <span class="tracker-owner">· ${tracker.owner || '?'}</span>
              <span class="tracker-cat">${categoryLabel(tracker.category)}</span>
            </div>
            <div class="tracker-desc">${tracker.description}</div>
            <div class="tracker-domain">${tracker.domain}</div>
          </div>
        </div>`;
    });
    html += '</div>';
  }

  // Unknown third-party domains
  const knownDomains = new Set(trackers.map(t => t.domain));
  const unknownDomains = allThirdPartyDomains.filter(d => !knownDomains.has(d));

  if (unknownDomains.length > 0) {
    html += `<div class="section-label">Domaines tiers non identifiés (${unknownDomains.length})</div>`;
    unknownDomains.slice(0, 8).forEach(d => {
      html += `<div class="unknown-item">${domainShort(d)}</div>`;
    });
    if (unknownDomains.length > 8) {
      html += `<div class="unknown-item" style="color:var(--text3)">+${unknownDomains.length - 8} autres…</div>`;
    }
  }

  content.innerHTML = html;
}

function categoryLabel(cat) {
  const map = {
    analytics: 'Analytique', advertising: 'Publicité', social: 'Social',
    'tag-manager': 'Tag manager', support: 'Support', infrastructure: 'Infra', payment: 'Paiement'
  };
  return map[cat] || cat || 'Autre';
}

function showEmpty() {
  document.getElementById('stat-high').textContent = '—';
  document.getElementById('stat-medium').textContent = '—';
  document.getElementById('stat-low').textContent = '—';
  document.getElementById('stat-total').textContent = '—';

  document.getElementById('trackers-content').innerHTML = `
    <div class="empty">
      <div class="empty-icon">◎</div>
      <div class="empty-title">Analyse en attente</div>
      <div class="empty-desc">Naviguez sur une page web pour<br>démarrer l'analyse des trackers.</div>
    </div>`;
}

// ── Session graph (canvas force-directed) ──

function renderGraphList() {
  if (!graphData) return;
  const nodes = Object.values(graphData.nodes || {});
  document.getElementById('tab-count-graph').textContent = nodes.length;

  const list = document.getElementById('graph-nodes-list');
  if (nodes.length === 0) {
    list.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text3);text-align:center">Naviguez sur plusieurs sites pour construire le graphe.</div>';
    return;
  }

  const sorted = [...nodes].sort((a, b) => b.visits - a.visits);
  list.innerHTML = sorted.map(n => `
    <div class="graph-node-item">
      <div class="gn-dot" style="background:${riskColor(n.riskScore >= 7 ? 'high' : n.riskScore >= 4 ? 'medium' : 'low')}"></div>
      <div class="gn-domain">${domainShort(n.domain)}</div>
      <div class="gn-visits">${n.visits} visite${n.visits > 1 ? 's' : ''}</div>
      ${n.trackers.length > 0 ? `<div class="gn-trackers">${n.trackers.length} tracker${n.trackers.length > 1 ? 's' : ''}</div>` : ''}
    </div>
  `).join('');
}

function renderGraph() {
  const canvas = document.getElementById('graph-canvas');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('graph-canvas-wrap');
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;

  if (!graphData) return;
  const nodesData = Object.values(graphData.nodes || {});
  const edgesData = graphData.edges || [];

  if (nodesData.length === 0) {
    ctx.fillStyle = '#555570';
    ctx.font = '12px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Naviguez sur plusieurs sites pour voir le graphe', canvas.width / 2, canvas.height / 2);
    return;
  }

  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2, cy = H / 2;

  // Initialize node positions
  graphNodes = nodesData.map((n, i) => {
    const angle = (i / nodesData.length) * Math.PI * 2;
    const r = Math.min(W, H) * 0.3;
    return {
      ...n,
      x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 40,
      y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 40,
      vx: 0, vy: 0,
      radius: Math.max(14, Math.min(26, 10 + n.visits * 3))
    };
  });

  graphEdges = edgesData;

  if (graphAnimation) cancelAnimationFrame(graphAnimation);
  simRunning = true;
  let frame = 0;

  function simulate() {
    if (!simRunning) return;

    // Force-directed simulation (simplified)
    for (let i = 0; i < graphNodes.length; i++) {
      const a = graphNodes[i];
      a.vx *= 0.85; a.vy *= 0.85;

      // Repulsion
      for (let j = 0; j < graphNodes.length; j++) {
        if (i === j) continue;
        const b = graphNodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 1800 / (dist * dist);
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
      }

      // Center gravity
      a.vx += (cx - a.x) * 0.015;
      a.vy += (cy - a.y) * 0.015;
    }

    // Edge attraction
    graphEdges.forEach(e => {
      const src = graphNodes.find(n => n.domain === e.from);
      const tgt = graphNodes.find(n => n.domain === e.to);
      if (!src || !tgt) return;
      const dx = tgt.x - src.x, dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = dist * 0.03;
      src.vx += (dx / dist) * force;
      src.vy += (dy / dist) * force;
      tgt.vx -= (dx / dist) * force;
      tgt.vy -= (dy / dist) * force;
    });

    // Update positions with bounds
    graphNodes.forEach(n => {
      n.x = Math.max(n.radius + 5, Math.min(W - n.radius - 5, n.x + n.vx));
      n.y = Math.max(n.radius + 5, Math.min(H - n.radius - 5, n.y + n.vy));
    });

    draw();
    frame++;
    if (frame < 180) {
      graphAnimation = requestAnimationFrame(simulate);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Draw edges
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

      // Arrow
      const angle = Math.atan2(tgt.y - src.y, tgt.x - src.x);
      const arrowX = tgt.x - Math.cos(angle) * (tgt.radius + 4);
      const arrowY = tgt.y - Math.sin(angle) * (tgt.radius + 4);
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - 8 * Math.cos(angle - 0.4), arrowY - 8 * Math.sin(angle - 0.4));
      ctx.lineTo(arrowX - 8 * Math.cos(angle + 0.4), arrowY - 8 * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,110,200,0.4)';
      ctx.fill();
    });

    // Draw nodes
    graphNodes.forEach(n => {
      const score = n.riskScore || 0;
      const color = score >= 7 ? '#ff4757' : score >= 4 ? '#ffb347' : score >= 1 ? '#2ecc71' : '#555570';

      // Glow
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius + 4, 0, Math.PI * 2);
      ctx.fillStyle = color + '22';
      ctx.fill();

      // Node circle
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = color + '33';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();

      // Label
      const label = domainShort(n.domain).replace(/\.(com|fr|net|org|io)$/, '');
      const short = label.length > 10 ? label.substring(0, 9) + '…' : label;
      ctx.font = `${Math.max(9, n.radius * 0.55)}px DM Sans, sans-serif`;
      ctx.fillStyle = '#e8e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(short, n.x, n.y);

      // Visit count (below)
      ctx.font = '9px Space Mono, monospace';
      ctx.fillStyle = color;
      ctx.fillText(`×${n.visits}`, n.x, n.y + n.radius + 9);
    });
  }

  simulate();
}

// ── Refresh button ──

document.getElementById('btn-refresh').addEventListener('click', () => {
  document.getElementById('trackers-content').innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div style="font-size:11px">Actualisation…</div>
    </div>`;
  if (currentTabId) {
    chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      files: ['src/content.js']
    }).catch(() => {}).finally(() => {
      setTimeout(loadData, 800);
    });
  }
});

// ── Clear session ──

document.getElementById('btn-clear').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' }, () => {
    graphData = { nodes: {}, edges: [] };
    graphNodes = [];
    graphEdges = [];
    renderGraphList();
    const canvas = document.getElementById('graph-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('tab-count-graph').textContent = '0';
  });
});

// ── Footer timestamp ──

function updateFooter() {
  if (pageData?.timestamp) {
    const diff = Math.round((Date.now() - pageData.timestamp) / 1000);
    const txt = diff < 60 ? `Analysé il y a ${diff}s` : `Analysé il y a ${Math.round(diff/60)}min`;
    document.getElementById('footer-text').textContent = txt + ' · 100% local';
  }
}

// ── Init ──

loadData();
setInterval(updateFooter, 5000);
