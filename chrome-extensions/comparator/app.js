// app.js — Page Comparator main UI logic
import { pixelmatch } from './lib/pixelmatch.js';

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let state = {
  sites: [],
  devices: {
    desktop: { width: 1440, height: 900 },
    mobile:  { width: 375,  height: 812 }
  },
  reports: [],
  captures: { prod: null, staging: null }, // base64 data URLs
  currentDevice: 'desktop'
};

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
(async () => {
  await loadStorage();
  renderSiteSelect();
  renderSitesList();
  renderReportsList();
  bindEvents();
  updateHeaderDevice();
})();

// ─────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────
async function loadStorage() {
  const data = await chrome.storage.local.get(['sites', 'devices', 'reports']);
  if (data.sites)   state.sites   = data.sites;
  if (data.devices) state.devices = data.devices;
  if (data.reports) state.reports = data.reports;
}

async function saveStorage() {
  await chrome.storage.local.set({
    sites:   state.sites,
    devices: state.devices,
    reports: state.reports
  });
}

// ─────────────────────────────────────────────
// Event bindings
// ─────────────────────────────────────────────
function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Device selector
  document.getElementById('device-select').addEventListener('change', e => {
    state.currentDevice = e.target.value;
    updateHeaderDevice();
    resetCaptures();
  });

  // Site selector
  document.getElementById('site-select').addEventListener('change', updateUrlDisplays);

  // Capture buttons
  document.getElementById('btn-capture-prod').addEventListener('click', () => capturePhase('prod'));
  document.getElementById('btn-capture-staging').addEventListener('click', () => capturePhase('staging'));

  // Compare button
  document.getElementById('btn-compare').addEventListener('click', runComparison);

  // Clear button
  document.getElementById('btn-clear').addEventListener('click', () => {
    resetCaptures();
    document.getElementById('diff-viewer').classList.remove('active');
  });

  // Save report
  document.getElementById('btn-save-report').addEventListener('click', saveReport);

  // Diff view tabs
  document.querySelectorAll('.diff-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.diff-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.diff-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('view-' + tab.dataset.view).classList.add('active');
    });
  });

  // Slider interaction
  initSlider();

  // Add site modal
  document.getElementById('btn-add-site').addEventListener('click', () => openSiteModal());
  document.getElementById('modal-site-close').addEventListener('click', closeSiteModal);
  document.getElementById('modal-site-cancel').addEventListener('click', closeSiteModal);
  document.getElementById('modal-site-save').addEventListener('click', saveSiteModal);
  document.getElementById('btn-add-page').addEventListener('click', addPageRow);

  // Clear reports
  document.getElementById('btn-clear-reports').addEventListener('click', async () => {
    if (!confirm('Clear all reports?')) return;
    state.reports = [];
    await saveStorage();
    renderReportsList();
  });

  // Report modal close
  document.getElementById('modal-report-close').addEventListener('click', () => {
    document.getElementById('modal-report').classList.remove('open');
  });
}

// ─────────────────────────────────────────────
// Device helpers
// ─────────────────────────────────────────────
function currentDeviceConfig() {
  return state.devices[state.currentDevice];
}

function updateHeaderDevice() {
  const d = currentDeviceConfig();
  const label = state.currentDevice === 'desktop' ? 'Desktop' : 'Mobile';
  document.getElementById('header-device').textContent = `${label} ${d.width}×${d.height}`;
}

// ─────────────────────────────────────────────
// URL helpers
// ─────────────────────────────────────────────
function getUrls() {
  const manualProd    = document.getElementById('manual-prod').value.trim();
  const manualStaging = document.getElementById('manual-staging').value.trim();

  if (manualProd && manualStaging) {
    return { prod: manualProd, staging: manualStaging };
  }

  const siteIndex = document.getElementById('site-select').value;
  if (siteIndex === '') return null;

  const site = state.sites[parseInt(siteIndex)];
  return { prod: site.prodUrl, staging: site.stagingUrl };
}

function updateUrlDisplays() {
  const urls = getUrls();
  document.getElementById('prod-url-display').textContent    = urls?.prod    || 'No URL selected';
  document.getElementById('staging-url-display').textContent = urls?.staging || 'No URL selected';
}

// ─────────────────────────────────────────────
// Capture
// ─────────────────────────────────────────────
async function capturePhase(phase) {
  const urls = getUrls();
  if (!urls) { toast('Select a site or enter URLs first', 'error'); return; }

  const url = phase === 'prod' ? urls.prod : urls.staging;
  const device = currentDeviceConfig();
  const spinnerId = `spinner-${phase}`;
  const btnId     = `btn-capture-${phase}`;

  log(`Capturing ${phase} → ${url}`, 'info');
  document.getElementById(spinnerId).style.display = 'inline-block';
  document.getElementById(btnId).disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ action: 'capture', url, device });

    if (!response.ok) throw new Error(response.error);

    state.captures[phase] = response.dataUrl;
    showCapturePreview(phase, response.dataUrl, url);
    log(`${phase} captured ✓`, 'success');

    // Enable compare button if both are captured
    if (state.captures.prod && state.captures.staging) {
      document.getElementById('btn-compare').disabled = false;
    }
  } catch (err) {
    log(`Error capturing ${phase}: ${err.message}`, 'error');
    toast(`Failed to capture ${phase}: ${err.message}`, 'error');
  } finally {
    document.getElementById(spinnerId).style.display = 'none';
    document.getElementById(btnId).disabled = false;
  }
}

function showCapturePreview(phase, dataUrl, url) {
  const box = document.getElementById(`box-${phase}`);
  box.classList.add('has-capture');

  const existing = box.querySelector('img');
  if (existing) existing.remove();

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = phase;

  const urlDiv = box.querySelector('.capture-url');
  urlDiv.textContent = url;
  urlDiv.insertAdjacentElement('afterend', img);
}

function resetCaptures() {
  state.captures = { prod: null, staging: null };
  document.getElementById('btn-compare').disabled = true;
  updateUrlDisplays();

  ['prod', 'staging'].forEach(phase => {
    const box = document.getElementById(`box-${phase}`);
    box.classList.remove('has-capture');
    const img = box.querySelector('img');
    if (img) img.remove();
  });

  clearLog();
}

// ─────────────────────────────────────────────
// Comparison
// ─────────────────────────────────────────────
async function runComparison() {
  if (!state.captures.prod || !state.captures.staging) return;

  log('Running pixel comparison...', 'info');
  document.getElementById('btn-compare').disabled = true;

  try {
    const result = await compareImages(state.captures.prod, state.captures.staging);
    showDiffResult(result);
    log(`Done — ${result.diffPercent.toFixed(2)}% difference`, result.diffPercent < 1 ? 'success' : 'warn');
  } catch (err) {
    log(`Comparison error: ${err.message}`, 'error');
    toast('Comparison failed: ' + err.message, 'error');
  } finally {
    document.getElementById('btn-compare').disabled = false;
  }
}

async function compareImages(dataUrl1, dataUrl2) {
  const [img1, img2] = await Promise.all([loadImageData(dataUrl1), loadImageData(dataUrl2)]);

  // Normalize to same size (pad to max dimensions)
  const width  = Math.max(img1.width,  img2.width);
  const height = Math.max(img1.height, img2.height);

  const data1 = padImageData(img1, width, height);
  const data2 = padImageData(img2, width, height);
  const diffData = new Uint8ClampedArray(width * height * 4);

  const diffPixels = pixelmatch(data1, data2, diffData, width, height, { threshold: 0.1 });
  const totalPixels = width * height;
  const diffPercent = (diffPixels / totalPixels) * 100;

  // Build diff canvas
  const canvas = document.getElementById('diff-canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(diffData, width, height);
  ctx.putImageData(imageData, 0, 0);

  return { diffPixels, totalPixels, diffPercent, width, height, data1, data2, diffData };
}

function loadImageData(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, img.width, img.height);
      resolve(id);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function padImageData(imageData, targetW, targetH) {
  if (imageData.width === targetW && imageData.height === targetH) {
    return imageData.data;
  }
  const canvas = document.createElement('canvas');
  canvas.width  = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width  = imageData.width;
  tempCanvas.height = imageData.height;
  tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
  ctx.drawImage(tempCanvas, 0, 0);

  return ctx.getImageData(0, 0, targetW, targetH).data;
}

// ─────────────────────────────────────────────
// Show diff result
// ─────────────────────────────────────────────
function showDiffResult(result) {
  const { diffPercent, diffPixels, totalPixels } = result;

  let status, statusClass;
  if (diffPercent === 0)    { status = 'IDENTICAL'; statusClass = 'badge-green'; }
  else if (diffPercent < 1) { status = 'MINOR';     statusClass = 'badge-yellow'; }
  else                      { status = 'CHANGED';   statusClass = 'badge-red'; }

  const statStatus = document.getElementById('stat-status');
  statStatus.innerHTML = `<span class="badge ${statusClass}">${status}</span>`;
  document.getElementById('stat-diff').textContent   = diffPercent.toFixed(2) + '%';
  document.getElementById('stat-pixels').textContent = diffPixels.toLocaleString();
  document.getElementById('stat-total').textContent  = totalPixels.toLocaleString();

  // Feed images into all views
  const prodUrl    = state.captures.prod;
  const stagingUrl = state.captures.staging;

  document.getElementById('slider-base').src    = stagingUrl;
  document.getElementById('slider-top').src     = prodUrl;
  document.getElementById('sbs-prod').src       = prodUrl;
  document.getElementById('sbs-staging').src    = stagingUrl;
  document.getElementById('solo-prod').src      = prodUrl;
  document.getElementById('solo-staging').src   = stagingUrl;

  document.getElementById('diff-viewer').classList.add('active');

  // Scroll into view
  document.getElementById('diff-viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─────────────────────────────────────────────
// Slider
// ─────────────────────────────────────────────
function initSlider() {
  const wrap   = document.getElementById('slider-wrap');
  const handle = document.getElementById('slider-handle');
  const overlay = document.getElementById('slider-overlay');
  let dragging = false;

  function setPos(clientX) {
    const rect = wrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const pxPct = (pct * 100).toFixed(1) + '%';
    handle.style.left = pxPct;
    overlay.style.width = pxPct;
  }

  wrap.addEventListener('mousedown', e => { dragging = true; setPos(e.clientX); });
  window.addEventListener('mousemove', e => { if (dragging) setPos(e.clientX); });
  window.addEventListener('mouseup', () => { dragging = false; });
  wrap.addEventListener('touchstart', e => { dragging = true; setPos(e.touches[0].clientX); });
  window.addEventListener('touchmove', e => { if (dragging) setPos(e.touches[0].clientX); });
  window.addEventListener('touchend', () => { dragging = false; });
}

// ─────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────
async function saveReport() {
  const urls = getUrls();
  const siteIndex = document.getElementById('site-select').value;
  const siteName = siteIndex !== '' ? state.sites[parseInt(siteIndex)]?.name : 'Manual';

  const report = {
    id: Date.now().toString(),
    site: siteName,
    prodUrl: urls?.prod || '',
    stagingUrl: urls?.staging || '',
    device: state.currentDevice,
    date: new Date().toISOString(),
    prodImg: state.captures.prod,
    stagingImg: state.captures.staging,
    diffCanvas: document.getElementById('diff-canvas').toDataURL('image/png'),
    statDiff: document.getElementById('stat-diff').textContent,
    statStatus: document.getElementById('stat-status').innerText
  };

  state.reports.unshift(report);
  // Keep last 20 reports
  if (state.reports.length > 20) state.reports = state.reports.slice(0, 20);

  await saveStorage();
  renderReportsList();
  toast('Report saved', 'success');
}

function renderReportsList() {
  const container = document.getElementById('report-list');

  if (!state.reports.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">No reports yet. Run a comparison to get started.</div>
    </div>`;
    return;
  }

  container.innerHTML = state.reports.map((r, i) => `
    <div class="report-item">
      <div class="report-info">
        <div class="report-site">${r.site} — ${r.device}</div>
        <div class="report-date">${new Date(r.date).toLocaleString()} · diff: ${r.statDiff}</div>
      </div>
      <div class="report-actions">
        <button class="btn btn-ghost" data-report-idx="${i}">View</button>
        <button class="btn btn-danger" data-delete-report="${i}">✕</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-report-idx]').forEach(btn => {
    btn.addEventListener('click', () => viewReport(parseInt(btn.dataset.reportIdx)));
  });

  container.querySelectorAll('[data-delete-report]').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.reports.splice(parseInt(btn.dataset.deleteReport), 1);
      await saveStorage();
      renderReportsList();
    });
  });
}

function viewReport(index) {
  const r = state.reports[index];
  if (!r) return;

  document.getElementById('modal-report-title').textContent = `${r.site} — ${new Date(r.date).toLocaleString()}`;
  document.getElementById('modal-report-body').innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <span class="badge badge-blue">${r.device}</span>
      <span>Diff: <strong>${r.statDiff}</strong></span>
      <span>Status: <strong>${r.statStatus}</strong></span>
    </div>
    <div class="side-by-side" style="margin-bottom:12px;">
      <div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">PRODUCTION</div>
        <img src="${r.prodImg}" style="width:100%;border-radius:8px;">
      </div>
      <div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">STAGING</div>
        <img src="${r.stagingImg}" style="width:100%;border-radius:8px;">
      </div>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">DIFF MAP</div>
    <img src="${r.diffCanvas}" style="width:100%;border-radius:8px;">
  `;

  document.getElementById('modal-report').classList.add('open');
}

// ─────────────────────────────────────────────
// Sites
// ─────────────────────────────────────────────
function renderSiteSelect() {
  const sel = document.getElementById('site-select');
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">— choose a site —</option>';
  state.sites.forEach((site, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = site.name;
    sel.appendChild(opt);
  });
  sel.value = currentVal;
}

function renderSitesList() {
  const container = document.getElementById('sites-list');

  if (!state.sites.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🏗</div>
      <div class="empty-text">No sites yet. Add your first site to get started.</div>
    </div>`;
    return;
  }

  container.innerHTML = state.sites.map((site, i) => `
    <div class="site-item">
      <div style="flex:1">
        <div class="site-name">${site.name}</div>
        <div class="site-urls">${site.prodUrl} ↔ ${site.stagingUrl}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${site.pages?.length || 0} pages</div>
      </div>
      <div class="site-actions">
        <button class="btn btn-ghost" data-edit-site="${i}">Edit</button>
        <button class="btn btn-danger" data-delete-site="${i}">✕</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-edit-site]').forEach(btn => {
    btn.addEventListener('click', () => openSiteModal(parseInt(btn.dataset.editSite)));
  });

  container.querySelectorAll('[data-delete-site]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this site?')) return;
      state.sites.splice(parseInt(btn.dataset.deleteSite), 1);
      await saveStorage();
      renderSitesList();
      renderSiteSelect();
    });
  });
}

// Site modal
function openSiteModal(index = null) {
  const modal = document.getElementById('modal-site');
  const isEdit = index !== null;

  document.getElementById('modal-site-title').textContent = isEdit ? 'Edit Site' : 'Add Site';
  document.getElementById('edit-site-index').value = isEdit ? index : '';

  if (isEdit) {
    const site = state.sites[index];
    document.getElementById('site-name').value         = site.name;
    document.getElementById('site-prod-url').value     = site.prodUrl;
    document.getElementById('site-staging-url').value  = site.stagingUrl;
    renderPageRows(site.pages || []);
  } else {
    document.getElementById('site-name').value         = '';
    document.getElementById('site-prod-url').value     = '';
    document.getElementById('site-staging-url').value  = '';
    renderPageRows([{ id: '001', url: '/' }]);
  }

  modal.classList.add('open');
}

function closeSiteModal() {
  document.getElementById('modal-site').classList.remove('open');
}

async function saveSiteModal() {
  const name        = document.getElementById('site-name').value.trim();
  const prodUrl     = document.getElementById('site-prod-url').value.trim();
  const stagingUrl  = document.getElementById('site-staging-url').value.trim();

  if (!name || !prodUrl || !stagingUrl) {
    toast('Fill in all required fields', 'error');
    return;
  }

  const pages = collectPageRows();
  const site = { name, prodUrl, stagingUrl, pages };

  const indexStr = document.getElementById('edit-site-index').value;
  if (indexStr !== '') {
    state.sites[parseInt(indexStr)] = site;
  } else {
    state.sites.push(site);
  }

  await saveStorage();
  renderSitesList();
  renderSiteSelect();
  closeSiteModal();
  toast(`Site "${name}" saved`, 'success');
}

function renderPageRows(pages) {
  const list = document.getElementById('pages-list');
  list.innerHTML = '';
  pages.forEach(p => addPageRow(p));
}

function addPageRow(page = null) {
  const list = document.getElementById('pages-list');
  const row = document.createElement('div');
  row.className = 'page-row';
  row.innerHTML = `
    <input type="text" class="page-id" placeholder="001" value="${page?.id || ''}">
    <input type="text" class="page-url" placeholder="/path/" value="${page?.url || ''}">
    <button class="btn btn-danger" style="padding:6px 10px;" data-remove-page>✕</button>
  `;
  row.querySelector('[data-remove-page]').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function collectPageRows() {
  return [...document.querySelectorAll('.page-row')].map(row => ({
    id:  row.querySelector('.page-id').value.trim(),
    url: row.querySelector('.page-url').value.trim()
  })).filter(p => p.url);
}

// ─────────────────────────────────────────────
// Log
// ─────────────────────────────────────────────
function log(msg, level = 'info') {
  const panel = document.getElementById('log-panel');
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${msg}`;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
}

function clearLog() {
  const panel = document.getElementById('log-panel');
  panel.innerHTML = '<div class="log-line muted">Ready. Select a site and capture screenshots.</div>';
}

// ─────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────
function toast(msg, type = 'info') {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
