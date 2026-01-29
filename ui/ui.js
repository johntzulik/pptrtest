/* BrowserCompare GUI Frontend */
(function () {
  "use strict";

  // -- State --
  var currentSite = null;
  var sitesList = [];

  // -- Tab navigation --
  document.querySelectorAll(".nav-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".nav-btn").forEach(function (b) { b.classList.remove("active"); });
      document.querySelectorAll(".tab-content").forEach(function (t) { t.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");

      // Refresh data when switching tabs
      if (btn.dataset.tab === "sites") loadSitesList();
      if (btn.dataset.tab === "settings") loadSettings();
      if (btn.dataset.tab === "dashboard") loadSitesDropdown();
    });
  });

  // -- Toast --
  function toast(msg, type) {
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "success");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  // =========================================================================
  // DASHBOARD
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
          opt.value = s;
          opt.textContent = s;
          sel.appendChild(opt);
        });
        // Try to restore previous selection or use current template
        if (current && sites.indexOf(current) !== -1) {
          sel.value = current;
        }
      });
  }

  document.getElementById("btn-run").addEventListener("click", function () {
    var site = document.getElementById("run-site").value;
    if (!site) return;

    var btn = document.getElementById("btn-run");
    var statusEl = document.getElementById("run-status");
    var logPanel = document.getElementById("panel-log");
    var logOutput = document.getElementById("log-output");
    var summaryPanel = document.getElementById("panel-summary");

    btn.disabled = true;
    statusEl.textContent = "Starting...";
    statusEl.className = "status-badge";
    logPanel.style.display = "block";
    logOutput.innerHTML = "";
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
          statusEl.className = "status-badge error";
          btn.disabled = false;
          return;
        }

        statusEl.textContent = "Running...";

        // Connect to SSE stream
        var es = new EventSource("/api/jobs/" + data.jobId + "/stream");
        es.onmessage = function (ev) {
          var msg = JSON.parse(ev.data);

          if (msg.type === "done") {
            es.close();
            btn.disabled = false;
            if (msg.status === "done") {
              statusEl.textContent = "Completed";
              statusEl.className = "status-badge success";
              showSummary(msg.summary);
            } else {
              statusEl.textContent = "Error";
              statusEl.className = "status-badge error";
            }
            return;
          }

          var line = document.createElement("div");
          line.className = "log-line log-" + (msg.level || "info");
          line.textContent = msg.message;
          logOutput.appendChild(line);
          logOutput.scrollTop = logOutput.scrollHeight;
        };

        es.onerror = function () {
          es.close();
          btn.disabled = false;
          statusEl.textContent = "Connection lost";
          statusEl.className = "status-badge error";
        };
      })
      .catch(function (err) {
        btn.disabled = false;
        statusEl.textContent = err.message;
        statusEl.className = "status-badge error";
      });
  });

  function showSummary(s) {
    var panel = document.getElementById("panel-summary");
    var content = document.getElementById("summary-content");
    panel.style.display = "block";

    content.innerHTML =
      '<div class="summary-card sc-blue"><div class="val">' + s.comparisons + '</div><div class="lbl">Comparisons</div></div>' +
      '<div class="summary-card sc-green"><div class="val">' + s.identical + '</div><div class="lbl">Identical</div></div>' +
      '<div class="summary-card sc-yellow"><div class="val">' + s.minor + '</div><div class="lbl">Minor</div></div>' +
      '<div class="summary-card sc-red"><div class="val">' + s.changed + '</div><div class="lbl">Changed</div></div>' +
      '<div class="summary-card"><div class="val">' + s.elapsed + 's</div><div class="lbl">Time</div></div>';

    var link = document.getElementById("link-report");
    link.href = "/output/report.html";
  }

  // =========================================================================
  // SITES
  // =========================================================================

  function loadSitesList() {
    fetch("/api/sites")
      .then(function (r) { return r.json(); })
      .then(function (sites) {
        sitesList = sites;
        renderSitesList(sites);
      });
  }

  function renderSitesList(sites) {
    var ul = document.getElementById("sites-list");
    ul.innerHTML = "";
    sites.forEach(function (name) {
      var li = document.createElement("li");
      li.dataset.name = name;
      if (currentSite === name) li.classList.add("active");

      var span = document.createElement("span");
      span.textContent = name;
      span.addEventListener("click", function () { loadSiteEditor(name); });

      var del = document.createElement("button");
      del.className = "del-btn";
      del.textContent = "\u00d7";
      del.title = "Delete " + name;
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
    // Highlight in list
    document.querySelectorAll(".site-list li").forEach(function (li) {
      li.classList.toggle("active", li.dataset.name === name);
    });

    fetch("/api/sites/" + name)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        renderSiteEditor(name, data);
      })
      .catch(function () {
        toast("Failed to load site", "error");
      });
  }

  function renderSiteEditor(name, data) {
    var container = document.getElementById("site-editor");
    var cfg = data[0].config;
    var pages = data[0].pages;

    container.innerHTML =
      '<h2 style="margin-bottom:1rem">' + escHtml(name) + '</h2>' +
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
      '<div class="form-divider">Pages</div>' +
      '<table class="pages-table"><thead><tr><th style="width:80px">ID</th><th>URL</th><th style="width:40px"></th></tr></thead>' +
      '<tbody id="se-pages"></tbody></table>' +
      '<div class="form-row"><button id="btn-add-page" class="btn btn-sm">+ Add Page</button></div>' +
      '<div style="margin-top:1.5rem;display:flex;gap:0.75rem">' +
        '<button id="btn-save-site" class="btn btn-primary">Save</button>' +
        '<button id="btn-export-site" class="btn btn-outline btn-sm">Export JSON</button>' +
      '</div>';

    // Render pages
    var tbody = document.getElementById("se-pages");
    pages.forEach(function (p, i) {
      addPageRow(tbody, p.id, p.url);
    });

    // Add page
    document.getElementById("btn-add-page").addEventListener("click", function () {
      var nextId = String(pages.length + 1).padStart(2, "0");
      addPageRow(tbody, nextId, "/");
    });

    // Save
    document.getElementById("btn-save-site").addEventListener("click", function () {
      saveSite(name);
    });

    // Export
    document.getElementById("btn-export-site").addEventListener("click", function () {
      var siteData = collectSiteData();
      var blob = new Blob([JSON.stringify(siteData, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function addPageRow(tbody, id, url) {
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input type="text" class="page-id" value="' + escAttr(id) + '"></td>' +
      '<td><input type="text" class="page-url" value="' + escAttr(url) + '" placeholder="/path/"></td>' +
      '<td><button class="row-del" title="Remove">\u00d7</button></td>';
    tr.querySelector(".row-del").addEventListener("click", function () {
      tr.remove();
    });
    tbody.appendChild(tr);
  }

  function collectSiteData() {
    var rows = document.querySelectorAll("#se-pages tr");
    var pages = [];
    rows.forEach(function (row) {
      var id = row.querySelector(".page-id").value.trim();
      var url = row.querySelector(".page-url").value.trim();
      if (id && url) pages.push({ id: id, url: url });
    });

    return [
      {
        config: {
          PRODUCTION_URL: document.getElementById("se-prod-url").value.trim(),
          STAGING_URL: document.getElementById("se-stag-url").value.trim(),
          COOKIE_PRODUCTION: document.getElementById("se-cookie-prod").value.trim(),
          COOKIE_STAGING: document.getElementById("se-cookie-stag").value.trim(),
          COOKIE_ONE: document.getElementById("se-cookie-name").value.trim(),
          ISCOOKIESET: document.getElementById("se-cookie-set").checked ? "true" : "false",
          COOKIEVALUE: document.getElementById("se-cookie-value").value.trim(),
        },
        pages: pages,
      },
    ];
  }

  function saveSite(name) {
    var data = collectSiteData();
    fetch("/api/sites/" + name, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.error) {
          toast(res.error, "error");
        } else {
          toast("Site saved", "success");
        }
      })
      .catch(function () {
        toast("Failed to save", "error");
      });
  }

  // New site
  document.getElementById("btn-new-site").addEventListener("click", function () {
    var name = prompt("Site name (e.g. MY_CLIENT):");
    if (!name) return;
    name = name.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (!name) return;

    var template = [
      {
        config: {
          PRODUCTION_URL: "https://example.com",
          STAGING_URL: "https://staging.example.com",
          COOKIE_PRODUCTION: "example.com",
          COOKIE_STAGING: "staging.example.com",
          COOKIE_ONE: "",
          ISCOOKIESET: "false",
          COOKIEVALUE: "displayed",
        },
        pages: [{ id: "01", url: "/" }],
      },
    ];

    fetch("/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, data: template }),
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
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name, data: data }),
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
  // SETTINGS
  // =========================================================================

  function loadSettings() {
    Promise.all([
      fetch("/api/config").then(function (r) { return r.json(); }),
      fetch("/api/sites").then(function (r) { return r.json(); }),
    ]).then(function (results) {
      var config = results[0];
      var sites = results[1];

      // Populate template dropdown
      var sel = document.getElementById("set-template");
      sel.innerHTML = "";
      sites.forEach(function (s) {
        var opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        if (s === config.TEMPLATE) opt.selected = true;
        sel.appendChild(opt);
      });

      // Fill form fields
      var form = document.getElementById("settings-form");
      setFormValue(form, "DESKTOP_WIDTH", config.DESKTOP_WIDTH || "1440");
      setFormValue(form, "DESKTOP_HEIGHT", config.DESKTOP_HEIGHT || "1080");
      setFormValue(form, "MOBILE_WIDTH", config.MOBILE_WIDTH || "360");
      setFormValue(form, "MOBILE_HEIGHT", config.MOBILE_HEIGHT || "640");
      setFormValue(form, "TIMEOUT", config.TIMEOUT || "100000");

      var deskCb = form.querySelector('[name="DESKTOP"]');
      var mobCb = form.querySelector('[name="MOBILE"]');
      deskCb.checked = config.DESKTOP !== "false";
      mobCb.checked = config.MOBILE !== "false";
    });
  }

  function setFormValue(form, name, val) {
    var input = form.querySelector('[name="' + name + '"]');
    if (input) input.value = val;
  }

  document.getElementById("settings-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var form = ev.target;
    var data = {
      TEMPLATE: document.getElementById("set-template").value,
      DESKTOP_WIDTH: form.querySelector('[name="DESKTOP_WIDTH"]').value,
      DESKTOP_HEIGHT: form.querySelector('[name="DESKTOP_HEIGHT"]').value,
      MOBILE_WIDTH: form.querySelector('[name="MOBILE_WIDTH"]').value,
      MOBILE_HEIGHT: form.querySelector('[name="MOBILE_HEIGHT"]').value,
      TIMEOUT: form.querySelector('[name="TIMEOUT"]').value,
      DESKTOP: form.querySelector('[name="DESKTOP"]').checked ? "true" : "false",
      MOBILE: form.querySelector('[name="MOBILE"]').checked ? "true" : "false",
    };

    fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.error) return toast(res.error, "error");
        toast("Settings saved", "success");
      });
  });

  // =========================================================================
  // HELPERS
  // =========================================================================

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // =========================================================================
  // INIT
  // =========================================================================

  loadSitesDropdown();
})();
