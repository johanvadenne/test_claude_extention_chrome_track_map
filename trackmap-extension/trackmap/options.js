// TrackMap Options Page
// Stockage via chrome.storage.sync (synchronisé entre appareils)

'use strict';

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULTS = {
  verbosity:       'standard',  // 'minimal' | 'standard' | 'strict'
  badgeEnabled:    true,
  badgeColor:      true,
  autoRefresh:     true,
  webRequest:      true,
  syncEnabled:     true,
  blockedDomains:  []
};

const VERB_DESCS = {
  minimal:  'Signale uniquement les trackers confirmés avec correspondance exacte dans la base. Idéal si vous voulez réduire les faux positifs.',
  standard: 'Détecte les trackers connus (base de données + correspondance par sous-domaine). Recommandé pour la plupart des utilisateurs.',
  strict:   'Signale tous les domaines tiers inconnus comme suspects, en plus des trackers identifiés. Maximum de visibilité, peut générer du bruit.'
};

// ── Storage helpers ─────────────────────────────────────────────────────────

async function getOptions() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULTS, result => resolve({ ...DEFAULTS, ...result }));
  });
}

async function setOption(key, value) {
  return new Promise(resolve => {
    chrome.storage.sync.set({ [key]: value }, resolve);
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast visible ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 2200);
}

// ── Navigation sidebar ─────────────────────────────────────────────────────

document.querySelectorAll('.nav-item[data-section]').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`section-${item.dataset.section}`).classList.add('active');
  });
});

// ── Toggle helper ──────────────────────────────────────────────────────────

function bindToggle(id, optionKey, onchange) {
  const el = document.getElementById(id);
  if (!el) return;

  el.addEventListener('click', async () => {
    const isOn = el.classList.contains('on');
    el.classList.toggle('on', !isOn);
    el.setAttribute('aria-checked', String(!isOn));
    await setOption(optionKey, !isOn);
    if (onchange) onchange(!isOn);
    showToast('Option enregistrée', 'success');
  });

  el.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); el.click(); }
  });
}

function setToggle(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('on', value);
  el.setAttribute('aria-checked', String(value));
}

// ── Verbosity selector ─────────────────────────────────────────────────────

function bindVerbosity(current) {
  document.querySelectorAll('.verb-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.verb === current);
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.verb-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('verb-desc').textContent = VERB_DESCS[btn.dataset.verb];
      await setOption('verbosity', btn.dataset.verb);
      showToast('Niveau de détection mis à jour', 'success');
    });
  });
  document.getElementById('verb-desc').textContent = VERB_DESCS[current];
}

// ── Blocked domains ────────────────────────────────────────────────────────

let blockedDomains = [];

function renderTags() {
  const container = document.getElementById('domain-tags');
  const empty     = document.getElementById('domain-empty');
  empty.style.display = blockedDomains.length ? 'none' : 'block';

  // Remove old tags (keep empty span)
  container.querySelectorAll('.domain-tag').forEach(t => t.remove());

  blockedDomains.forEach(domain => {
    const tag = document.createElement('div');
    tag.className = 'domain-tag';
    tag.innerHTML = `<span>${domain}</span><button class="tag-remove" aria-label="Supprimer ${domain}">×</button>`;
    tag.querySelector('.tag-remove').addEventListener('click', async () => {
      blockedDomains = blockedDomains.filter(d => d !== domain);
      await setOption('blockedDomains', blockedDomains);
      renderTags();
      showToast(`${domain} retiré`, 'success');
    });
    container.appendChild(tag);
  });
}

function bindDomainInput() {
  const input  = document.getElementById('domain-input');
  const addBtn = document.getElementById('btn-add-domain');

  function normalizeDomain(val) {
    return val.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }

  function isValid(val) {
    const d = normalizeDomain(val);
    return d.length > 3 && d.includes('.') && /^[a-z0-9._-]+$/.test(d);
  }

  input.addEventListener('input', () => {
    addBtn.disabled = !isValid(input.value);
  });

  async function addDomain() {
    const domain = normalizeDomain(input.value);
    if (!isValid(input.value)) return;
    if (blockedDomains.includes(domain)) {
      showToast('Ce domaine est déjà exclu');
      return;
    }
    blockedDomains = [...blockedDomains, domain];
    await setOption('blockedDomains', blockedDomains);
    renderTags();
    input.value  = '';
    addBtn.disabled = true;
    showToast(`${domain} ajouté`, 'success');
  }

  addBtn.addEventListener('click', addDomain);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') addDomain(); });
}

// ── Badge toggle → notifier le background ─────────────────────────────────

function onBadgeToggle(enabled) {
  chrome.runtime.sendMessage({ type: 'SET_BADGE_ENABLED', enabled }).catch(() => {});
}

// ── Clear all data ─────────────────────────────────────────────────────────

document.getElementById('btn-clear-data')?.addEventListener('click', async () => {
  if (!confirm('Effacer toutes les données TrackMap ? (graphe de session, historique, options)')) return;
  await chrome.storage.local.clear();
  await chrome.storage.sync.clear();
  showToast('Toutes les données ont été effacées', 'success');
});

// ── About section ──────────────────────────────────────────────────────────

async function loadAbout() {
  // Version depuis le manifest
  const manifest = chrome.runtime.getManifest();
  document.getElementById('version-info').textContent =
    `Version ${manifest.version} · Manifest V${manifest.manifest_version}`;

  // Métadonnées DB
  chrome.runtime.sendMessage({ type: 'GET_DB_META' }, meta => {
    if (meta) {
      document.getElementById('about-db-count').textContent = meta.count?.toLocaleString('fr-FR') || '—';
      document.getElementById('about-db-date').textContent  = meta.version ? `Base du ${meta.version}` : '—';
    }
  });

  // Graphe de session
  const result = await new Promise(r => chrome.storage.local.get('sessionGraph', r));
  const nodes  = result.sessionGraph?.nodes || {};
  document.getElementById('about-session-nodes').textContent = Object.keys(nodes).length;

  // Navigateur
  const ua = navigator.userAgent;
  const browser = ua.includes('Firefox') ? 'Firefox' : ua.includes('Edg') ? 'Edge' : 'Chrome';
  const match   = ua.match(/(?:Chrome|Firefox|Edg)\/(\d+)/);
  document.getElementById('about-browser').textContent     = browser;
  document.getElementById('about-browser-sub').textContent = match ? `Version ${match[1]}` : '';

  // Stockage utilisé
  chrome.storage.local.getBytesInUse(null, bytes => {
    const kb = (bytes / 1024).toFixed(1);
    document.getElementById('about-storage').textContent = `${kb} KB`;
  });
}

// ── Lien vers privacy.html ─────────────────────────────────────────────────

document.getElementById('link-privacy-page')?.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('privacy.html') });
});

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  const opts = await getOptions();

  // Détection
  bindVerbosity(opts.verbosity);
  bindToggle('toggle-webrequest',  'webRequest',   null);
  bindToggle('toggle-sync',        'syncEnabled',  null);
  setToggle('toggle-webrequest', opts.webRequest);
  setToggle('toggle-sync',       opts.syncEnabled);

  // Affichage
  bindToggle('toggle-badge',        'badgeEnabled',  onBadgeToggle);
  bindToggle('toggle-badge-color',  'badgeColor',    null);
  bindToggle('toggle-auto-refresh', 'autoRefresh',   null);
  setToggle('toggle-badge',        opts.badgeEnabled);
  setToggle('toggle-badge-color',  opts.badgeColor);
  setToggle('toggle-auto-refresh', opts.autoRefresh);

  // Sites exclus
  blockedDomains = opts.blockedDomains || [];
  bindDomainInput();
  renderTags();

  // À propos
  loadAbout();
}

init();
