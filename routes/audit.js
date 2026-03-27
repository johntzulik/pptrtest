/**
 * routes/audit.js - Audit job API
 *
 * POST /api/audit          — start audit job
 * GET  /api/audit/:id/stream — SSE progress stream
 * GET  /api/audit/:id/status — poll status
 * GET  /api/audit/reports  — list generated reports
 */

const express  = require("express");
const fs       = require("fs");
const path     = require("path");
const puppeteer = require("puppeteer");

const { readSite } = require("../core/config");
const { auditPage, generateReport } = require("../core/audit");

const router     = express.Router();
const OUTPUT_DIR = path.join(__dirname, "..", "audit");

// In-memory audit job store
const auditJobs = new Map();
let auditCounter = 0;

function createJobLogger(job) {
  return function (level, message) {
    const timestamp = new Date().toLocaleTimeString();
    const icons = { info: "[i]", success: "[+]", error: "[!]", warn: "[~]" };
    const formatted = `${timestamp} ${icons[level] || "   "} ${message}`;
    job.logs.push({ level, message: formatted, ts: Date.now() });
    for (const res of job.listeners) {
      res.write(`data: ${JSON.stringify({ level, message: formatted })}\n\n`);
    }
  };
}

function closeListeners(job) {
  for (const res of job.listeners) {
    res.write(`data: ${JSON.stringify({ type: "done", status: job.status, summary: job.summary })}\n\n`);
    res.end();
  }
  job.listeners = [];
}

// GET /api/audit/reports — list generated audit reports (must be before /:id routes)
router.get("/reports", (req, res) => {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) return res.json([]);
    const files = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.endsWith("-audit-report.html"))
      .map(f => {
        const stat = fs.statSync(path.join(OUTPUT_DIR, f));
        return { file: f, size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audit — start an audit job
// body: { site: "DRMCO", pageIds: ["001","002"] | null, maxPages: 30 }
router.post("/", async (req, res) => {
  const { site, pageIds, maxPages } = req.body;
  if (!site) return res.status(400).json({ error: "Missing site" });

  let siteData;
  try {
    siteData = readSite(site);
  } catch (err) {
    return res.status(404).json({ error: "Site not found" });
  }

  const jobId = String(++auditCounter);
  const job = {
    id:         jobId,
    site,
    status:     "running",
    logs:       [],
    listeners:  [],
    startTime:  Date.now(),
    reportFile: null,
    summary:    null,
    error:      null,
  };
  auditJobs.set(jobId, job);
  res.json({ jobId });

  const log = createJobLogger(job);
  runAuditJob(job, siteData, site, pageIds || null, maxPages || 30, log).catch(err => {
    log("error", `Fatal: ${err.message}`);
    job.status = "error";
    job.error  = err.message;
    closeListeners(job);
  });
});

async function runAuditJob(job, siteData, templateName, pageIds, maxPages, log) {
  const cfg      = siteData[0];
  const allPages = cfg.pages;

  // Use explicit list, or pages where audit !== false
  let pagesToAudit = pageIds
    ? allPages.filter(p => pageIds.includes(p.id))
    : allPages.filter(p => p.audit !== false);

  pagesToAudit = pagesToAudit.slice(0, maxPages);

  const productionUrl = cfg.config.PRODUCTION_URL.replace(/\/$/, "");
  const timeout = parseInt(process.env.TIMEOUT || "60000");

  log("info", `Starting audit for: ${templateName}`);
  log("info", `Site: ${productionUrl}`);
  log("info", `Pages to audit: ${pagesToAudit.length} of ${allPages.length}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const allPageResults = [];
  try {
    for (const pageConfig of pagesToAudit) {
      const fullUrl = productionUrl + pageConfig.url;
      log("info", `Auditing [${pageConfig.id}] ${pageConfig.url} ...`);
      try {
        const result = await auditPage(browser, fullUrl, pageConfig, timeout);
        allPageResults.push(result);
        log("success",
          `[${pageConfig.id}] FCP:${result.perfTiming.fcp}ms  ` +
          `LCP:${result.perfTiming.lcp}ms  CLS:${result.cls.toFixed(3)}  ` +
          `Load:${result.perfTiming.pageLoad}ms`
        );
      } catch (err) {
        log("error", `[${pageConfig.id}] Failed: ${err.message}`);
        allPageResults.push({ pageConfig, fullUrl, error: err.message });
      }
    }
  } finally {
    await browser.close();
  }

  log("info", "Generating report...");
  const reportPath = generateReport(
    allPageResults, cfg, templateName, OUTPUT_DIR, allPages.length
  );
  const reportFile = path.basename(reportPath);

  job.reportFile = reportFile;
  job.summary = {
    site:         templateName,
    pagesAudited: allPageResults.length,
    pagesFailed:  allPageResults.filter(r => r.error).length,
    reportFile,
    elapsed:      ((Date.now() - job.startTime) / 1000).toFixed(1),
  };
  job.status = "done";

  log("success", `Audit complete in ${job.summary.elapsed}s — ${reportFile}`);
  closeListeners(job);
}

// GET /api/audit/:id/stream — SSE progress
router.get("/:id/stream", (req, res) => {
  const job = auditJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });

  res.writeHead(200, {
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
  });

  // Replay existing logs
  for (const entry of job.logs) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  if (job.status === "done" || job.status === "error") {
    res.write(`data: ${JSON.stringify({ type: "done", status: job.status, summary: job.summary })}\n\n`);
    res.end();
    return;
  }

  job.listeners.push(res);
  req.on("close", () => {
    const idx = job.listeners.indexOf(res);
    if (idx !== -1) job.listeners.splice(idx, 1);
  });
});

// GET /api/audit/:id/status — poll status
router.get("/:id/status", (req, res) => {
  const job = auditJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ id: job.id, site: job.site, status: job.status, summary: job.summary, error: job.error });
});

module.exports = router;
