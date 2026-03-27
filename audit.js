/**
 * audit.js — Standalone performance audit script
 *
 * Usage:
 *   node audit.js
 *
 * Reads TEMPLATE from .env → loads sites/[TEMPLATE].json
 * Output: audit/[TEMPLATE]-audit-report.html
 */

const puppeteer = require("puppeteer");
const path      = require("path");
const dotenv    = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env") });

const { auditPage, generateReport } = require("./core/audit");

const templateName   = process.env.TEMPLATE;
const templatex      = require("./sites/" + templateName + ".json");
const PRODUCTION_URL = templatex[0].config.PRODUCTION_URL;
const TIMEOUT        = parseInt(process.env.TIMEOUT || "60000");
const pages          = templatex[0].pages;
const MAX_PAGES      = 30;
const OUTPUT_DIR     = path.join(__dirname, "audit");

async function init() {
  // Audit pages that have audit !== false
  const pagesToAudit = pages.filter(p => p.audit !== false).slice(0, MAX_PAGES);

  console.log(`\nBrowserCompare — Performance Audit`);
  console.log(`Site     : ${PRODUCTION_URL}`);
  console.log(`Template : ${templateName}`);
  console.log(`Pages    : ${pagesToAudit.length} of ${pages.length} (MAX_PAGES=${MAX_PAGES})`);
  console.log(`─────────────────────────────────────────\n`);

  const allPageResults = [];
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    for (const pageConfig of pagesToAudit) {
      const fullUrl = PRODUCTION_URL.replace(/\/$/, "") + pageConfig.url;
      process.stdout.write(`  [${pageConfig.id}] ${pageConfig.url} ... `);
      try {
        const result = await auditPage(browser, fullUrl, pageConfig, TIMEOUT);
        allPageResults.push(result);
        console.log(
          `FCP:${result.perfTiming.fcp}ms  LCP:${result.perfTiming.lcp}ms  ` +
          `CLS:${result.cls.toFixed(3)}  Load:${result.perfTiming.pageLoad}ms`
        );
      } catch (err) {
        console.log(`FAILED — ${err.message}`);
        allPageResults.push({ pageConfig, fullUrl: PRODUCTION_URL + pageConfig.url, error: err.message });
      }
    }

    console.log("\n  Generating report...");
    const outPath = generateReport(allPageResults, templatex[0], templateName, OUTPUT_DIR, pages.length);
    console.log(`  Report saved to: ${outPath}`);
    console.log(`  Open in browser: file://${outPath}\n`);

  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

init();
