/**
 * routes/jobs.js - Comparison job execution API
 *
 * Manages background comparison runs with SSE progress streaming.
 */

const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { chromium } = require("playwright");

const { buildRuntimeConfig } = require("../core/config");
const { captureScreenshots } = require("../core/capture");
const { compareScreenshots } = require("../core/compare");
const { generateReport, createZip } = require("../core/report");

const router = express.Router();

// In-memory job store
const jobs = new Map();
let jobCounter = 0;

/**
 * Creates a log function that stores messages and pushes to SSE listeners.
 */
function createJobLogger(job) {
  return function (level, message) {
    const timestamp = new Date().toLocaleTimeString();
    const icons = { info: "[i]", success: "[+]", error: "[!]", warn: "[~]" };
    const formatted = `${timestamp} ${icons[level] || "   "} ${message}`;
    job.logs.push({ level, message: formatted, ts: Date.now() });

    // Push to all SSE listeners
    for (const res of job.listeners) {
      res.write(`data: ${JSON.stringify({ level, message: formatted })}\n\n`);
    }
  };
}

// POST /api/jobs — start a comparison run
router.post("/", async (req, res) => {
  const { site } = req.body;

  let config;
  try {
    config = buildRuntimeConfig(site);
  } catch (err) {
    return res.status(400).json({ error: `Invalid site config: ${err.message}` });
  }

  const jobId = String(++jobCounter);
  const job = {
    id: jobId,
    site: config.template,
    status: "running",
    logs: [],
    listeners: [],
    startTime: Date.now(),
    reportPath: null,
    zipPath: null,
    summary: null,
  };
  jobs.set(jobId, job);

  res.json({ jobId });

  // Run comparison in background
  const log = createJobLogger(job);
  runJob(job, config, log).catch((err) => {
    log("error", `Fatal: ${err.message}`);
    job.status = "error";
    job.error = err.message;
    closeListeners(job);
  });
});

/**
 * Runs the full comparison pipeline.
 */
async function runJob(job, config, log) {
  // Load pixelmatch dynamically
  const pm = await import("pixelmatch");
  const pixelmatch = pm.default;

  log("info", `Starting visual regression for template: ${config.template}`);
  log("info", `Production: ${config.productionUrl}`);
  log("info", `Staging:    ${config.stagingUrl}`);
  log("info", `Pages:      ${config.pages.length}`);

  // Clean previous output
  log("info", "Cleaning previous output...");
  for (const dir of [config.outputDir, config.imagesDir]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  }
  await fsp.mkdir(config.imagesDir, { recursive: true });

  // Launch browser
  log("info", "Launching browser...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const devices = [];
  if (config.enableDesktop) devices.push("desktop");
  if (config.enableMobile) devices.push("mobile");

  // Capture screenshots
  for (const device of devices) {
    log("info", `Capturing ${device} screenshots...`);
    await Promise.all([
      captureScreenshots(browser, "prod", device, config, log),
      captureScreenshots(browser, "staging", device, config, log),
    ]);
  }

  await browser.close();
  log("success", "Browser closed. All screenshots captured.");

  // Compare images
  log("info", "Comparing screenshots...");
  const allResults = [];
  for (const device of devices) {
    const results = await compareScreenshots(device, config, pixelmatch, log);
    allResults.push(...results);
  }

  // Generate report
  log("info", "Generating HTML report...");
  const reportPath = await generateReport(allResults, config, log);

  // Create ZIP
  log("info", "Creating ZIP archive...");
  const zipPath = createZip(config.outputDir, log);

  // Summary
  const elapsed = ((Date.now() - job.startTime) / 1000).toFixed(1);
  const successful = allResults.filter((r) => r.success);
  const changedCount = successful.filter((r) => r.mismatchPercentage >= 1).length;

  job.summary = {
    template: config.template,
    comparisons: successful.length,
    identical: successful.filter((r) => r.mismatchPercentage === 0).length,
    minor: successful.filter((r) => r.mismatchPercentage > 0 && r.mismatchPercentage < 1).length,
    changed: changedCount,
    failed: allResults.filter((r) => !r.success).length,
    elapsed,
  };
  job.reportPath = reportPath;
  job.zipPath = zipPath;
  job.status = "done";

  log("success", `Completed in ${elapsed}s. ${changedCount} page(s) with visual differences.`);

  // Signal end to SSE listeners
  closeListeners(job);
}

function closeListeners(job) {
  for (const res of job.listeners) {
    res.write(`data: ${JSON.stringify({ type: "done", status: job.status, summary: job.summary })}\n\n`);
    res.end();
  }
  job.listeners = [];
}

// GET /api/jobs/:id/stream — SSE progress stream
router.get("/:id/stream", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send all existing logs first
  for (const entry of job.logs) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  if (job.status === "done" || job.status === "error") {
    res.write(`data: ${JSON.stringify({ type: "done", status: job.status, summary: job.summary })}\n\n`);
    res.end();
    return;
  }

  // Subscribe to future messages
  job.listeners.push(res);

  req.on("close", () => {
    const idx = job.listeners.indexOf(res);
    if (idx !== -1) job.listeners.splice(idx, 1);
  });
});

// GET /api/jobs/:id/status — poll status
router.get("/:id/status", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({
    id: job.id,
    site: job.site,
    status: job.status,
    summary: job.summary,
    error: job.error || null,
  });
});

module.exports = router;
