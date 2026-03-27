/* BrowserCompare GUI Frontend */
(function () {
  "use strict";

  // -- State --
  var currentSite = null;

  // -- Tab navigation --
  document.querySelectorAll(".nav-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".nav-btn").forEach(function (b) { b.classList.remove("active"); });
      document.querySelectorAll(".tab-content").forEach(function (t) { t.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");

      if (btn.dataset.tab === "sites")      loadSitesList();
      if (btn.dataset.tab === "comparison") loadSitesDropdown();
      if (btn.dataset.tab === "audit")      initAuditTab();
    });
  });

  // -- Toast --
  function toast(msg, type) {
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "success");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  }

  // =========================================================================
  // COMPARISON (was Dashboard)
  // =========================================================================

  function loadSitesDropdown() {
    fetch("/api/sites")
      .then(function (r) { return r.json(); })
      .then(function (sites) {
        var sel = document.getElementById("run-site");
        var current = sel.value;
        sel.innerHTML = "";
        sites.forEach(function (s) {
          var opt = document.createElement("option");
          opt.value = s; opt.textContent = s;
          sel.appendChild(opt);
        });
        if (current && sites.indexOf(current) !== -1) sel.value = current;
      });
  }

  document.getElementById("btn-run").addEventListener("click", function () {
    var site      = document.getElementById("run-site").value;
    if (!site) return;

    var btn        = document.getElementById("btn-run");
    var statusEl   = document.getElementById("run-status");
    var logPanel   = document.getElementById("panel-log");
    var logOutput  = document.getElementById("log-output");
    var summaryPanel = document.getElementById("panel-summary");

    btn.disabled = true;
    statusEl.textContent = "Starting...";
    statusEl.className   = "status-badge";
    logPanel.style.display    = "block";
    logOutput.innerHTML       = "";
    summaryPanel.style.display = "none";

    fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: site }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) {
          statusEl.textContent = data.error;
          statusEl.className   = "status-badge error";
          btn.disabled = false;
          return;
        }
        statusEl.textContent = "Running...";
        var es = new EventSource("/api/jobs/" + data.jobId + "/stream");
        es.onmessage = function (ev) {
          var msg = JSON.parse(ev.data);
          if (msg.type === "done") {
            es.close();
            btn.disabled = false;
            if (msg.status === "done") {
              statusEl.textContent = "Completed";
              statusEl.className   = "status-badge success";
              showSummary(msg.summary);
            } else {
              statusEl.textContent = "Error";
              statusEl.className   = "status-badge error";
            }
            return;
          }
          var line = document.createElement("div");
          line.className  = "log-line log-" + (msg.level || "info");
          line.textContent = msg.message;
          logOutput.appendChild(line);
          logOutput.scrollTop = logOutput.scrollHeight;
        };
        es.onerror = function () {
          es.close();
          btn.disabled = false;
          statusEl.textContent = "Connection lost";
          statusEl.className   = "status-badge error";
        };
      })
      .catch(function (err) {
        btn.disabled = false;
        statusEl.textContent = err.message;
        statusEl.className   = "status-badge error";
      });
  });

  function showSummary(s) {
    var panel   = document.getElementById("panel-summary");
    var content = document.getElementById("summary-content");
    panel.style.display = "block";
    content.innerHTML =
      '<div class="summary-card sc-blue"><div class="val">'   + s.comparisons + '</div><div class="lbl">Comparisons</div></div>' +
      '<div class="summary-card sc-green"><div class="val">'  + s.identical   + '</div><div class="lbl">Identical</div></div>' +
      '<div class="summary-card sc-yellow"><div class="val">' + s.minor       + '</div><div class="lbl">Minor</div></div>' +
      '<div class="summary-card sc-red"><div class="val">'    + s.changed     + '</div><div class="lbl">Changed</div></div>' +
      '<div class="summary-card"><div class="val">'           + s.elapsed     + 's</div><div class="lbl">Time</div></div>';
    document.getElementById("link-report").href = "/output/report.html";
  }

  // =========================================================================
  // SITES
  // =========================================================================

  function loadSitesList() {
    fetch("/api/sites")
      .then(function (r) { return r.json(); })
      .then(function (sites) {
        renderSitesList(sites);
      });
  }

  function renderSitesList(sites) {
    var ul = document.getElementById("sites-list");
    ul.innerHTML = "";
    sites.forEach(function (name) {
      var li   = document.createElement("li");
      li.dataset.name = name;
      if (currentSite === name) li.classList.add("active");

      var span = document.createElement("span");
      span.textContent = name;
      span.addEventListener("click", function () { loadSiteEditor(name); });

      var del = document.createElement("button");
      del.className   = "del-btn";
      del.textContent = "\u00d7";
      del.title       = "Delete " + name;
      del.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (confirm("Delete site '" + name + "'?")) {
          fetch("/api/sites/" + name, { method: "DELETE" })
            .then(function () {
              if (currentSite === name) {
                currentSite = null;
                document.getElementById("site-editor").innerHTML =
                  '<div class="empty-state">Select a site or create a new one</div>';
              }
              loadSitesList();
              toast("Site deleted", "success");
            });
        }
      });

      li.appendChild(span);
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  function loadSiteEditor(name) {
    currentSite = name;
    document.querySelectorAll(".site-list li").forEach(function (li) {
      li.classList.toggle("active", li.dataset.name === name);
    });
    fetch("/api/sites/" + name)
      .then(function (r) { return r.json(); })
      .then(function (data) { renderSiteEditor(name, data); })
      .catch(function () { toast("Failed to load site", "error"); });
  }

  function renderSiteEditor(name, data) {
    var container = document.getElementById("site-editor");
    var cfg   = data[0].config;
    var pages = data[0].pages;

    container.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;gap:0.75rem;flex-wrap:wrap">' +
        '<h2>' + escHtml(name) + '</h2>' +
        '<div style="display:flex;gap:0.5rem;flex-shrink:0">' +
          '<button id="btn-save-site-top" class="btn btn-primary btn-sm">Save</button>' +
          '<button id="btn-export-site-top" class="btn btn-outline btn-sm">Export JSON</button>' +
          '<label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0" title="Import JSON over this site">' +
            'Import JSON<input type="file" id="import-file-inline" accept=".json" style="display:none">' +
          '</label>' +
        '</div>' +
      '</div>' +

      '<div class="form-divider">URLs</div>' +
      '<div class="form-grid">' +
        '<div class="form-group"><label>Production URL</label>' +
        '<input type="url" id="se-prod-url" value="' + escAttr(cfg.PRODUCTION_URL || "") + '"></div>' +
        '<div class="form-group"><label>Staging URL</label>' +
        '<input type="url" id="se-stag-url" value="' + escAttr(cfg.STAGING_URL || "") + '"></div>' +
      '</div>' +

      '<div class="form-divider">Cookies</div>' +
      '<div class="form-grid">' +
        '<div class="form-group"><label>Cookie Domain (Production)</label>' +
        '<input type="text" id="se-cookie-prod" value="' + escAttr(cfg.COOKIE_PRODUCTION || "") + '"></div>' +
        '<div class="form-group"><label>Cookie Domain (Staging)</label>' +
        '<input type="text" id="se-cookie-stag" value="' + escAttr(cfg.COOKIE_STAGING || "") + '"></div>' +
        '<div class="form-group"><label>Cookie Name</label>' +
        '<input type="text" id="se-cookie-name" value="' + escAttr(cfg.COOKIE_ONE || "") + '"></div>' +
        '<div class="form-group"><label>Cookie Value</label>' +
        '<input type="text" id="se-cookie-value" value="' + escAttr(cfg.COOKIEVALUE || "") + '"></div>' +
        '<div class="form-group"><label class="toggle-label">' +
        '<input type="checkbox" id="se-cookie-set" ' + (cfg.ISCOOKIESET === "true" ? "checked" : "") + '> Cookies enabled</label></div>' +
      '</div>' +

      '<div class="form-divider">Capture Settings</div>' +
      '<div class="form-grid">' +
        '<div class="form-group"><label>Desktop Width</label>' +
        '<input type="number" id="se-desktop-w" value="' + escAttr(cfg.DESKTOP_WIDTH || 1440) + '"></div>' +
        '<div class="form-group"><label>Desktop Height</label>' +
        '<input type="number" id="se-desktop-h" value="' + escAttr(cfg.DESKTOP_HEIGHT || 1080) + '"></div>' +
        '<div class="form-group"><label>Mobile Width</label>' +
        '<input type="number" id="se-mobile-w" value="' + escAttr(cfg.MOBILE_WIDTH || 360) + '"></div>' +
        '<div class="form-group"><label>Mobile Height</label>' +
        '<input type="number" id="se-mobile-h" value="' + escAttr(cfg.MOBILE_HEIGHT || 640) + '"></div>' +
        '<div class="form-group"><label>Navigation Timeout (ms)</label>' +
        '<input type="number" id="se-timeout" value="' + escAttr(cfg.TIMEOUT || 200000) + '"></div>' +
        '<div class="form-group" style="display:flex;gap:1.5rem;align-items:center;padding-top:1.4rem">' +
          '<label class="toggle-label"><input type="checkbox" id="se-desktop-on"' + (cfg.DESKTOP === false || cfg.DESKTOP === "false" ? "" : " checked") + '> Desktop</label>' +
          '<label class="toggle-label"><input type="checkbox" id="se-mobile-on"' + (cfg.MOBILE === true || cfg.MOBILE === "true" ? " checked" : "") + '> Mobile</label>' +
        '</div>' +
      '</div>' +

      '<div class="form-divider" style="display:flex;align-items:center;justify-content:space-between">' +
        '<span>Pages</span>' +
        '<button id="btn-crawl-site" class="btn btn-sm btn-outline">Crawl Site</button>' +
      '</div>' +
      '<div id="crawl-status" class="text-muted" style="font-size:0.8rem;margin-bottom:0.5rem;display:none"></div>' +
      '<table class="pages-table">' +
        '<thead><tr>' +
          '<th style="width:70px">ID</th>' +
          '<th>URL</th>' +
          '<th style="width:90px;text-align:center"><input type="checkbox" id="hdr-screenshot" title="Select/deselect all"> Screenshot</th>' +
          '<th style="width:70px;text-align:center"><input type="checkbox" id="hdr-audit" title="Select/deselect all"> Audit</th>' +
          '<th style="width:36px"></th>' +
        '</tr></thead>' +
        '<tbody id="se-pages"></tbody>' +
      '</table>' +
      '<div class="form-row" style="gap:0.5rem;align-items:flex-start;flex-wrap:wrap">' +
        '<button id="btn-add-page" class="btn btn-sm">+ Add Page</button>' +
        '<button id="btn-toggle-bulk" class="btn btn-sm btn-outline">Paste URLs</button>' +
      '</div>' +
      '<div id="bulk-url-wrap" style="display:none;margin-top:0.75rem">' +
        '<textarea id="bulk-url-input" rows="6" placeholder="Paste one URL per line:\n/\n/about-us\n/about-us/history" style="width:100%;font-family:monospace;font-size:0.82rem;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:0.5rem;resize:vertical"></textarea>' +
        '<div class="form-row" style="margin-top:0.5rem;gap:0.5rem">' +
          '<button id="btn-import-urls" class="btn btn-sm btn-primary">Import URLs</button>' +
          '<button id="btn-cancel-bulk" class="btn btn-sm btn-outline">Cancel</button>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:1.5rem;display:flex;gap:0.75rem">' +
        '<button id="btn-save-site" class="btn btn-primary">Save</button>' +
        '<button id="btn-export-site" class="btn btn-outline btn-sm">Export JSON</button>' +
      '</div>';

    var tbody = document.getElementById("se-pages");
    pages.forEach(function (p) {
      addPageRow(tbody, p.id, p.url, p.screenshot, p.audit);
    });

    // Header checkboxes — select/deselect all
    document.getElementById("hdr-screenshot").addEventListener("change", function () {
      var checked = this.checked;
      document.querySelectorAll(".page-screenshot").forEach(function (cb) { cb.checked = checked; });
    });
    document.getElementById("hdr-audit").addEventListener("change", function () {
      var checked = this.checked;
      document.querySelectorAll(".page-audit").forEach(function (cb) { cb.checked = checked; });
    });

    // Add page — auto-increment from max existing ID
    document.getElementById("btn-add-page").addEventListener("click", function () {
      var existingIds = Array.from(document.querySelectorAll(".page-id"))
        .map(function (i) { return parseInt(i.value) || 0; });
      var maxId = existingIds.length ? Math.max.apply(null, existingIds) : 0;
      var nextId = String(maxId + 1).padStart(3, "0");
      addPageRow(tbody, nextId, "/", true, true);
    });

    // Bulk URL import
    document.getElementById("btn-toggle-bulk").addEventListener("click", function () {
      var wrap = document.getElementById("bulk-url-wrap");
      wrap.style.display = wrap.style.display === "none" ? "block" : "none";
      if (wrap.style.display === "block") document.getElementById("bulk-url-input").focus();
    });

    document.getElementById("btn-cancel-bulk").addEventListener("click", function () {
      document.getElementById("bulk-url-wrap").style.display = "none";
      document.getElementById("bulk-url-input").value = "";
    });

    document.getElementById("btn-import-urls").addEventListener("click", function () {
      var raw = document.getElementById("bulk-url-input").value;
      var lines = raw.split("\n")
        .map(function (l) { return l.trim(); })
        .filter(function (l) { return l.length > 0; });

      if (lines.length === 0) { toast("No URLs to import", "warn"); return; }

      // Filter out URLs already in the table
      var existing = Array.from(document.querySelectorAll(".page-url"))
        .map(function (i) { return i.value.trim(); });
      var newUrls = lines.filter(function (u) { return existing.indexOf(u) === -1; });

      if (newUrls.length === 0) {
        toast("All URLs are already in the table", "warn");
        return;
      }

      newUrls.forEach(function (url) {
        var existingIds = Array.from(document.querySelectorAll(".page-id"))
          .map(function (i) { return parseInt(i.value) || 0; });
        var maxId = existingIds.length ? Math.max.apply(null, existingIds) : 0;
        var nextId = String(maxId + 1).padStart(3, "0");
        addPageRow(tbody, nextId, url, true, true);
      });

      document.getElementById("bulk-url-wrap").style.display = "none";
      document.getElementById("bulk-url-input").value = "";
      toast(newUrls.length + " URL(s) added", "success");
    });

    function doSave()   { saveSite(name); }
    function doExport() {
      var blob = new Blob([JSON.stringify(collectSiteData(), null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
    }

    // Top buttons
    document.getElementById("btn-save-site-top").addEventListener("click", doSave);
    document.getElementById("btn-export-site-top").addEventListener("click", doExport);
    document.getElementById("import-file-inline").addEventListener("change", function (ev) {
      var file = ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var imported = JSON.parse(e.target.result);
          if (!Array.isArray(imported) || !imported[0] || !imported[0].config) {
            toast("Invalid site JSON format", "error");
            return;
          }
          if (!confirm("This will replace all current data for '" + name + "'. Continue?")) return;
          fetch("/api/sites/" + name, {
            method:  "PUT",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(imported),
          })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              if (res.error) { toast(res.error, "error"); return; }
              toast("JSON imported and saved", "success");
              loadSiteEditor(name);
            });
        } catch (err) {
          toast("Invalid JSON file", "error");
        }
      };
      reader.readAsText(file);
      ev.target.value = "";
    });

    // Bottom buttons
    document.getElementById("btn-save-site").addEventListener("click", doSave);
    document.getElementById("btn-export-site").addEventListener("click", doExport);

    // Crawl site to discover pages
    document.getElementById("btn-crawl-site").addEventListener("click", function () {
      var prodUrl = document.getElementById("se-prod-url").value.trim();
      if (!prodUrl) { toast("Enter a Production URL first", "warn"); return; }

      var btn        = document.getElementById("btn-crawl-site");
      var statusDiv  = document.getElementById("crawl-status");
      btn.disabled   = true;
      btn.textContent = "Crawling...";
      statusDiv.style.display = "block";
      statusDiv.textContent   = "Launching browser and scanning " + prodUrl + " ...";

      fetch("/api/crawler", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ url: prodUrl }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          btn.disabled    = false;
          btn.textContent = "Crawl Site";

          if (data.error) {
            statusDiv.textContent = "Crawl failed: " + data.error;
            return;
          }

          var existingUrls = Array.from(document.querySelectorAll(".page-url"))
            .map(function (i) { return i.value.trim(); });
          var newPaths = data.pages.filter(function (p) {
            return existingUrls.indexOf(p) === -1;
          });

          if (newPaths.length === 0) {
            statusDiv.textContent = "No new pages found (" + data.pages.length + " discovered, all already listed).";
            return;
          }

          statusDiv.textContent = "Found " + data.pages.length + " pages, " +
            newPaths.length + " new. Adding...";

          newPaths.forEach(function (p) {
            var existingIds = Array.from(document.querySelectorAll(".page-id"))
              .map(function (i) { return parseInt(i.value) || 0; });
            var maxId = existingIds.length ? Math.max.apply(null, existingIds) : 0;
            var id = String(maxId + 1).padStart(3, "0");
            addPageRow(tbody, id, p, true, true, dragSrc);
          });

          statusDiv.textContent = "Added " + newPaths.length + " new page(s). Save to keep them.";
          toast(newPaths.length + " pages discovered and added", "success");
        })
        .catch(function (err) {
          btn.disabled    = false;
          btn.textContent = "Crawl Site";
          statusDiv.textContent = "Error: " + err.message;
        });
    });
  }

  function addPageRow(tbody, id, url, screenshot, audit) {
    var scChecked  = screenshot !== false;
    var audChecked = audit      !== false;
    var tr = document.createElement("tr");
    tr.draggable = true;
    tr.innerHTML =
      '<td><input type="text" class="page-id" value="'  + escAttr(id)  + '"></td>' +
      '<td><input type="text" class="page-url" value="' + escAttr(url) + '" placeholder="/path/"></td>' +
      '<td style="text-align:center"><input type="checkbox" class="page-screenshot"' + (scChecked  ? " checked" : "") + '></td>' +
      '<td style="text-align:center"><input type="checkbox" class="page-audit"'      + (audChecked ? " checked" : "") + '></td>' +
      '<td><button class="row-del" title="Remove">\u00d7</button></td>';

    tr.querySelector(".row-del").addEventListener("click", function () { tr.remove(); });

    // Drag & drop reorder
    tr.addEventListener("dragstart", function (e) {
      e.dataTransfer.effectAllowed = "move";
      // Store reference via dataset since closures share the same dragSrcRef object
      tr.classList.add("dragging");
      tbody._dragSrc = tr;
    });
    tr.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    tr.addEventListener("drop", function (e) {
      e.preventDefault();
      var src = tbody._dragSrc;
      if (src && src !== tr) {
        var rows = Array.from(tbody.querySelectorAll("tr"));
        var srcIdx = rows.indexOf(src);
        var tgtIdx = rows.indexOf(tr);
        if (srcIdx < tgtIdx) tbody.insertBefore(src, tr.nextSibling);
        else tbody.insertBefore(src, tr);
      }
    });
    tr.addEventListener("dragend", function () {
      tr.classList.remove("dragging");
      tbody._dragSrc = null;
    });

    tbody.appendChild(tr);
  }

  function collectSiteData() {
    var rows  = document.querySelectorAll("#se-pages tr");
    var pages = [];
    rows.forEach(function (row) {
      var id  = row.querySelector(".page-id").value.trim();
      var url = row.querySelector(".page-url").value.trim();
      if (id && url) {
        pages.push({
          id:         id,
          url:        url,
          screenshot: row.querySelector(".page-screenshot").checked,
          audit:      row.querySelector(".page-audit").checked,
        });
      }
    });
    return [{
      config: {
        PRODUCTION_URL:    document.getElementById("se-prod-url").value.trim(),
        STAGING_URL:       document.getElementById("se-stag-url").value.trim(),
        COOKIE_PRODUCTION: document.getElementById("se-cookie-prod").value.trim(),
        COOKIE_STAGING:    document.getElementById("se-cookie-stag").value.trim(),
        COOKIE_ONE:        document.getElementById("se-cookie-name").value.trim(),
        ISCOOKIESET:       document.getElementById("se-cookie-set").checked ? "true" : "false",
        COOKIEVALUE:       document.getElementById("se-cookie-value").value.trim(),
        TIMEOUT:           parseInt(document.getElementById("se-timeout").value)   || 200000,
        DESKTOP_WIDTH:     parseInt(document.getElementById("se-desktop-w").value) || 1440,
        DESKTOP_HEIGHT:    parseInt(document.getElementById("se-desktop-h").value) || 1080,
        MOBILE_WIDTH:      parseInt(document.getElementById("se-mobile-w").value)  || 360,
        MOBILE_HEIGHT:     parseInt(document.getElementById("se-mobile-h").value)  || 640,
        DESKTOP:           document.getElementById("se-desktop-on").checked,
        MOBILE:            document.getElementById("se-mobile-on").checked,
      },
      pages: pages,
    }];
  }

  function saveSite(name) {
    var data = collectSiteData();
    fetch("/api/sites/" + name, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(data),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.error) toast(res.error, "error");
        else           toast("Site saved", "success");
      })
      .catch(function () { toast("Failed to save", "error"); });
  }

  // New site
  document.getElementById("btn-new-site").addEventListener("click", function () {
    var name = prompt("Site name (e.g. MY_CLIENT):");
    if (!name) return;
    name = name.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (!name) return;

    var template = [{
      config: {
        PRODUCTION_URL:    "https://example.com",
        STAGING_URL:       "https://staging.example.com",
        COOKIE_PRODUCTION: "example.com",
        COOKIE_STAGING:    "staging.example.com",
        COOKIE_ONE:        "",
        ISCOOKIESET:       "false",
        COOKIEVALUE:       "displayed",
        TIMEOUT:           200000,
        DESKTOP_WIDTH:     1440,
        DESKTOP_HEIGHT:    1080,
        MOBILE_WIDTH:      360,
        MOBILE_HEIGHT:     640,
        DESKTOP:           true,
        MOBILE:            false,
      },
      pages: [{ id: "001", url: "/", screenshot: true, audit: true }],
    }];

    fetch("/api/sites", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name: name, data: template }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.error) return toast(res.error, "error");
        loadSitesList();
        loadSiteEditor(name);
        toast("Site created", "success");
      });
  });

  // Import JSON
  document.getElementById("btn-import-site").addEventListener("click", function () {
    document.getElementById("import-file").click();
  });

  document.getElementById("import-file").addEventListener("change", function (ev) {
    var file = ev.target.files[0];
    if (!file) return;
    var name = file.name.replace(".json", "").replace(/[^a-zA-Z0-9_-]/g, "");
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        fetch("/api/sites", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ name: name, data: data }),
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.error) return toast(res.error, "error");
            loadSitesList();
            loadSiteEditor(name);
            toast("Site imported", "success");
          });
      } catch (err) {
        toast("Invalid JSON file", "error");
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  });

  // =========================================================================
  // AUDIT TAB
  // =========================================================================

  var auditPagesData = [];

  function initAuditTab() {
    fetch("/api/sites")
      .then(function (r) { return r.json(); })
      .then(function (sites) {
        var sel     = document.getElementById("audit-site");
        var current = sel.value;
        sel.innerHTML = "";
        sites.forEach(function (s) {
          var opt = document.createElement("option");
          opt.value = s; opt.textContent = s;
          sel.appendChild(opt);
        });
        if (current && sites.indexOf(current) !== -1) sel.value = current;
      });
    loadAuditReports();
    loadDeepDiveReports();
  }

  document.getElementById("btn-load-audit-pages").addEventListener("click", function () {
    var site = document.getElementById("audit-site").value;
    if (!site) return;
    fetch("/api/sites/" + site)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        auditPagesData = data[0].pages;
        renderAuditPageList(auditPagesData);
        document.getElementById("audit-pages-wrap").style.display = "block";
        document.getElementById("btn-run-audit").disabled = false;
      })
      .catch(function () { toast("Failed to load site pages", "error"); });
  });

  function renderAuditPageList(pages) {
    var list = document.getElementById("audit-pages-list");
    list.innerHTML = "";
    pages.forEach(function (p) {
      var checked = p.audit !== false;
      var row = document.createElement("label");
      row.className = "audit-page-row";
      row.innerHTML =
        '<input type="checkbox" class="audit-page-cb" data-id="' + escAttr(p.id) + '"' +
        (checked ? " checked" : "") + '>' +
        '<span class="audit-page-id">' + escHtml(p.id) + '</span>' +
        '<span class="audit-page-url">' + escHtml(p.url) + '</span>';
      list.appendChild(row);
    });
  }

  document.getElementById("btn-audit-all").addEventListener("click", function () {
    document.querySelectorAll(".audit-page-cb").forEach(function (cb) { cb.checked = true; });
  });

  document.getElementById("btn-audit-none").addEventListener("click", function () {
    document.querySelectorAll(".audit-page-cb").forEach(function (cb) { cb.checked = false; });
  });

  document.getElementById("btn-run-audit").addEventListener("click", function () {
    var site = document.getElementById("audit-site").value;
    if (!site) return;

    var checkedIds = Array.from(document.querySelectorAll(".audit-page-cb:checked"))
      .map(function (cb) { return cb.dataset.id; });

    if (checkedIds.length === 0) {
      toast("Select at least one page to audit", "warn");
      return;
    }

    var maxPages  = parseInt(document.getElementById("audit-max-pages").value) || 30;
    var btn       = document.getElementById("btn-run-audit");
    var statusEl  = document.getElementById("audit-status");
    var logPanel  = document.getElementById("audit-panel-log");
    var logOutput = document.getElementById("audit-log-output");
    var donePanel = document.getElementById("audit-panel-done");
    var emptyEl   = document.getElementById("audit-empty");

    btn.disabled         = true;
    statusEl.textContent = "Starting...";
    statusEl.className   = "status-badge";
    logPanel.style.display  = "block";
    logOutput.innerHTML     = "";
    donePanel.style.display = "none";
    emptyEl.style.display   = "none";

    fetch("/api/audit", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ site: site, pageIds: checkedIds, maxPages: maxPages }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) {
          statusEl.textContent = data.error;
          statusEl.className   = "status-badge error";
          btn.disabled = false;
          return;
        }

        statusEl.textContent = "Running...";

        var es = new EventSource("/api/audit/" + data.jobId + "/stream");
        es.onmessage = function (ev) {
          var msg = JSON.parse(ev.data);
          if (msg.type === "done") {
            es.close();
            btn.disabled = false;
            if (msg.status === "done") {
              statusEl.textContent = "Done";
              statusEl.className   = "status-badge success";
              showAuditDone(msg.summary);
              loadAuditReports();
            } else {
              statusEl.textContent = "Error";
              statusEl.className   = "status-badge error";
            }
            return;
          }
          appendAuditLog(logOutput, msg);
        };

        es.onerror = function () {
          es.close();
          btn.disabled = false;
          statusEl.textContent = "Connection lost";
          statusEl.className   = "status-badge error";
        };
      })
      .catch(function (err) {
        btn.disabled = false;
        statusEl.textContent = err.message;
        statusEl.className   = "status-badge error";
      });
  });

  function appendAuditLog(container, msg) {
    var line = document.createElement("div");
    line.className   = "log-line log-" + (msg.level || "info");
    line.textContent = msg.message;
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
  }

  function showAuditDone(s) {
    var donePanel = document.getElementById("audit-panel-done");
    var summary   = document.getElementById("audit-summary");
    donePanel.style.display = "block";

    summary.innerHTML =
      '<div class="summary-card sc-blue"><div class="val">'  + s.pagesAudited + '</div><div class="lbl">Audited</div></div>' +
      '<div class="summary-card sc-red"><div class="val">'   + s.pagesFailed  + '</div><div class="lbl">Failed</div></div>' +
      '<div class="summary-card"><div class="val">'          + s.elapsed      + 's</div><div class="lbl">Time</div></div>';

    var link = document.getElementById("audit-link-report");
    link.href = "/audit/" + s.reportFile;
  }

  function renderReportList(listEl, files, basePath) {
    if (!files.length) {
      listEl.innerHTML = '<p class="text-muted" style="font-size:0.85rem">No reports yet.</p>';
      return;
    }
    listEl.innerHTML = "";
    files.forEach(function (f) {
      var item = document.createElement("div");
      item.className = "audit-report-item";
      var dt = new Date(f.mtime);
      var dateStr = dt.toLocaleDateString() + " " + dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      item.innerHTML =
        '<div class="audit-report-name">' + escHtml(f.file) + '</div>' +
        '<div class="audit-report-meta">' + dateStr + ' &nbsp; ' + (f.size / 1024).toFixed(0) + ' KB</div>' +
        '<a href="/' + basePath + '/' + encodeURIComponent(f.file) + '" target="_blank" class="btn btn-sm btn-outline" style="margin-top:4px">Open</a>';
      listEl.appendChild(item);
    });
  }

  function loadAuditReports() {
    fetch("/api/audit/reports")
      .then(function (r) { return r.json(); })
      .then(function (files) {
        renderReportList(document.getElementById("audit-reports-list"), files, "audit");
      });
  }

  function loadDeepDiveReports() {
    fetch("/api/deepdive/reports")
      .then(function (r) { return r.json(); })
      .then(function (files) {
        renderReportList(document.getElementById("dd-reports-list"), files, "audit/deepdive");
      });
  }

  document.getElementById("btn-refresh-reports").addEventListener("click", function () {
    loadAuditReports();
    loadDeepDiveReports();
  });

  document.getElementById("btn-refresh-dd-reports").addEventListener("click", loadDeepDiveReports);

  // =========================================================================
  // HELPERS
  // =========================================================================

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // =========================================================================
  // INIT
  // =========================================================================

  loadSitesList();
})();
