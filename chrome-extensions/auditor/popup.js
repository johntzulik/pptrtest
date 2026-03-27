// popup.js — Page Auditor main logic

let state = {
  sites: [],
  reports: [],
  lastAudit: null
};

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
(async () => {
  await loadStorage();
  renderSitesList();
  renderReportsList();
  bindEvents();
  await showCurrentUrl();
})();

async function loadStorage() {
  const data = await chrome.storage.local.get(['sites', 'reports']);
  if (data.sites)   state.sites   = data.sites;
  if (data.reports) state.reports = data.reports;
}

async function saveStorage() {
  await chrome.storage.local.set({ sites: state.sites, reports: state.reports });
}

async function showCurrentUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) document.getElementById('current-url').textContent = tab.url;
}

// ─────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────
function bindEvents() {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Collapsible sections
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.section').classList.toggle('collapsed');
    });
  });

  // Audit button
  document.getElementById('btn-audit').addEventListener('click', runAudit);

  // Save report
  document.getElementById('btn-save').addEventListener('click', saveCurrentReport);

  // Clear reports
  document.getElementById('btn-clear-reports').addEventListener('click', async () => {
    if (!confirm('Clear all saved reports?')) return;
    state.reports = [];
    await saveStorage();
    renderReportsList();
  });

  // Add site
  document.getElementById('btn-add-site').addEventListener('click', () => openSiteForm());
  document.getElementById('site-form-cancel').addEventListener('click', () => {
    document.getElementById('site-form').style.display = 'none';
  });
  document.getElementById('site-form-save').addEventListener('click', saveSite);
}

// ─────────────────────────────────────────────
// Audit
// ─────────────────────────────────────────────
async function runAudit() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { toast('No active tab found', 'error'); return; }

  // Check if auditable
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    toast('Cannot audit browser pages', 'error');
    return;
  }

  showLoading(true);
  document.getElementById('btn-audit').disabled = true;
  document.getElementById('audit-status').textContent = 'Collecting metrics...';

  try {
    // Clear previous pending data
    await chrome.storage.session.remove('pendingAudit');

    // Inject content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    // Wait for content script to post data (up to 10s)
    const data = await waitForAuditData(10000);

    state.lastAudit = data;
    renderAuditResults(data);
    document.getElementById('btn-save').disabled = false;
    document.getElementById('audit-status').textContent = 'Done ✓';

  } catch (err) {
    showLoading(false);
    showPlaceholder(true);
    document.getElementById('audit-status').textContent = 'Error: ' + err.message;
    toast('Audit failed: ' + err.message, 'error');
  } finally {
    document.getElementById('btn-audit').disabled = false;
    showLoading(false);
  }
}

function waitForAuditData(timeout) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;

    async function poll() {
      const { pendingAudit } = await chrome.storage.session.get('pendingAudit');
      if (pendingAudit) {
        await chrome.storage.session.remove('pendingAudit');
        resolve(pendingAudit);
      } else if (Date.now() > deadline) {
        reject(new Error('Timeout waiting for audit data'));
      } else {
        setTimeout(poll, 200);
      }
    }

    poll();
  });
}

// ─────────────────────────────────────────────
// Render audit results
// ─────────────────────────────────────────────
function renderAuditResults(data) {
  showPlaceholder(false);
  showLoading(false);
  document.getElementById('audit-results').style.display = 'block';

  // Scores
  const scores = computeScores(data);
  renderScores(scores);

  // Sections
  renderTimingSection(data.timing);
  renderSeoSection(data.seo);
  renderResourcesSection(data.resources, data.scripts, data.styles);
  renderA11ySection(data.a11y);
  renderRecommendations(data, scores);
}

// ── Scores (ported from core/audit.js) ────────────────────────────────────
function computeScores(data) {
  const perf = scorePerformance(data.timing);
  const seo  = scoreSEO(data.seo);
  const bp   = scoreBestPractices(data);
  const res  = scoreResources(data.resources);
  return { perf, seo, bp, res };
}

function scorePerformance(t) {
  let score = 100;
  if (!t) return 0;
  if (t.ttfb  > 600)  score -= 20; else if (t.ttfb  > 200)  score -= 10;
  if (t.fcp   > 3000) score -= 20; else if (t.fcp   > 1800) score -= 10;
  if (t.lcp   > 4000) score -= 20; else if (t.lcp   > 2500) score -= 10;
  if (t.cls   > 0.25) score -= 15; else if (t.cls   > 0.1)  score -= 7;
  if (t.loadEvent > 6000) score -= 15; else if (t.loadEvent > 3000) score -= 7;
  return Math.max(0, score);
}

function scoreSEO(s) {
  let score = 100;
  if (!s) return 0;
  if (!s.title)                                    score -= 20;
  else if (s.titleLength < 30 || s.titleLength > 60) score -= 10;
  if (!s.metaDescription)                          score -= 20;
  else if (s.metaDescLength < 120 || s.metaDescLength > 160) score -= 10;
  if (s.h1Count === 0)      score -= 15;
  else if (s.h1Count > 1)   score -= 10;
  if (!s.canonical)         score -= 10;
  if (s.imagesNoAlt > 0)    score -= Math.min(20, s.imagesNoAlt * 3);
  return Math.max(0, score);
}

function scoreBestPractices(data) {
  let score = 100;
  if (!data.viewport)         score -= 20;
  if (!data.seo?.isHttps)     score -= 20;
  if (data.mixedContent > 0)  score -= 15;
  return Math.max(0, score);
}

function scoreResources(res) {
  let score = 100;
  if (!res) return 0;
  if (res.transferKB > 3000) score -= 20; else if (res.transferKB > 1000) score -= 10;
  if (res.total > 100)       score -= 15; else if (res.total > 50)        score -= 7;
  return Math.max(0, score);
}

function renderScores({ perf, seo, bp, res }) {
  const render = (id, value) => {
    const el = document.getElementById(id);
    el.textContent = value;
    el.className = 'score-value ' + scoreClass(value);
  };
  render('score-perf', perf);
  render('score-seo',  seo);
  render('score-bp',   bp);
  render('score-res',  res);
}

function scoreClass(v) {
  if (v >= 90) return 'score-green';
  if (v >= 50) return 'score-yellow';
  return 'score-red';
}

// ── Section renderers ──────────────────────────────────────────────────────
function renderTimingSection(t) {
  if (!t) return;

  const rows = [
    ['TTFB',          fmt(t.ttfb, 'ms'),    t.ttfb  < 200  ? 'good' : t.ttfb  < 600  ? 'warn' : 'bad'],
    ['FCP',           fmt(t.fcp,  'ms'),    t.fcp   < 1800 ? 'good' : t.fcp   < 3000 ? 'warn' : 'bad'],
    ['LCP',           fmt(t.lcp,  'ms'),    t.lcp   < 2500 ? 'good' : t.lcp   < 4000 ? 'warn' : 'bad'],
    ['CLS',           t.cls != null ? t.cls.toFixed(3) : '—', t.cls < 0.1 ? 'good' : t.cls < 0.25 ? 'warn' : 'bad'],
    ['Page Load',     fmt(t.loadEvent, 'ms'), t.loadEvent < 3000 ? 'good' : t.loadEvent < 6000 ? 'warn' : 'bad'],
    ['DOM Complete',  fmt(t.domComplete, 'ms'), 'neutral'],
    ['DNS Lookup',    fmt(t.dns,  'ms'), 'neutral'],
    ['TCP Connect',   fmt(t.tcp,  'ms'), 'neutral'],
    ['TLS Handshake', fmt(t.tls,  'ms'), 'neutral'],
    ['Transfer Size', formatBytes(t.transferSize), 'neutral']
  ];

  document.getElementById('body-timing').innerHTML = metricTable(rows);
}

function renderSeoSection(s) {
  if (!s) return;

  const rows = [
    ['Title',          s.title ? `"${s.title.slice(0,40)}${s.title.length>40?'…':''}"` : '✗ Missing', s.title ? (s.titleLength>=30&&s.titleLength<=60?'good':'warn') : 'bad'],
    ['Title Length',   s.titleLength + ' chars', s.titleLength>=30&&s.titleLength<=60?'good':(s.titleLength>0?'warn':'bad')],
    ['Meta Desc.',     s.metaDescription ? '✓ Present' : '✗ Missing', s.metaDescription ? 'good' : 'bad'],
    ['Meta Desc Len',  s.metaDescLength + ' chars', s.metaDescLength>=120&&s.metaDescLength<=160?'good':(s.metaDescLength>0?'warn':'bad')],
    ['H1 Count',       s.h1Count, s.h1Count===1?'good':(s.h1Count===0?'bad':'warn')],
    ['H1 Text',        s.h1Text ? `"${s.h1Text.slice(0,35)}…"` : '—', 'neutral'],
    ['Canonical',      s.canonical ? '✓ Present' : '✗ Missing', s.canonical ? 'good' : 'warn'],
    ['HTTPS',          s.isHttps ? '✓ Yes' : '✗ No', s.isHttps ? 'good' : 'bad'],
    ['Images w/o Alt', s.imagesNoAlt + ' / ' + s.imagesTotal, s.imagesNoAlt===0?'good':s.imagesNoAlt<5?'warn':'bad'],
    ['Robots Meta',    s.robotsMeta || 'none', 'neutral']
  ];

  document.getElementById('body-seo').innerHTML = metricTable(rows);
}

function renderResourcesSection(res, scripts, styles) {
  if (!res) return;

  const rows = [
    ['Total Requests',  res.total, res.total<50?'good':res.total<100?'warn':'bad'],
    ['Transfer Size',   res.transferKB + ' KB', res.transferKB<500?'good':res.transferKB<1000?'warn':'bad'],
    ['Scripts',         scripts ? `${scripts.total} (${scripts.external} ext, ${scripts.defer} defer, ${scripts.async} async)` : '—', 'neutral'],
    ['Stylesheets',     styles ? `${styles.external} external, ${styles.inline} inline` : '—', 'neutral']
  ];

  document.getElementById('body-resources').innerHTML = metricTable(rows);
}

function renderA11ySection(a) {
  if (!a) return;

  const headStr = Object.entries(a.headings || {}).map(([k,v]) => `${k}:${v}`).join(' ');

  const rows = [
    ['Images w/o Alt',    a.imagesNoAlt,     a.imagesNoAlt===0?'good':a.imagesNoAlt<5?'warn':'bad'],
    ['Unlabeled Inputs',  a.unlabeledInputs, a.unlabeledInputs===0?'good':a.unlabeledInputs<3?'warn':'bad'],
    ['Empty Buttons/Links', a.emptyButtons,  a.emptyButtons===0?'good':a.emptyButtons<3?'warn':'bad'],
    ['Heading Structure', headStr || '—', 'neutral']
  ];

  document.getElementById('body-a11y').innerHTML = metricTable(rows);
}

// ── Recommendations (ported from core/audit.js) ───────────────────────────
function renderRecommendations(data, scores) {
  const recos = generateRecommendations(data, scores);
  const list = document.getElementById('reco-list');

  if (!recos.length) {
    list.innerHTML = '<div style="color:var(--green);font-size:12px;">✓ No critical issues found</div>';
    return;
  }

  list.innerHTML = recos.map(r => `
    <div class="reco-item ${r.priority}">
      <div class="reco-title">${r.title}</div>
      <div class="reco-desc">${r.description}</div>
    </div>
  `).join('');
}

function generateRecommendations(data, scores) {
  const recos = [];
  const t = data.timing || {};
  const s = data.seo    || {};
  const a = data.a11y   || {};
  const r = data.resources || {};

  if (t.ttfb > 600)
    recos.push({ priority: 'high', title: 'Reduce Server Response Time (TTFB)', description: `TTFB is ${Math.round(t.ttfb)}ms. Target < 200ms. Check server caching, CDN, and database queries.` });

  if (t.fcp > 3000)
    recos.push({ priority: 'high', title: 'Improve First Contentful Paint', description: `FCP is ${Math.round(t.fcp)}ms. Target < 1800ms. Eliminate render-blocking resources, optimize CSS delivery.` });

  if (t.lcp > 2500)
    recos.push({ priority: 'high', title: 'Improve Largest Contentful Paint', description: `LCP is ${Math.round(t.lcp)}ms. Target < 2500ms. Optimize the hero image, use fetchpriority="high" on LCP element.` });

  if (t.cls > 0.1)
    recos.push({ priority: 'high', title: 'Fix Cumulative Layout Shift', description: `CLS is ${t.cls.toFixed(3)}. Target < 0.1. Add width/height to images and embeds, avoid inserting content above existing content.` });

  if (!s.title)
    recos.push({ priority: 'high', title: 'Add Page Title', description: 'The page is missing a <title> tag. This is critical for SEO and browser UX.' });

  if (!s.metaDescription)
    recos.push({ priority: 'medium', title: 'Add Meta Description', description: 'Missing meta description. Add one between 120–160 characters to improve CTR in search results.' });

  if (s.h1Count === 0)
    recos.push({ priority: 'high', title: 'Add H1 Heading', description: 'No H1 heading found. Every page should have exactly one H1 for SEO and accessibility.' });

  if (s.h1Count > 1)
    recos.push({ priority: 'medium', title: 'Fix Multiple H1 Headings', description: `Found ${s.h1Count} H1 headings. Use only one H1 per page.` });

  if (!s.canonical)
    recos.push({ priority: 'medium', title: 'Add Canonical Tag', description: 'No canonical link found. Add <link rel="canonical"> to prevent duplicate content issues.' });

  if (s.imagesNoAlt > 0)
    recos.push({ priority: 'medium', title: 'Add Alt Text to Images', description: `${s.imagesNoAlt} image(s) missing alt attributes. Required for accessibility and SEO.` });

  if (!data.viewport)
    recos.push({ priority: 'high', title: 'Add Viewport Meta Tag', description: 'Missing <meta name="viewport">. Required for proper mobile rendering.' });

  if (!s.isHttps)
    recos.push({ priority: 'high', title: 'Migrate to HTTPS', description: 'The page is served over HTTP. HTTPS is required for security and SEO ranking.' });

  if (data.mixedContent > 0)
    recos.push({ priority: 'medium', title: 'Fix Mixed Content', description: `${data.mixedContent} HTTP resource(s) loaded on an HTTPS page. Update to HTTPS.` });

  if (r.transferKB > 1000)
    recos.push({ priority: 'medium', title: 'Reduce Page Weight', description: `Total transfer is ${r.transferKB}KB. Target < 500KB. Compress images, minify JS/CSS, enable GZIP/Brotli.` });

  if (r.total > 50)
    recos.push({ priority: 'low', title: 'Reduce HTTP Requests', description: `${r.total} requests detected. Consolidate scripts and stylesheets, use CSS sprites or SVGs.` });

  if (a.imagesNoAlt > 0)
    recos.push({ priority: 'medium', title: 'Fix Image Accessibility', description: `${a.imagesNoAlt} image(s) without alt text. Screen readers cannot interpret these images.` });

  if (a.unlabeledInputs > 0)
    recos.push({ priority: 'high', title: 'Label Form Inputs', description: `${a.unlabeledInputs} form input(s) without labels. Add <label for="..."> or aria-label attributes.` });

  if (a.emptyButtons > 0)
    recos.push({ priority: 'medium', title: 'Add Text to Buttons/Links', description: `${a.emptyButtons} button(s) or link(s) with no text content. Add visible text or aria-label.` });

  // Sort by priority
  const order = { high: 0, medium: 1, low: 2 };
  recos.sort((a, b) => order[a.priority] - order[b.priority]);

  return recos;
}

// ─────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────
async function saveCurrentReport() {
  if (!state.lastAudit) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const scores = computeScores(state.lastAudit);

  const report = {
    id:    Date.now().toString(),
    url:   state.lastAudit.url,
    title: state.lastAudit.title || tab?.title || 'Untitled',
    date:  new Date().toISOString(),
    scores,
    data:  state.lastAudit
  };

  state.reports.unshift(report);
  if (state.reports.length > 30) state.reports = state.reports.slice(0, 30);

  await saveStorage();
  renderReportsList();
  toast('Report saved ✓', 'success');
  document.getElementById('btn-save').disabled = true;
}

function renderReportsList() {
  const container = document.getElementById('report-list');

  if (!state.reports.length) {
    container.innerHTML = '<div class="placeholder"><div class="placeholder-icon">📋</div>No reports yet</div>';
    return;
  }

  container.innerHTML = state.reports.map((r, i) => {
    const avg = Math.round((r.scores.perf + r.scores.seo + r.scores.bp + r.scores.res) / 4);
    return `
      <div class="report-item">
        <div class="report-info">
          <div class="report-site" title="${r.url}">${r.title.slice(0, 36)}${r.title.length > 36 ? '…' : ''}</div>
          <div class="report-date">${new Date(r.date).toLocaleString()}</div>
        </div>
        <span class="badge ${scoreClass(avg).replace('score-', 'badge-')}">${avg}</span>
        <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" data-delete="${i}">✕</button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.reports.splice(parseInt(btn.dataset.delete), 1);
      await saveStorage();
      renderReportsList();
    });
  });
}

// ─────────────────────────────────────────────
// Sites
// ─────────────────────────────────────────────
function openSiteForm(index = null) {
  document.getElementById('site-form').style.display = 'block';
  document.getElementById('site-form-title').textContent = index !== null ? 'Edit Site' : 'Add Site';
  document.getElementById('edit-site-index').value = index !== null ? index : '';
  const site = index !== null ? state.sites[index] : null;
  document.getElementById('site-name').value = site?.name || '';
  document.getElementById('site-url').value  = site?.url  || '';
}

async function saveSite() {
  const name = document.getElementById('site-name').value.trim();
  const url  = document.getElementById('site-url').value.trim();
  if (!name || !url) { toast('Fill in all fields', 'error'); return; }

  const indexStr = document.getElementById('edit-site-index').value;
  const site = { name, url };

  if (indexStr !== '') {
    state.sites[parseInt(indexStr)] = site;
  } else {
    state.sites.push(site);
  }

  await saveStorage();
  document.getElementById('site-form').style.display = 'none';
  renderSitesList();
  toast(`Site "${name}" saved`, 'success');
}

function renderSitesList() {
  const container = document.getElementById('sites-list');

  if (!state.sites.length) {
    container.innerHTML = '<div class="placeholder"><div class="placeholder-icon">🏗</div>No sites yet</div>';
    return;
  }

  container.innerHTML = state.sites.map((s, i) => `
    <div class="report-item" style="margin-bottom:6px;">
      <div class="report-info">
        <div class="report-site">${s.name}</div>
        <div class="report-date">${s.url}</div>
      </div>
      <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" data-audit-site="${i}">Audit</button>
      <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" data-edit-site="${i}">Edit</button>
      <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" data-delete-site="${i}">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('[data-audit-site]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const site = state.sites[parseInt(btn.dataset.auditSite)];
      // Navigate current tab to site URL then audit
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.update(tab.id, { url: site.url });
      // Switch to audit tab and wait for navigation
      document.querySelectorAll('.tab-btn')[0].click();
      document.getElementById('audit-status').textContent = 'Navigating to ' + site.url + '...';
      // Small delay then audit
      setTimeout(runAudit, 3000);
    });
  });

  container.querySelectorAll('[data-edit-site]').forEach(btn => {
    btn.addEventListener('click', () => openSiteForm(parseInt(btn.dataset.editSite)));
  });

  container.querySelectorAll('[data-delete-site]').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.sites.splice(parseInt(btn.dataset.deleteSite), 1);
      await saveStorage();
      renderSitesList();
    });
  });
}

// ─────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────
function showLoading(show) {
  document.getElementById('audit-loading').style.display = show ? 'block' : 'none';
}

function showPlaceholder(show) {
  document.getElementById('audit-placeholder').style.display = show ? 'block' : 'none';
  if (show) document.getElementById('audit-results').style.display = 'none';
}

function metricTable(rows) {
  return rows.map(([name, val, status = 'neutral']) => `
    <div class="metric-row">
      <span class="metric-name">${name}</span>
      <span class="metric-value val-${status}">${val ?? '—'}</span>
    </div>
  `).join('');
}

function fmt(ms, unit = 'ms') {
  if (ms == null || isNaN(ms)) return '—';
  if (unit === 'ms') return Math.round(ms) + ' ms';
  return ms;
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes > 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function toast(msg, type = 'info') {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
