/**
 * core/audit.js — Shared audit engine for BrowserCompare
 *
 * Exports: auditPage(browser, fullUrl, pageConfig, timeout)
 *          generateReport(allPageResults, siteConfig, templateName, outputDir, totalPagesInConfig)
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ─── Scoring helpers ───────────────────────────────────────────────────────────

function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

function scorePerformance(perf, coverage) {
  let score = 100;
  if (perf.ttfb > 600)            score -= 20;
  else if (perf.ttfb > 200)       score -= 10;
  if (perf.fcp > 3000)            score -= 20;
  else if (perf.fcp > 1800)       score -= 10;
  if (perf.lcp > 4000)            score -= 20;
  else if (perf.lcp > 2500)       score -= 10;
  if (perf.cls > 0.25)            score -= 15;
  else if (perf.cls > 0.1)        score -= 7;
  if (perf.pageLoad > 6000)       score -= 15;
  else if (perf.pageLoad > 3000)  score -= 7;
  if (coverage.unusedJsPct > 60)  score -= 10;
  else if (coverage.unusedJsPct > 20) score -= 5;
  return clamp(score, 0, 100);
}

function scoreSEO(seo) {
  let score = 100;
  if (!seo.titleText)                                             score -= 20;
  else if (seo.titleLength < 30 || seo.titleLength > 60)         score -= 10;
  if (!seo.metaDescText)                                          score -= 20;
  else if (seo.metaDescLength < 120 || seo.metaDescLength > 160) score -= 10;
  if (seo.h1Count !== 1)                                          score -= 15;
  if (!seo.hasCanonical)                                          score -= 10;
  if (seo.imgsNoAlt > 0) score -= Math.min(seo.imgsNoAlt * 3, 20);
  if (!seo.isHttps)                                               score -= 5;
  return clamp(score, 0, 100);
}

function scoreBestPractices(result) {
  let score = 100;
  if (!result.seo.hasViewport)        score -= 20;
  if (!result.seo.isHttps)            score -= 20;
  if (result.mixedContent.length > 0) score -= 15;
  if (result.consoleErrors.length > 0)
    score -= Math.min(result.consoleErrors.length * 5, 25);
  if (result.resources.largeImagesCount > 0)
    score -= Math.min(result.resources.largeImagesCount * 5, 20);
  return clamp(score, 0, 100);
}

function scoreResources(resources, coverage) {
  let score = 100;
  const mb = resources.totalTransferBytes / (1024 * 1024);
  if (mb > 3)       score -= 20;
  else if (mb > 1)  score -= 10;
  if (resources.totalRequests > 100) score -= 15;
  else if (resources.totalRequests > 50) score -= 7;
  if (resources.imgsNoSize > 0) score -= Math.min(resources.imgsNoSize * 3, 15);
  if (coverage.unusedCssPct > 70)  score -= 10;
  else if (coverage.unusedCssPct > 40) score -= 5;
  if (resources.largeImagesCount > 3)  score -= 10;
  else if (resources.largeImagesCount > 0) score -= 5;
  return clamp(score, 0, 100);
}

function scoreColor(score) {
  if (score >= 90) return "#0cce6b";
  if (score >= 50) return "#ffa400";
  return "#ff4e42";
}

function scoreLabel(score) {
  if (score >= 90) return "Good";
  if (score >= 50) return "Needs Improvement";
  return "Poor";
}

function scoreBadgeClass(score) {
  if (score >= 90) return "good";
  if (score >= 50) return "warn";
  return "poor";
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

// ─── Recommendations ───────────────────────────────────────────────────────────

function buildRecommendations(result) {
  const recs = [];
  const { perfTiming, cls, coverage, resources, seo, mixedContent, consoleErrors } = result;
  if (perfTiming.ttfb > 600)
    recs.push("Reduce server response time (TTFB > 600ms). Consider server-side caching or a CDN.");
  if (perfTiming.lcp > 2500)
    recs.push("Improve Largest Contentful Paint. Preload hero images or optimize server delivery.");
  if (cls > 0.1)
    recs.push("Reduce Cumulative Layout Shift. Add explicit width/height to images and embeds.");
  if (perfTiming.fcp > 1800)
    recs.push("Improve First Contentful Paint. Eliminate render-blocking resources.");
  if (coverage.unusedJsPct > 50)
    recs.push(`${coverage.unusedJsPct}% of JavaScript is unused. Consider code splitting or deferred loading.`);
  if (coverage.unusedCssPct > 60)
    recs.push(`${coverage.unusedCssPct}% of CSS is unused. Audit and purge unused styles.`);
  if (resources.largeImagesCount > 0)
    recs.push(`${resources.largeImagesCount} image(s) exceed 100KB. Compress images and use modern formats (WebP/AVIF).`);
  if (resources.imgsNoSize > 0)
    recs.push(`${resources.imgsNoSize} image(s) missing width/height attributes. Add them to prevent layout shift.`);
  if (!seo.titleText)
    recs.push("Page is missing a <title> tag.");
  else if (seo.titleLength < 30 || seo.titleLength > 60)
    recs.push(`Title length (${seo.titleLength} chars) is outside the 30–60 character ideal range.`);
  if (!seo.metaDescText)
    recs.push("Page is missing a meta description. Add one (120–160 chars).");
  if (seo.h1Count === 0)
    recs.push("No H1 tag found. Add exactly one H1 tag per page.");
  if (seo.h1Count > 1)
    recs.push(`${seo.h1Count} H1 tags found. Each page should have exactly one H1.`);
  if (!seo.hasCanonical)
    recs.push("No canonical URL tag found. Add <link rel='canonical'> to prevent duplicate content issues.");
  if (seo.imgsNoAlt > 0)
    recs.push(`${seo.imgsNoAlt} image(s) missing alt attribute. Add descriptive alt text.`);
  if (mixedContent.length > 0)
    recs.push(`${mixedContent.length} mixed content resource(s) found (HTTP on HTTPS page). Upgrade URLs to HTTPS.`);
  if (consoleErrors.length > 0)
    recs.push(`${consoleErrors.length} console error(s) detected. Investigate JavaScript errors.`);
  if (resources.totalRequests > 100)
    recs.push(`${resources.totalRequests} network requests. Reduce requests through bundling or lazy loading.`);
  return recs;
}

// ─── Report HTML helpers ───────────────────────────────────────────────────────

function renderScoreCard(label, score) {
  const cls   = scoreBadgeClass(score);
  const color = scoreColor(score);
  return `<div class="score-card">
    <div class="score-circle" style="background:${color}">${score}</div>
    <div class="score-label">${label}</div>
    <div class="score-sub ${cls}">${scoreLabel(score)}</div>
  </div>`;
}

function renderMetric(label, value, unit, goodThreshold, poorThreshold, decimals) {
  decimals = decimals !== undefined ? decimals : 0;
  const num = parseFloat(value) || 0;
  const cls = num <= goodThreshold ? "val-good" : num >= poorThreshold ? "val-poor" : "val-warn";
  const display = decimals > 0 ? num.toFixed(decimals) : Math.round(num);
  return `<div class="metric-row">
    <span class="metric-name">${label}</span>
    <span class="metric-value ${cls}">${display}${unit}</span>
  </div>`;
}

function renderCheck(label, passes) {
  return `<div class="metric-row">
    <span class="metric-name">${label}</span>
    <span class="metric-value ${passes ? "val-good" : "val-poor"}">${passes ? "&#10003; Pass" : "&#10007; Fail"}</span>
  </div>`;
}

function renderPageTableRow(result, scores) {
  if (result.error) {
    return `<tr>
      <td>${result.pageConfig.id}</td>
      <td><a href="${result.fullUrl}" target="_blank">${result.pageConfig.url}</a></td>
      <td colspan="5" style="color:#ff4e42;text-align:center">Audit failed: ${result.error}</td>
    </tr>`;
  }
  const avgScore = Math.round((scores.perf + scores.seo + scores.bp + scores.res) / 4);
  return `<tr>
    <td>${result.pageConfig.id}</td>
    <td><a href="${result.fullUrl}" target="_blank">${result.pageConfig.url}</a></td>
    <td style="background:${scoreColor(scores.perf)};color:#fff;font-weight:700">${scores.perf}</td>
    <td style="background:${scoreColor(scores.seo)};color:#fff;font-weight:700">${scores.seo}</td>
    <td style="background:${scoreColor(scores.bp)};color:#fff;font-weight:700">${scores.bp}</td>
    <td style="background:${scoreColor(scores.res)};color:#fff;font-weight:700">${scores.res}</td>
    <td style="background:${scoreColor(avgScore)};color:#fff;font-weight:700">${avgScore}</td>
  </tr>`;
}

function renderPageDetail(result, scores, idx) {
  if (result.error) {
    return `<div class="page-detail">
      <div class="page-detail-header" onclick="toggleDetail(${idx})">
        <span class="page-id">[${result.pageConfig.id}]</span>
        <span>${result.fullUrl}</span>
        <span class="toggle-icon" id="icon-${idx}">&#9654;</span>
      </div>
      <div class="page-detail-body" id="detail-${idx}" style="display:none">
        <p style="color:#ff4e42">Audit failed: ${result.error}</p>
      </div>
    </div>`;
  }

  const { perfTiming, cls, coverage, resources, seo, mixedContent, consoleErrors, httpStatus, fullUrl } = result;
  const recs = buildRecommendations(result);

  return `<div class="page-detail">
    <div class="page-detail-header" onclick="toggleDetail(${idx})">
      <span class="page-id">[${result.pageConfig.id}]</span>
      <a href="${fullUrl}" target="_blank" onclick="event.stopPropagation()">${result.pageConfig.url}</a>
      <span class="http-badge ${httpStatus === 200 ? "val-good" : "val-poor"}">${httpStatus}</span>
      <span class="score-mini" style="background:${scoreColor(scores.perf)}">${scores.perf}</span>
      <span class="score-mini" style="background:${scoreColor(scores.seo)}">${scores.seo}</span>
      <span class="score-mini" style="background:${scoreColor(scores.bp)}">${scores.bp}</span>
      <span class="score-mini" style="background:${scoreColor(scores.res)}">${scores.res}</span>
      <button class="deepdive-btn" onclick="event.stopPropagation();startDeepDive(this,'${fullUrl}',${idx})" data-url="${fullUrl}">&#128269; Deep Dive</button>
      <span class="toggle-icon" id="icon-${idx}">&#9654;</span>
    </div>
    <div class="page-detail-body" id="detail-${idx}" style="display:none">
      <div class="metrics-grid">

        <div class="metrics-section">
          <h4>Performance</h4>
          ${renderMetric("TTFB",            perfTiming.ttfb,       "ms",  200,  600)}
          ${renderMetric("FCP",             perfTiming.fcp,        "ms",  1800, 3000)}
          ${renderMetric("LCP",             perfTiming.lcp,        "ms",  2500, 4000)}
          ${renderMetric("CLS",             cls,                   "",    0.1,  0.25, 3)}
          ${renderMetric("DOM Load",        perfTiming.domLoad,    "ms",  1500, 3000)}
          ${renderMetric("Page Load",       perfTiming.pageLoad,   "ms",  3000, 6000)}
          ${renderMetric("DOM Elements",    perfTiming.domElements,"",    1500, 3000)}
        </div>

        <div class="metrics-section">
          <h4>Resources</h4>
          ${renderMetric("Total Requests",    resources.totalRequests,   "",   50,   100)}
          <div class="metric-row">
            <span class="metric-name">Page Weight</span>
            <span class="metric-value ${resources.totalTransferBytes < 1048576 ? "val-good" : resources.totalTransferBytes > 3145728 ? "val-poor" : "val-warn"}">
              ${(resources.totalTransferBytes / 1024).toFixed(1)} KB
            </span>
          </div>
          ${renderMetric("Unused JS",         coverage.unusedJsPct,      "%",  20,   60)}
          ${renderMetric("Unused CSS",        coverage.unusedCssPct,     "%",  40,   70)}
          ${renderMetric("Images w/o size",   resources.imgsNoSize,      "",   0,    1)}
          ${renderMetric("Large imgs (>100KB)", resources.largeImagesCount,"", 0,    1)}
          ${resources.largeImagesDetails.length > 0
            ? `<ul class="img-list">${resources.largeImagesDetails.map(i =>
                `<li>${i.url.split("/").pop() || i.url} — ${(i.size / 1024).toFixed(1)}KB</li>`
              ).join("")}</ul>`
            : ""}
        </div>

        <div class="metrics-section">
          <h4>SEO</h4>
          <div class="metric-row">
            <span class="metric-name">Title</span>
            <span class="metric-value ${seo.titleLength >= 30 && seo.titleLength <= 60 ? "val-good" : seo.titleText ? "val-warn" : "val-poor"}">
              ${seo.titleText ? `"${seo.titleText.substring(0, 50)}${seo.titleText.length > 50 ? "..." : ""}" (${seo.titleLength})` : "Missing"}
            </span>
          </div>
          <div class="metric-row">
            <span class="metric-name">Meta Description</span>
            <span class="metric-value ${seo.metaDescLength >= 120 && seo.metaDescLength <= 160 ? "val-good" : seo.metaDescText ? "val-warn" : "val-poor"}">
              ${seo.metaDescText ? `${seo.metaDescLength} chars` : "Missing"}
            </span>
          </div>
          ${renderCheck("H1 Count = 1",     seo.h1Count === 1)}
          ${renderCheck("Canonical URL",    seo.hasCanonical)}
          ${renderCheck("Viewport meta",    seo.hasViewport)}
          ${renderCheck("HTTPS",            seo.isHttps)}
          <div class="metric-row">
            <span class="metric-name">Images missing alt</span>
            <span class="metric-value ${seo.imgsNoAlt === 0 ? "val-good" : "val-poor"}">${seo.imgsNoAlt} / ${seo.imgsTotal}</span>
          </div>
        </div>

        <div class="metrics-section">
          <h4>Best Practices</h4>
          ${renderCheck("Viewport meta",       seo.hasViewport)}
          ${renderCheck("HTTPS",               seo.isHttps)}
          ${renderCheck("No mixed content",    mixedContent.length === 0)}
          ${renderCheck("No console errors",   consoleErrors.length === 0)}
          ${consoleErrors.length > 0
            ? `<ul class="error-list">${consoleErrors.slice(0, 5).map(e =>
                `<li>${e.substring(0, 120)}</li>`).join("")}
              ${consoleErrors.length > 5 ? `<li>... and ${consoleErrors.length - 5} more</li>` : ""}</ul>`
            : ""}
        </div>

      </div>

      ${recs.length > 0
        ? `<div class="recommendations">
             <h4>Recommendations</h4>
             <ul>${recs.map(r => `<li>${r}</li>`).join("")}</ul>
           </div>`
        : `<div class="recommendations good-bg"><p>&#10003; No major issues found on this page.</p></div>`}

    </div>
  </div>`;
}

// ─── Report generator ──────────────────────────────────────────────────────────

/**
 * Generates and writes the HTML audit report.
 *
 * @param {Array}  allPageResults       - Results from auditPage()
 * @param {Object} siteConfig           - siteData[0] (has .config and .pages)
 * @param {string} templateName         - Site identifier
 * @param {string} outputDir            - Directory to write report into
 * @param {number} totalPagesInConfig   - Total pages in config (for header)
 * @returns {string} Path of the written report file
 */
function generateReport(allPageResults, siteConfig, templateName, outputDir, totalPagesInConfig) {
  const now = new Date().toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const pageScores = allPageResults.map(r => {
    if (r.error) return { perf: 0, seo: 0, bp: 0, res: 0 };
    return {
      perf: scorePerformance(r.perfTiming, r.coverage),
      seo:  scoreSEO(r.seo),
      bp:   scoreBestPractices(r),
      res:  scoreResources(r.resources, r.coverage),
    };
  });

  const validScores = pageScores.filter((_, i) => !allPageResults[i].error);
  const avgPerf = avg(validScores.map(s => s.perf));
  const avgSeo  = avg(validScores.map(s => s.seo));
  const avgBP   = avg(validScores.map(s => s.bp));
  const avgRes  = avg(validScores.map(s => s.res));
  const overall = avg([avgPerf, avgSeo, avgBP, avgRes]);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audit Report — ${templateName}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --green:  #0cce6b; --yellow: #ffa400; --red: #ff4e42;
      --bg: #f0f2f5; --card: #ffffff; --border: #e0e4ea;
      --text: #1a1a2e; --muted: #6b7280; --heading: #111827;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           background: var(--bg); color: var(--text); line-height: 1.5; }
    .report-header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                     color: #fff; padding: 36px 40px; }
    .report-header h1 { font-size: 1.8rem; font-weight: 700; margin-bottom: 6px; }
    .report-header p  { color: #a0aec0; font-size: 0.9rem; margin-top: 4px; }
    .report-header a  { color: #63b3ed; text-decoration: none; }
    .overall-badge { display: inline-block; margin-top: 14px; padding: 6px 18px;
                     border-radius: 20px; font-size: 1rem; font-weight: 700; color: #fff;
                     background: ${scoreColor(overall)}; }
    .dashboard { display: flex; gap: 20px; padding: 30px 40px; flex-wrap: wrap; }
    .score-card { background: var(--card); border-radius: 12px; padding: 24px;
                  text-align: center; flex: 1; min-width: 160px;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .score-circle { width: 80px; height: 80px; border-radius: 50%; display: flex;
                    align-items: center; justify-content: center; font-size: 1.6rem;
                    font-weight: 800; color: #fff; margin: 0 auto 10px; }
    .score-label { font-weight: 600; font-size: 0.9rem; color: var(--heading); margin-bottom: 4px; }
    .score-sub { font-size: 0.75rem; font-weight: 500; }
    .score-sub.good { color: var(--green); } .score-sub.warn { color: var(--yellow); } .score-sub.poor { color: var(--red); }
    .section { padding: 0 40px 30px; }
    .section h2 { font-size: 1.1rem; font-weight: 700; color: var(--heading);
                  margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid var(--border); }
    table { width: 100%; border-collapse: collapse; background: var(--card);
            border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    th { background: #1a1a2e; color: #fff; padding: 12px 14px; text-align: left; font-size: 0.8rem; font-weight: 600; }
    td { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
    td a { color: #2563eb; text-decoration: none; } td a:hover { text-decoration: underline; }
    tr:last-child td { border-bottom: none; } tr:hover td { background: #f9fafb; }
    .page-detail { background: var(--card); border-radius: 10px; margin-bottom: 10px;
                   box-shadow: 0 2px 6px rgba(0,0,0,0.06); overflow: hidden; }
    .page-detail-header { display: flex; align-items: center; gap: 10px; padding: 14px 18px;
                           cursor: pointer; user-select: none; }
    .page-detail-header:hover { background: #f9fafb; }
    .page-detail-body { padding: 20px 18px; border-top: 1px solid var(--border); }
    .page-id { background: #1a1a2e; color: #fff; padding: 2px 8px; border-radius: 4px;
               font-size: 0.75rem; font-weight: 600; flex-shrink: 0; }
    .page-detail-header a { color: #2563eb; font-size: 0.9rem; flex: 1; text-decoration: none; }
    .http-badge { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
    .score-mini { display: inline-flex; align-items: center; justify-content: center;
                  width: 32px; height: 24px; border-radius: 4px; color: #fff; font-size: 0.72rem; font-weight: 700; }
    .toggle-icon { margin-left: auto; color: var(--muted); font-size: 0.8rem; transition: transform 0.2s; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                    gap: 20px; margin-bottom: 20px; }
    .metrics-section h4 { font-size: 0.8rem; font-weight: 700; text-transform: uppercase;
                           letter-spacing: 0.05em; color: var(--muted); margin-bottom: 10px; }
    .metric-row { display: flex; justify-content: space-between; align-items: center;
                  padding: 6px 0; border-bottom: 1px solid #f3f4f6; font-size: 0.83rem; }
    .metric-row:last-child { border-bottom: none; }
    .metric-value { font-weight: 600; font-size: 0.83rem; }
    .val-good { color: #059669; } .val-warn { color: #d97706; } .val-poor { color: #dc2626; }
    .img-list, .error-list { padding-left: 16px; margin-top: 6px; }
    .img-list li, .error-list li { font-size: 0.78rem; color: var(--muted); margin-bottom: 3px; word-break: break-all; }
    .recommendations { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin-top: 4px; }
    .recommendations h4 { font-size: 0.8rem; font-weight: 700; text-transform: uppercase;
                           letter-spacing: 0.05em; color: #92400e; margin-bottom: 10px; }
    .recommendations ul { padding-left: 18px; }
    .recommendations li { font-size: 0.83rem; color: #78350f; margin-bottom: 6px; }
    .recommendations.good-bg { background: #ecfdf5; border-color: #6ee7b7; }
    .recommendations.good-bg p { color: #065f46; font-size: 0.85rem; font-weight: 500; }
    footer { text-align: center; padding: 24px; font-size: 0.75rem; color: var(--muted);
             border-top: 1px solid var(--border); margin-top: 10px; }
    /* Deep Dive button */
    .deepdive-btn { background: #1e3a5f; color: #93c5fd; border: 1px solid #3b82f6;
                    border-radius: 5px; padding: 3px 10px; font-size: 0.72rem; font-weight: 600;
                    cursor: pointer; white-space: nowrap; transition: background 0.15s; }
    .deepdive-btn:hover { background: #1d4ed8; color: #fff; }
    .deepdive-btn:disabled { opacity: 0.55; cursor: not-allowed; }
    /* Deep Dive overlay */
    .dd-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 1000;
                  display: flex; align-items: center; justify-content: center; }
    .dd-modal { background: #fff; border-radius: 12px; width: 540px; max-width: 92vw;
                max-height: 80vh; display: flex; flex-direction: column;
                box-shadow: 0 20px 60px rgba(0,0,0,0.35); overflow: hidden; }
    .dd-modal-head { background: #1a1a2e; color: #fff; padding: 14px 18px;
                     display: flex; align-items: center; justify-content: space-between; }
    .dd-modal-head h3 { font-size: 0.95rem; font-weight: 700; }
    .dd-modal-head span { color: #94a3b8; font-size: 0.78rem; white-space: nowrap;
                          overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
    .dd-modal-body { flex: 1; overflow-y: auto; padding: 14px; }
    .dd-log { background: #0f172a; color: #94a3b8; border-radius: 6px; padding: 10px;
              font-family: monospace; font-size: 0.75rem; line-height: 1.55;
              max-height: 240px; overflow-y: auto; margin-bottom: 10px; }
    .dd-log .l-success { color: #22c55e; } .dd-log .l-error { color: #ef4444; }
    .dd-log .l-info { color: #94a3b8; } .dd-log .l-warn { color: #eab308; }
    .dd-done { background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 8px;
               padding: 14px 16px; text-align: center; }
    .dd-done p { color: #065f46; font-weight: 600; margin-bottom: 10px; }
    .dd-open-btn { display: inline-block; background: #1d4ed8; color: #fff;
                   border-radius: 6px; padding: 8px 20px; font-size: 0.85rem;
                   font-weight: 600; text-decoration: none; }
    .dd-open-btn:hover { background: #1e40af; }
    .dd-close { background: none; border: none; color: #94a3b8; cursor: pointer;
                font-size: 1.1rem; line-height: 1; padding: 0 2px; }
    .dd-close:hover { color: #fff; }
    .dd-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid #3b82f6;
                  border-top-color: transparent; border-radius: 50%;
                  animation: spin .7s linear infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="report-header">
    <h1>Performance Audit Report</h1>
    <p><a href="${siteConfig.config.PRODUCTION_URL}" target="_blank">${siteConfig.config.PRODUCTION_URL}</a></p>
    <p>Template: <strong>${templateName}</strong> &nbsp;|&nbsp; Date: ${now} &nbsp;|&nbsp; Pages audited: ${allPageResults.length} of ${totalPagesInConfig}</p>
    <div class="overall-badge">Overall Score: ${overall}</div>
  </div>
  <div class="dashboard">
    ${renderScoreCard("Performance",    avgPerf)}
    ${renderScoreCard("SEO",            avgSeo)}
    ${renderScoreCard("Best Practices", avgBP)}
    ${renderScoreCard("Resources",      avgRes)}
  </div>
  <div class="section">
    <h2>Per-Page Scores</h2>
    <table>
      <thead>
        <tr><th>ID</th><th>URL</th><th>Performance</th><th>SEO</th><th>Best Practices</th><th>Resources</th><th>Average</th></tr>
      </thead>
      <tbody>
        ${allPageResults.map((r, i) => renderPageTableRow(r, pageScores[i])).join("\n")}
      </tbody>
    </table>
  </div>
  <div class="section">
    <h2>Detailed Findings</h2>
    ${allPageResults.map((r, i) => renderPageDetail(r, pageScores[i], i)).join("\n")}
  </div>
  <footer>Generated by <strong>BrowserCompare</strong> &nbsp;|&nbsp; Puppeteer &nbsp;|&nbsp; ${now}</footer>
  <script>
    // ── Accordion ──────────────────────────────────────────────────────────
    function toggleDetail(idx) {
      var body = document.getElementById("detail-" + idx);
      var icon = document.getElementById("icon-" + idx);
      if (body.style.display === "none") {
        body.style.display = "block"; icon.style.transform = "rotate(90deg)";
      } else {
        body.style.display = "none"; icon.style.transform = "";
      }
    }

    // ── Deep Dive ──────────────────────────────────────────────────────────
    function startDeepDive(btn, url, idx) {
      btn.disabled = true;

      // Build modal
      var overlay = document.createElement("div");
      overlay.className = "dd-overlay";
      overlay.innerHTML =
        '<div class="dd-modal">' +
          '<div class="dd-modal-head">' +
            '<h3><span class="dd-spinner"></span> Deep Dive Running</h3>' +
            '<span>' + url + '</span>' +
          '</div>' +
          '<div class="dd-modal-body">' +
            '<div class="dd-log" id="dd-log-' + idx + '"></div>' +
            '<div id="dd-result-' + idx + '"></div>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);

      // Close overlay on background click (only after job done)
      overlay.addEventListener("click", function(e) {
        if (e.target === overlay && overlay.dataset.done) {
          overlay.remove();
          btn.disabled = false;
        }
      });

      // Start job
      fetch("/api/deepdive", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ url: url }),
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.error) {
            finishDD(overlay, btn, idx, null, data.error);
            return;
          }

          var es = new EventSource("/api/deepdive/" + data.jobId + "/stream");
          es.onmessage = function(ev) {
            var msg = JSON.parse(ev.data);
            if (msg.type === "done") {
              es.close();
              finishDD(overlay, btn, idx, msg.status === "done" ? msg.summary : null,
                        msg.status !== "done" ? "Job failed" : null);
              return;
            }
            appendDDLog(idx, msg);
          };
          es.onerror = function() {
            es.close();
            finishDD(overlay, btn, idx, null, "Connection lost");
          };
        })
        .catch(function(err) {
          finishDD(overlay, btn, idx, null, err.message);
        });
    }

    function appendDDLog(idx, msg) {
      var log = document.getElementById("dd-log-" + idx);
      if (!log) return;
      var line = document.createElement("div");
      line.className = "l-" + (msg.level || "info");
      line.textContent = msg.message;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }

    function finishDD(overlay, btn, idx, summary, errMsg) {
      var head = overlay.querySelector(".dd-modal-head");
      var result = document.getElementById("dd-result-" + idx);
      overlay.dataset.done = "1";

      // Build close button via DOM to avoid escaping issues
      function makeCloseBtn() {
        var cb = document.createElement("button");
        cb.className = "dd-close";
        cb.textContent = "\u00d7";
        cb.addEventListener("click", function() {
          overlay.remove();
          btn.disabled = false;
        });
        return cb;
      }

      if (errMsg) {
        var h3e = document.createElement("h3");
        h3e.style.color = "#ef4444";
        h3e.textContent = "\u2717 Deep Dive Failed";
        head.innerHTML = "";
        head.appendChild(h3e);
        head.appendChild(makeCloseBtn());
        result.innerHTML = '<p style="color:#dc2626;font-size:.85rem">Error: ' + errMsg + '</p>';
        btn.disabled = false;
      } else {
        var h3s = document.createElement("h3");
        h3s.textContent = "\u2713 Deep Dive Complete";
        head.innerHTML = "";
        head.appendChild(h3s);
        head.appendChild(makeCloseBtn());
        result.innerHTML =
          '<div class="dd-done">' +
            '<p>Analysis complete in ' + summary.elapsed + 's</p>' +
            '<a href="/audit/' + summary.reportPath + '" target="_blank" class="dd-open-btn">Open Deep Dive Report</a>' +
          '</div>';
        btn.textContent = "View Report";
        btn.disabled = false;
        btn.onclick = function(e) {
          e.stopPropagation();
          window.open("/audit/" + summary.reportPath, "_blank");
        };
      }
    }
  </script>
</body>
</html>`;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, `${templateName}-audit-report.html`);
  fs.writeFileSync(outPath, html, "utf8");
  return outPath;
}

// ─── Core audit function ───────────────────────────────────────────────────────

/**
 * Audits a single page.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} fullUrl
 * @param {Object} pageConfig  - { id, url, ... }
 * @param {number} [timeout]   - Navigation timeout in ms (default 60000)
 * @returns {Promise<Object>}  Audit result object
 */
async function auditPage(browser, fullUrl, pageConfig, timeout) {
  timeout = timeout || 60000;
  const page = await browser.newPage();
  try {
    await page.setDefaultNavigationTimeout(timeout);
    await page.setViewport({ width: 1440, height: 900 });

    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.evaluateOnNewDocument(() => {
      window.__LCP_VALUE__ = 0;
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1];
          if (last) window.__LCP_VALUE__ = last.startTime;
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
      } catch (_) {}
    });

    await page.coverage.startJSCoverage();
    await page.coverage.startCSSCoverage();

    const response = await page.goto(fullUrl, { waitUntil: "networkidle2" });
    const httpStatus = response ? response.status() : 0;

    const perfTiming = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      const paintEntries = performance.getEntriesByType("paint");
      const fcpEntry = paintEntries.find(e => e.name === "first-contentful-paint");
      return {
        ttfb:        Math.round((nav.responseStart || 0) - (nav.requestStart || 0)),
        domLoad:     Math.round((nav.domContentLoadedEventEnd || 0) - (nav.startTime || 0)),
        pageLoad:    Math.round((nav.loadEventEnd || 0) - (nav.startTime || 0)),
        fcp:         Math.round(fcpEntry ? fcpEntry.startTime : 0),
        lcp:         Math.round(window.__LCP_VALUE__ || 0),
        domElements: document.querySelectorAll("*").length,
      };
    });

    const cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let clsScore = 0;
        try {
          const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach(entry => {
              if (!entry.hadRecentInput) clsScore += entry.value;
            });
          });
          observer.observe({ type: "layout-shift", buffered: true });
        } catch (_) {}
        setTimeout(() => resolve(parseFloat(clsScore.toFixed(4))), 1500);
      });
    });

    const seo = await page.evaluate(() => {
      const title     = document.querySelector("title");
      const metaDesc  = document.querySelector('meta[name="description"]');
      const h1s       = document.querySelectorAll("h1");
      const canonical = document.querySelector('link[rel="canonical"]');
      const viewport  = document.querySelector('meta[name="viewport"]');
      const imgsNoAlt = document.querySelectorAll("img:not([alt])").length;
      const imgsTotal = document.querySelectorAll("img").length;
      return {
        titleText:      title ? title.innerText.trim() : "",
        titleLength:    title ? title.innerText.trim().length : 0,
        metaDescText:   metaDesc ? metaDesc.getAttribute("content").trim() : "",
        metaDescLength: metaDesc ? metaDesc.getAttribute("content").trim().length : 0,
        h1Count:        h1s.length,
        hasCanonical:   !!canonical,
        canonicalUrl:   canonical ? canonical.href : "",
        hasViewport:    !!viewport,
        imgsNoAlt,
        imgsTotal,
        isHttps: location.protocol === "https:",
      };
    });

    const resources = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("img"));
      const imgsNoSize = imgs.filter(img =>
        !img.hasAttribute("width") || !img.hasAttribute("height")
      ).length;
      const resEntries = performance.getEntriesByType("resource");
      const imageEntries = resEntries.filter(r =>
        r.initiatorType === "img" || /\.(jpg|jpeg|png|gif|webp|avif|svg)/i.test(r.name)
      );
      const largeImages = imageEntries.filter(r => (r.transferSize || 0) > 100 * 1024);
      const totalTransferBytes = resEntries.reduce((acc, r) => acc + (r.transferSize || 0), 0);
      return {
        imgsNoSize,
        largeImagesCount:   largeImages.length,
        largeImagesDetails: largeImages.map(r => ({ url: r.name, size: r.transferSize })),
        totalTransferBytes,
        totalRequests:      resEntries.length,
        imageCount:         imgs.length,
      };
    });

    const mixedContent = await page.evaluate(() => {
      if (location.protocol !== "https:") return [];
      return performance.getEntriesByType("resource")
        .filter(r => r.name.startsWith("http://"))
        .map(r => r.name);
    });

    const [jsCoverage, cssCoverage] = await Promise.all([
      page.coverage.stopJSCoverage(),
      page.coverage.stopCSSCoverage(),
    ]);

    let totalJsBytes = 0, usedJsBytes = 0;
    for (const entry of jsCoverage) {
      totalJsBytes += entry.text.length;
      for (const range of entry.ranges) usedJsBytes += range.end - range.start;
    }
    let totalCssBytes = 0, usedCssBytes = 0;
    for (const entry of cssCoverage) {
      totalCssBytes += entry.text.length;
      for (const range of entry.ranges) usedCssBytes += range.end - range.start;
    }
    const unusedJsPct  = totalJsBytes  > 0 ? Math.round((1 - usedJsBytes / totalJsBytes) * 100)  : 0;
    const unusedCssPct = totalCssBytes > 0 ? Math.round((1 - usedCssBytes / totalCssBytes) * 100) : 0;

    return {
      pageConfig,
      fullUrl,
      httpStatus,
      perfTiming,
      cls,
      seo,
      resources,
      coverage: { totalJsBytes, usedJsBytes, unusedJsPct, totalCssBytes, usedCssBytes, unusedCssPct },
      mixedContent,
      consoleErrors,
    };

  } finally {
    await page.close();
  }
}

module.exports = { auditPage, generateReport };
