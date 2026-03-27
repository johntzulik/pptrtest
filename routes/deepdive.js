/**
 * routes/deepdive.js - Deep-dive job API
 *
 * POST /api/deepdive            — start a deep-dive job { url }
 * GET  /api/deepdive/:id/stream — SSE progress
 * GET  /api/deepdive/:id/status — poll status
 * GET  /api/deepdive/reports    — list deep-dive reports
 */

const express   = require("express");
const fs        = require("fs");
const path      = require("path");
const puppeteer = require("puppeteer");

const { deepDivePage, generateDeepDiveReport } = require("../core/deepdive");

const router     = express.Router();
const OUTPUT_DIR = path.join(__dirname, "..", "audit", "deepdive");

const ddJobs = new Map();
let ddCounter = 0;

function createLogger(job) {
  return function (level, message) {
    const ts  = new Date().toLocaleTimeString();
    const ico = { info: "[i]", success: "[+]", error: "[!]", warn: "[~]" };
    const fmt = `${ts} ${ico[level] || "   "} ${message}`;
    job.logs.push({ level, message: fmt, ts: Date.now() });
    for (const res of job.listeners) {
      res.write(`data: ${JSON.stringify({ level, message: fmt })}\n\n`);
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

// GET /api/deepdive/reports — list reports (before /:id routes)
router.get("/reports", (req, res) => {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) return res.json([]);
    const files = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.startsWith("deepdive-") && f.endsWith(".html"))
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

// POST /api/deepdive — start a deep-dive job
// body: { url: "https://..." }
router.post("/", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing url" });

  const jobId = String(++ddCounter);
  const job = {
    id:         jobId,
    url,
    status:     "running",
    logs:       [],
    listeners:  [],
    startTime:  Date.now(),
    reportFile: null,
    summary:    null,
    error:      null,
  };
  ddJobs.set(jobId, job);
  res.json({ jobId });

  const log = createLogger(job);
  runDeepDive(job, url, log).catch(err => {
    log("error", `Fatal: ${err.message}`);
    job.status = "error";
    job.error  = err.message;
    closeListeners(job);
  });
});

async function runDeepDive(job, url, log) {
  const timeout = parseInt(process.env.TIMEOUT || "60000");

  log("info",  `Starting deep dive: ${url}`);
  log("info",  "Launching browser...");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let result;
  try {
    log("info", "Navigating and collecting metrics (this may take ~30s)...");
    result = await deepDivePage(browser, url, timeout);
    log("success", `Page loaded — HTTP ${result.httpStatus} — ${result.resources.length} resources`);
    log("info",  `Performance: FCP ${result.perf.fcp}ms · LCP ${result.perf.lcp}ms · CLS ${result.cls.toFixed(3)}`);
    log("info",  `Coverage: JS ${result.coverage.unusedJsPct}% unused · CSS ${result.coverage.unusedCssPct}% unused`);
    log("info",  `Accessibility: ${result.a11y.imgsNoAlt} imgs missing alt · ${result.a11y.emptyButtons.length} empty buttons`);
    log("info",  `SEO: ${result.seo.h1Count} H1(s) · canonical ${result.seo.canonical ? "present" : "missing"}`);
  } finally {
    await browser.close();
  }

  log("info", "Generating deep dive report...");
  const { file: reportFile } = generateDeepDiveReport(result, OUTPUT_DIR);

  job.reportFile = reportFile;
  job.summary = {
    url,
    reportFile,
    reportPath: `deepdive/${reportFile}`,
    elapsed: ((Date.now() - job.startTime) / 1000).toFixed(1),
    recsHigh:   0, // computed in report
    httpStatus: result.httpStatus,
  };
  job.status = "done";

  log("success", `Deep dive complete in ${job.summary.elapsed}s — ${reportFile}`);
  closeListeners(job);
}

// GET /api/deepdive/:id/stream — SSE
router.get("/:id/stream", (req, res) => {
  const job = ddJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });

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

// GET /api/deepdive/:id/status
router.get("/:id/status", (req, res) => {
  const job = ddJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ id: job.id, url: job.url, status: job.status, summary: job.summary, error: job.error });
});

module.exports = router;
