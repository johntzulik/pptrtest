/**
 * core/report.js - Report generation module
 *
 * Generates a self-contained HTML report with inlined CSS, JS, and data.
 * Also generates separate report.css, report.js, and data.json for
 * server-based workflows. Creates ZIP archive for sharing.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { execSync } = require("child_process");

// -- Report CSS ---------------------------------------------------------------

const REPORT_CSS = `/* Visual Regression Report Styles */
:root {
  --bg: #0f172a;
  --surface: #1e293b;
  --surface-hover: #334155;
  --border: #475569;
  --text: #e2e8f0;
  --text-muted: #94a3b8;
  --green: #22c55e;
  --yellow: #eab308;
  --red: #ef4444;
  --blue: #3b82f6;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

/* Header */
.header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 1.5rem 2rem;
  position: sticky;
  top: 0;
  z-index: 100;
}
.header h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
.header .subtitle { color: var(--text-muted); font-size: 0.875rem; }
.header-meta {
  display: flex; gap: 2rem; margin-top: 0.75rem;
  font-size: 0.8rem; color: var(--text-muted);
}
.header-meta span { display: flex; align-items: center; gap: 0.3rem; }

/* Stats */
.stats { display: flex; gap: 1rem; padding: 1.5rem 2rem; flex-wrap: wrap; }
.stat-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 1rem 1.5rem; min-width: 140px; text-align: center;
}
.stat-card .value { font-size: 2rem; font-weight: 700; }
.stat-card .label {
  font-size: 0.75rem; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.stat-card.green .value { color: var(--green); }
.stat-card.yellow .value { color: var(--yellow); }
.stat-card.red .value { color: var(--red); }
.stat-card.blue .value { color: var(--blue); }

/* Filters */
.filters { display: flex; gap: 0.5rem; padding: 0 2rem 1rem; flex-wrap: wrap; }
.filter-btn {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer;
  font-size: 0.8rem; transition: all 0.2s;
}
.filter-btn:hover { background: var(--surface-hover); }
.filter-btn.active { background: var(--blue); border-color: var(--blue); color: white; }

/* Table */
.table-container { padding: 0 2rem 1rem; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th {
  background: var(--surface); padding: 0.75rem 1rem; text-align: left;
  font-weight: 600; border-bottom: 2px solid var(--border);
  cursor: pointer; user-select: none; white-space: nowrap;
}
th:hover { background: var(--surface-hover); }
td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
tr:hover td { background: rgba(255,255,255,0.03); }

.badge {
  display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px;
  font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
}
.badge-green { background: rgba(34,197,94,0.15); color: var(--green); }
.badge-yellow { background: rgba(234,179,8,0.15); color: var(--yellow); }
.badge-red { background: rgba(239,68,68,0.15); color: var(--red); }
.badge-gray { background: rgba(148,163,184,0.15); color: var(--text-muted); }
.badge-device { background: rgba(59,130,246,0.15); color: var(--blue); }

.percent-bar { display: flex; align-items: center; gap: 0.5rem; }
.percent-bar-track {
  width: 80px; height: 6px; background: rgba(255,255,255,0.1);
  border-radius: 3px; overflow: hidden;
}
.percent-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }

.view-btn {
  background: var(--blue); color: white; border: none;
  padding: 0.35rem 0.75rem; border-radius: 4px; cursor: pointer;
  font-size: 0.75rem; white-space: nowrap;
}
.view-btn:hover { opacity: 0.85; }

/* Modal */
.modal-overlay {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,0.85); z-index: 200; overflow-y: auto;
}
.modal-overlay.active { display: block; }
.modal {
  max-width: 100vw; margin: 0rem auto; background: var(--surface);
  border-radius: 12px; border: 1px solid var(--border); overflow: hidden;
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 1rem 1.5rem; border-bottom: 1px solid var(--border);
}
.modal-header h2 { font-size: 1.1rem; }
.modal-close {
  background: none; border: none; color: var(--text-muted);
  font-size: 1.5rem; cursor: pointer; line-height: 1;
}
.modal-close:hover { color: var(--text); }
.modal-nav {
  background: none; border: 1px solid var(--border); color: var(--text);
  font-size: 1.1rem; padding: 0.25rem 0.6rem; border-radius: 4px;
  cursor: pointer; line-height: 1; flex-shrink: 0;
}
.modal-nav:hover { background: var(--surface-hover); }

.modal-tabs {
  display: flex; align-items: center;
  border-bottom: 1px solid var(--border);
}
.modal-tab {
  padding: 0.75rem 1.5rem; cursor: pointer;
  border-bottom: 2px solid transparent; color: var(--text-muted);
  font-size: 0.85rem; background: none;
  border-top: none; border-left: none; border-right: none;
}
.modal-tab:hover { color: var(--text); }
.modal-tab.active { color: var(--blue); border-bottom-color: var(--blue); }

.modal-links {
  margin-left: auto; display: flex; gap: 0.75rem;
  padding: 0 1.5rem; align-items: center;
}
.modal-links a {
  color: var(--blue); text-decoration: none; font-size: 0.8rem;
  padding: 0.3rem 0.7rem; border: 1px solid var(--blue);
  border-radius: 4px; transition: all 0.2s;
}
.modal-links a:hover { background: var(--blue); color: white; }

.modal-body { padding: 1.5rem; text-align: center; }
.modal-body img {
  max-width: 100%; height: auto;
  border: 1px solid var(--border); border-radius: 4px;
}
.modal-body .side-by-side {
  display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;
}
.modal-body .side-by-side > div { flex: 1; min-width: 300px; max-width: 50%; }
.modal-body .side-by-side > div h3 {
  font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;
}

/* Slider */
.slider-container {
  position: relative; overflow: hidden; cursor: col-resize;
  display: inline-block; max-width: 100%;
  border: 1px solid var(--border); border-radius: 4px;
}
.slider-container > img {
  display: block; max-width: 100%; height: auto;
  border: none; border-radius: 0; pointer-events: none;
}
.slider-layer-staging {
  position: absolute; top: 0; left: 0; height: 100%;
  overflow: hidden; border-right: 3px solid var(--blue);
}
.slider-layer-staging img {
  display: block; pointer-events: none;
  max-width: none;
}
.slider-handle {
  position: absolute; top: 0; width: 3px; height: 100%;
  background: var(--blue); cursor: col-resize; z-index: 10;
}
.slider-handle::after {
  content: ''; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--blue); border: 3px solid white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.slider-handle::before {
  content: '\\2194'; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%); z-index: 11;
  color: white; font-size: 18px; font-weight: bold;
}
.slider-labels {
  display: flex; justify-content: space-between;
  padding: 0.5rem 0; font-size: 0.8rem; color: var(--text-muted);
}

.hidden { display: none !important; }`;

// -- Report JS ----------------------------------------------------------------

const REPORT_JS = `/* Visual Regression Report Logic */
(function() {
  'use strict';

  var DATA = null;
  var activeFilter = 'all';
  var sortCol = null;
  var sortAsc = true;
  var currentView = 'side';
  var currentIdx = -1;

  // Use inlined data if available (file:// mode), otherwise fetch
  if (window.__REPORT_DATA__) {
    init(window.__REPORT_DATA__);
  } else {
    fetch('data.json')
      .then(function(r) { return r.json(); })
      .then(init)
      .catch(function(err) {
        document.getElementById('app').innerHTML =
          '<p style="color:var(--red);padding:2rem">Error loading data.json: ' + err.message + '</p>';
      });
  }

  function init(data) {
    DATA = data;
    renderHeader(data);
    renderStats(data.stats);
    renderTable(data.entries);
    bindFilters();
    bindSort();
    bindModalTabs();
    bindModalClose();
  }

  function renderHeader(data) {
    document.getElementById('hdr-title').textContent = 'Visual Regression Report';
    document.getElementById('hdr-subtitle').textContent =
      'Template: ' + data.template + ' | Production: ' + data.productionUrl + ' vs Staging: ' + data.stagingUrl;
    document.getElementById('hdr-generated').textContent = 'Generated: ' + new Date(data.generated).toLocaleString();
    document.getElementById('hdr-pages').textContent = 'Pages: ' + data.totalPages;
    document.getElementById('hdr-threshold').textContent = 'Threshold: ' + data.threshold;
  }

  function renderStats(s) {
    document.getElementById('stat-total').textContent = s.total;
    document.getElementById('stat-identical').textContent = s.identical;
    document.getElementById('stat-minor').textContent = s.minor;
    document.getElementById('stat-changed').textContent = s.changed;
    var failedCard = document.getElementById('stat-failed-card');
    if (s.failed > 0) {
      failedCard.classList.remove('hidden');
      document.getElementById('stat-failed').textContent = s.failed;
    }
  }

  function renderTable(entries) {
    var tbody = document.getElementById('tbody');
    var html = '';
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var status = !e.success ? 'failed' : e.mismatchPercentage === 0 ? 'identical' : 'changed';
      var barColor = e.mismatchPercentage === 0 ? 'var(--green)' : e.mismatchPercentage < 1 ? 'var(--yellow)' : 'var(--red)';
      var badgeClass = !e.success ? 'badge-gray' : e.mismatchPercentage === 0 ? 'badge-green' : e.mismatchPercentage < 1 ? 'badge-yellow' : 'badge-red';
      var badgeText = !e.success ? 'ERROR' : e.mismatchPercentage === 0 ? 'IDENTICAL' : e.mismatchPercentage < 1 ? 'MINOR' : 'CHANGED';

      html += '<tr class="comparison-row" data-idx="' + i + '" data-device="' + e.device + '" data-status="' + status + '" data-mismatch="' + e.mismatchPercentage + '">';
      html += '<td>' + e.id + '</td>';
      html += '<td title="' + e.url + '">' + e.name + '</td>';
      html += '<td><span class="badge badge-device">' + e.device + '</span></td>';
      if (e.success) {
        html += '<td><div class="percent-bar"><div class="percent-bar-track"><div class="percent-bar-fill" style="width:' + Math.min(e.mismatchPercentage, 100) + '%;background:' + barColor + '"></div></div><span>' + e.mismatchPercentage + '%</span></div></td>';
      } else {
        html += '<td><span style="color:var(--text-muted)">&mdash;</span></td>';
      }
      html += '<td><span class="badge ' + badgeClass + '">' + badgeText + '</span></td>';
      if (e.success) {
        html += '<td><button class="view-btn" data-idx="' + i + '">View</button></td>';
      } else {
        var errText = e.error ? (e.error.length > 30 ? e.error.substring(0, 30) + '...' : e.error) : 'Error';
        html += '<td><span style="color:var(--text-muted);font-size:0.75rem" title="' + (e.error || '').replace(/"/g, '&quot;') + '">' + errText + '</span></td>';
      }
      html += '</tr>';
    }
    tbody.innerHTML = html;

    tbody.addEventListener('click', function(ev) {
      var btn = ev.target.closest('.view-btn');
      if (btn) openModal(parseInt(btn.dataset.idx));
    });
  }

  function bindFilters() {
    document.querySelectorAll('.filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        applyFilters();
      });
    });
  }

  function applyFilters() {
    document.querySelectorAll('.comparison-row').forEach(function(row) {
      var device = row.dataset.device;
      var status = row.dataset.status;
      var visible = true;
      if (activeFilter === 'desktop' && device !== 'desktop') visible = false;
      if (activeFilter === 'mobile' && device !== 'mobile') visible = false;
      if (activeFilter === 'identical' && status !== 'identical') visible = false;
      if (activeFilter === 'changed' && status !== 'changed') visible = false;
      if (activeFilter === 'failed' && status !== 'failed') visible = false;
      row.classList.toggle('hidden', !visible);
    });
  }

  function bindSort() {
    document.querySelectorAll('th[data-sort]').forEach(function(th) {
      th.addEventListener('click', function() {
        var col = th.dataset.sort;
        if (sortCol === col) sortAsc = !sortAsc;
        else { sortCol = col; sortAsc = true; }
        doSort();
      });
    });
  }

  function doSort() {
    var tbody = document.getElementById('tbody');
    var rows = Array.from(tbody.querySelectorAll('tr'));
    rows.sort(function(a, b) {
      var va, vb;
      if (sortCol === 'mismatch') {
        va = parseFloat(a.dataset.mismatch); vb = parseFloat(b.dataset.mismatch);
        return sortAsc ? va - vb : vb - va;
      }
      if (sortCol === 'id')     { va = a.cells[0].textContent; vb = b.cells[0].textContent; }
      if (sortCol === 'name')   { va = a.cells[1].textContent; vb = b.cells[1].textContent; }
      if (sortCol === 'device') { va = a.dataset.device; vb = b.dataset.device; }
      if (sortCol === 'status') { va = a.dataset.status; vb = b.dataset.status; }
      return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    rows.forEach(function(r) { tbody.appendChild(r); });
  }

  function openModal(idx) {
    currentIdx = idx;
    currentView = 'side';
    document.querySelectorAll('.modal-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.view === 'side');
    });
    renderModal();
    document.getElementById('modal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('modal').classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('modal-body').innerHTML = '';
  }
  window.closeModal = closeModal;

  function bindModalTabs() {
    document.querySelectorAll('.modal-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        currentView = tab.dataset.view;
        document.querySelectorAll('.modal-tab').forEach(function(t) {
          t.classList.toggle('active', t.dataset.view === currentView);
        });
        renderModal();
      });
    });
  }

  function navigateModal(dir) {
    var visibleRows = Array.from(document.querySelectorAll('.comparison-row:not(.hidden)'));
    var visibleIdxs = visibleRows.map(function(r) { return parseInt(r.dataset.idx); });
    var pos = visibleIdxs.indexOf(currentIdx);
    if (pos === -1) return;
    var newPos = pos + dir;
    if (newPos < 0 || newPos >= visibleIdxs.length) return;
    currentIdx = visibleIdxs[newPos];
    document.querySelectorAll('.modal-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.view === currentView);
    });
    renderModal();
  }
  window.navigateModal = navigateModal;

  function bindModalClose() {
    document.getElementById('modal').addEventListener('click', function(ev) {
      if (ev.target === document.getElementById('modal')) closeModal();
    });
    document.addEventListener('keydown', function(ev) {
      if (!document.getElementById('modal').classList.contains('active')) return;
      if (ev.key === 'Escape')     closeModal();
      if (ev.key === 'ArrowLeft')  navigateModal(-1);
      if (ev.key === 'ArrowRight') navigateModal(1);
    });
  }

  function renderModal() {
    var e = DATA.entries[currentIdx];
    if (!e) return;
    document.getElementById('modal-title').textContent =
      e.name + ' (' + e.device + ') — ' + e.mismatchPercentage + '% diff';
    var body = document.getElementById('modal-body');
    var links = document.getElementById('modal-links');

    links.innerHTML =
      '<a href="' + DATA.productionUrl + e.url + '" target="_blank">Production</a>' +
      '<a href="' + DATA.stagingUrl + e.url + '" target="_blank">Staging</a>';

    if (currentView === 'diff') {
      body.innerHTML = '<img src="' + e.diffImg + '" alt="Diff" loading="lazy">';
    } else if (currentView === 'prod') {
      body.innerHTML = '<img src="' + e.prodImg + '" alt="Production" loading="lazy">';
    } else if (currentView === 'staging') {
      body.innerHTML = '<img src="' + e.stagingImg + '" alt="Staging" loading="lazy">';
    } else if (currentView === 'side') {
      body.innerHTML =
        '<div class="side-by-side">' +
        '<div><h3>Production</h3><img src="' + e.prodImg + '" alt="Production" loading="lazy"></div>' +
        '<div><h3>Staging</h3><img src="' + e.stagingImg + '" alt="Staging" loading="lazy"></div>' +
        '</div>';
    } else if (currentView === 'slider') {
      renderSlider(body, e);
    }
  }

  function renderSlider(container, entry) {
    container.innerHTML =
      '<div class="slider-labels"><span>Staging</span><span>Production</span></div>' +
      '<div class="slider-container" id="slider-box">' +
        '<img id="slider-prod" src="' + entry.prodImg + '" alt="Production">' +
        '<div class="slider-layer-staging" id="slider-clip">' +
          '<img id="slider-stag" src="' + entry.stagingImg + '" alt="Staging">' +
        '</div>' +
        '<div class="slider-handle" id="slider-handle"></div>' +
      '</div>';

    var prodImg = document.getElementById('slider-prod');
    var setup = function() {
      var box = document.getElementById('slider-box');
      var clip = document.getElementById('slider-clip');
      var handle = document.getElementById('slider-handle');
      var stagImg = document.getElementById('slider-stag');

      var w = prodImg.clientWidth;
      stagImg.style.width = w + 'px';
      var pos = w * 0.5;
      clip.style.width = pos + 'px';
      handle.style.left = pos + 'px';

      var dragging = false;

      function updatePos(clientX) {
        var rect = box.getBoundingClientRect();
        var x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        clip.style.width = x + 'px';
        handle.style.left = x + 'px';
      }

      box.addEventListener('mousedown', function(ev) { dragging = true; updatePos(ev.clientX); });
      document.addEventListener('mousemove', function(ev) { if (dragging) { ev.preventDefault(); updatePos(ev.clientX); } });
      document.addEventListener('mouseup', function() { dragging = false; });

      box.addEventListener('touchstart', function(ev) { dragging = true; updatePos(ev.touches[0].clientX); }, { passive: true });
      document.addEventListener('touchmove', function(ev) { if (dragging) updatePos(ev.touches[0].clientX); }, { passive: true });
      document.addEventListener('touchend', function() { dragging = false; });
    };

    if (prodImg.complete && prodImg.naturalWidth > 0) {
      setup();
    } else {
      prodImg.addEventListener('load', setup);
    }
  }

})();`;

// -- Report HTML body ---------------------------------------------------------

const REPORT_HTML_BODY = `
  <div id="app">
    <div class="header">
      <h1 id="hdr-title">Visual Regression Report</h1>
      <div class="subtitle" id="hdr-subtitle"></div>
      <div class="header-meta">
        <span id="hdr-generated"></span>
        <span id="hdr-pages"></span>
        <span id="hdr-threshold"></span>
      </div>
    </div>

    <div class="stats">
      <div class="stat-card blue"><div class="value" id="stat-total">0</div><div class="label">Total Comparisons</div></div>
      <div class="stat-card green"><div class="value" id="stat-identical">0</div><div class="label">Identical</div></div>
      <div class="stat-card yellow"><div class="value" id="stat-minor">0</div><div class="label">Minor (&lt;1%)</div></div>
      <div class="stat-card red"><div class="value" id="stat-changed">0</div><div class="label">Changed (&ge;1%)</div></div>
      <div class="stat-card hidden" id="stat-failed-card"><div class="value" id="stat-failed" style="color:var(--text-muted)">0</div><div class="label">Failed</div></div>
    </div>

    <div class="filters">
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="desktop">Desktop</button>
      <button class="filter-btn" data-filter="mobile">Mobile</button>
      <button class="filter-btn" data-filter="identical">Identical</button>
      <button class="filter-btn" data-filter="changed">Changed</button>
      <button class="filter-btn" data-filter="failed">Failed</button>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th data-sort="id">ID</th>
            <th data-sort="name">Page</th>
            <th data-sort="device">Device</th>
            <th data-sort="mismatch">Difference</th>
            <th data-sort="status">Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
  </div>

  <div class="modal-overlay" id="modal">
    <div class="modal">
      <div class="modal-header">
        <button class="modal-nav" onclick="navigateModal(-1)" title="Previous (&#8592;)">&#8592;</button>
        <h2 id="modal-title">&mdash;</h2>
        <button class="modal-nav" onclick="navigateModal(1)" title="Next (&#8594;)">&#8594;</button>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-tabs">
        <button class="modal-tab active" data-view="side">Side by Side</button>
        <button class="modal-tab" data-view="diff">Difference</button>
        <button class="modal-tab" data-view="slider">Slider</button>
        <button class="modal-tab" data-view="prod">Production</button>
        <button class="modal-tab" data-view="staging">Staging</button>
        <div class="modal-links" id="modal-links"></div>
      </div>
      <div class="modal-body" id="modal-body"></div>
    </div>
  </div>`;

// -- Public API ---------------------------------------------------------------

/**
 * Generates the report files.
 *
 * @param {Object[]} results - Comparison results from compareScreenshots()
 * @param {Object} config - Runtime config from buildRuntimeConfig()
 * @param {Function} [onProgress] - Optional callback: onProgress(level, message)
 * @returns {Promise<string>} Path to the generated HTML file
 */
async function generateReport(results, config, onProgress) {
  const log = onProgress || (() => {});
  const reportPath = path.join(config.outputDir, "report.html");
  const cssPath = path.join(config.outputDir, "report.css");
  const jsPath = path.join(config.outputDir, "report.js");
  const dataPath = path.join(config.outputDir, "data.json");

  // Prepare lightweight data (metadata + relative paths only)
  const entries = results.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    device: r.device,
    mismatchPercentage: r.mismatchPercentage,
    success: r.success,
    error: r.error || null,
    prodImg: r.success ? "images/" + path.basename(r.prodFile) : null,
    stagingImg: r.success ? "images/" + path.basename(r.stagingFile) : null,
    diffImg: r.success ? "images/" + path.basename(r.diffFile) : null,
  }));

  // Statistics
  const successful = results.filter((r) => r.success);
  const identical = successful.filter((r) => r.mismatchPercentage === 0).length;
  const minor = successful.filter(
    (r) => r.mismatchPercentage > 0 && r.mismatchPercentage < 1
  ).length;
  const changed = successful.filter((r) => r.mismatchPercentage >= 1).length;
  const failed = results.filter((r) => !r.success).length;

  const dataJson = {
    template: config.template,
    productionUrl: config.productionUrl,
    stagingUrl: config.stagingUrl,
    generated: new Date().toISOString(),
    threshold: config.pixelmatchThreshold,
    totalPages: config.pages.length,
    stats: { total: successful.length, identical, minor, changed, failed },
    entries,
  };

  // Write separate files for server-based usage
  await Promise.all([
    fsp.writeFile(dataPath, JSON.stringify(dataJson), "utf8"),
    fsp.writeFile(cssPath, REPORT_CSS, "utf8"),
    fsp.writeFile(jsPath, REPORT_JS, "utf8"),
  ]);

  // Self-contained HTML with everything inlined
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Visual Regression Report - ${config.template}</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  ${REPORT_HTML_BODY}
  <script>window.__REPORT_DATA__ = ${JSON.stringify(dataJson)};<\/script>
  <script>${REPORT_JS}<\/script>
</body>
</html>`;

  await fsp.writeFile(reportPath, html, "utf8");
  log("success", `Report generated: ${reportPath}`);
  return reportPath;
}

/**
 * Creates a ZIP archive of the output folder for easy sharing.
 *
 * @param {string} outputDir - Path to the output directory
 * @param {Function} [onProgress] - Optional callback: onProgress(level, message)
 * @returns {string|null} Path to the ZIP file, or null if zip failed
 */
function createZip(outputDir, onProgress) {
  const log = onProgress || (() => {});
  const zipName = `${outputDir}.zip`;
  try {
    if (fs.existsSync(zipName)) {
      fs.unlinkSync(zipName);
    }
    execSync(`zip -r "${zipName}" "${outputDir}"`, { stdio: "pipe" });
    log("success", `ZIP created: ${zipName}`);
    return zipName;
  } catch (err) {
    log("warn", `Could not create ZIP (is 'zip' installed?): ${err.message}`);
    return null;
  }
}

module.exports = { generateReport, createZip };
