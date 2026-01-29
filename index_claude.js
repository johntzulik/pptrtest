/**
 * index_claude.js - Visual Regression Testing Tool (CLI)
 *
 * Visually compares a production site against its staging version.
 * Captures screenshots of both (desktop and mobile), generates diff
 * images with pixelmatch, and produces a self-contained HTML report
 * with a results dashboard and change percentages.
 *
 * Usage:
 *   node index_claude.js
 *
 * Configuration:
 *   - .env          -> folder paths, viewports, template name
 *   - sites/*.json  -> production/staging URLs and page list
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const puppeteer = require("puppeteer");

const { buildRuntimeConfig } = require("./core/config");
const { captureScreenshots } = require("./core/capture");
const { compareScreenshots } = require("./core/compare");
const { generateReport, createZip } = require("./core/report");

// Load .env
require("dotenv").config({ path: path.join(__dirname, ".env") });

/**
 * Prints a message with a timestamp and level indicator.
 * @param {"info"|"success"|"error"|"warn"} level
 * @param {string} message
 */
function log(level, message) {
  const icons = { info: "[i]", success: "[+]", error: "[!]", warn: "[~]" };
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${timestamp} ${icons[level] || "   "} ${message}`);
}

/**
 * Main function. Runs the full pipeline:
 * 1. Clean previous output folders
 * 2. Capture production and staging screenshots (parallel per device)
 * 3. Generate diff images with pixelmatch
 * 4. Generate self-contained HTML report
 * 5. Create ZIP archive for sharing
 */
async function main() {
  // Load pixelmatch dynamically (v7+ is ESM-only)
  const pm = await import("pixelmatch");
  const pixelmatch = pm.default;

  // Build runtime config from .env + site JSON
  const config = buildRuntimeConfig();

  const startTime = Date.now();
  log("info", `Starting visual regression for template: ${config.template}`);
  log("info", `Production: ${config.productionUrl}`);
  log("info", `Staging:    ${config.stagingUrl}`);
  log("info", `Pages:      ${config.pages.length}`);

  // 1. Clean previous output
  log("info", "Cleaning previous output...");
  for (const dir of [config.outputDir, config.imagesDir]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  }
  await fsp.mkdir(config.imagesDir, { recursive: true });

  // 2. Launch browser once
  log("info", "Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const devices = [];
  if (config.enableDesktop) devices.push("desktop");
  if (config.enableMobile) devices.push("mobile");

  // 3. Capture screenshots - production and staging in parallel per device
  for (const device of devices) {
    log("info", `Capturing ${device} screenshots...`);
    await Promise.all([
      captureScreenshots(browser, "prod", device, config, log),
      captureScreenshots(browser, "staging", device, config, log),
    ]);
  }

  await browser.close();
  log("success", "Browser closed. All screenshots captured.");

  // 4. Compare images
  log("info", "Comparing screenshots...");
  const allResults = [];
  for (const device of devices) {
    const results = await compareScreenshots(device, config, pixelmatch, log);
    allResults.push(...results);
  }

  // 5. Generate report
  log("info", "Generating HTML report...");
  const reportPath = await generateReport(allResults, config, log);

  // 6. Create ZIP for sharing
  log("info", "Creating ZIP archive...");
  const zipPath = createZip(config.outputDir, log);

  // 7. Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = allResults.filter((r) => r.success);
  const changedCount = successful.filter((r) => r.mismatchPercentage >= 1).length;

  console.log("\n══════════════════════════════════════════");
  console.log("  VISUAL REGRESSION REPORT SUMMARY");
  console.log("══════════════════════════════════════════");
  console.log(`  Template:    ${config.template}`);
  console.log(`  Comparisons: ${successful.length}`);
  console.log(`  Identical:   ${successful.filter((r) => r.mismatchPercentage === 0).length}`);
  console.log(`  Minor (<1%): ${successful.filter((r) => r.mismatchPercentage > 0 && r.mismatchPercentage < 1).length}`);
  console.log(`  Changed:     ${changedCount}`);
  console.log(`  Failed:      ${allResults.filter((r) => !r.success).length}`);
  console.log(`  Time:        ${elapsed}s`);
  console.log(`  Report:      ${path.resolve(reportPath)}`);
  if (zipPath) {
    console.log(`  ZIP:         ${path.resolve(zipPath)}`);
  }
  console.log("══════════════════════════════════════════\n");

  if (changedCount > 0) {
    log("warn", `${changedCount} page(s) have visual differences!`);
  } else {
    log("success", "All pages are visually identical.");
  }
}

main().catch((err) => {
  log("error", `Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
