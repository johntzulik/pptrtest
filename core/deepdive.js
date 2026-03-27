/**
 * core/deepdive.js — Deep-dive analysis engine for BrowserCompare
 *
 * Exports:
 *   deepDivePage(browser, fullUrl, timeout)  → detailed result object
 *   generateDeepDiveReport(result, outputDir) → path to HTML report
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ─── Analysis engine ───────────────────────────────────────────────────────────

async function deepDivePage(browser, fullUrl, timeout) {
  timeout = timeout || 60000;
  const page = await browser.newPage();

  try {
    await page.setDefaultNavigationTimeout(timeout);
    await page.setViewport({ width: 1440, height: 900 });

    const consoleMessages = [];
    page.on("console", msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));

    // LCP + FID observers before navigation
    await page.evaluateOnNewDocument(() => {
      window.__LCP__ = 0; window.__FID__ = 0;
      try { new PerformanceObserver(l => { const e = l.getEntries().slice(-1)[0]; if (e) window.__LCP__ = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch (_) {}
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__FID__ = e.processingStart - e.startTime; }).observe({ type: "first-input", buffered: true }); } catch (_) {}
    });

    await page.coverage.startJSCoverage();
    await page.coverage.startCSSCoverage();

    const response = await page.goto(fullUrl, { waitUntil: "networkidle2" });
    const httpStatus     = response ? response.status() : 0;
    const responseHeaders = response ? response.headers() : {};

    // Settle
    await new Promise(r => setTimeout(r, 1800));

    // ── Performance timing ─────────────────────────────────────────────────
    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      const ps  = performance.getEntriesByType("paint");
      const fcp = (ps.find(p => p.name === "first-contentful-paint") || {}).startTime || 0;
      return {
        dnsLookup:        Math.round(nav.domainLookupEnd   - nav.domainLookupStart),
        tcpConnect:       Math.round(nav.connectEnd        - nav.connectStart),
        tlsHandshake:     nav.secureConnectionStart > 0 ? Math.round(nav.connectEnd - nav.secureConnectionStart) : 0,
        ttfb:             Math.round(nav.responseStart     - nav.requestStart),
        download:         Math.round(nav.responseEnd       - nav.responseStart),
        domInteractive:   Math.round(nav.domInteractive    - nav.startTime),
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
        domComplete:      Math.round(nav.domComplete       - nav.startTime),
        loadEvent:        Math.round(nav.loadEventEnd      - nav.startTime),
        fcp:              Math.round(fcp),
        lcp:              Math.round(window.__LCP__ || 0),
        fid:              Math.round(window.__FID__ || 0),
        domElements:      document.querySelectorAll("*").length,
        domDepth: (function d(el, n) { var m = n; for (var c of el.children) { var k = d(c, n+1); if(k>m) m=k; } return m; })(document.documentElement, 0),
        iframes:          document.querySelectorAll("iframe").length,
        totalScripts:     document.querySelectorAll("script").length,
        inlineScripts:    document.querySelectorAll("script:not([src])").length,
        externalScripts:  document.querySelectorAll("script[src]").length,
        totalStylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
        inlineStyles:     document.querySelectorAll("[style]").length,
      };
    });

    // ── CLS ───────────────────────────────────────────────────────────────
    const cls = await page.evaluate(() => new Promise(resolve => {
      let s = 0;
      try { new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) s += e.value; })).observe({ type: "layout-shift", buffered: true }); } catch (_) {}
      setTimeout(() => resolve(parseFloat(s.toFixed(4))), 1500);
    }));

    // ── All network resources ──────────────────────────────────────────────
    const resources = await page.evaluate(() =>
      performance.getEntriesByType("resource").map(r => ({
        url:         r.name,
        type:        r.initiatorType,
        size:        r.transferSize   || 0,
        decoded:     r.decodedBodySize || 0,
        duration:    Math.round(r.duration),
        ttfb:        Math.round(Math.max(0, r.responseStart - r.startTime)),
        startTime:   Math.round(r.startTime),
        protocol:    r.nextHopProtocol || "",
        cached:      r.transferSize === 0 && r.decodedBodySize > 0,
      }))
    );

    // ── Images deep audit ──────────────────────────────────────────────────
    const images = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img")).map(img => ({
        src:           img.currentSrc || img.src || "",
        alt:           img.alt,
        hasAlt:        img.hasAttribute("alt"),
        hasWidth:      img.hasAttribute("width"),
        hasHeight:     img.hasAttribute("height"),
        naturalW:      img.naturalWidth,
        naturalH:      img.naturalHeight,
        renderedW:     img.offsetWidth,
        renderedH:     img.offsetHeight,
        lazy:          img.loading === "lazy",
        decoding:      img.decoding || "auto",
        format:        (img.currentSrc || img.src || "").match(/\.(jpe?g|png|gif|webp|avif|svg)/i)?.[1]?.toLowerCase() || "?",
        isOversized:   img.naturalWidth > img.offsetWidth * 1.5 && img.offsetWidth > 0,
      }))
    );

    // ── JavaScript deep audit ──────────────────────────────────────────────
    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script")).map(s => ({
        src:    s.src  || null,
        inline: !s.src,
        type:   s.type || "text/javascript",
        defer:  s.defer,
        async:  s.async,
        module: s.type === "module",
        size:   s.src ? null : s.textContent.length,
      }))
    );

    // ── CSS deep audit ────────────────────────────────────────────────────
    const cssLinks = await page.evaluate(() => ({
      external: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => ({
        href: l.href, media: l.media || "all", disabled: l.disabled,
      })),
      inline: Array.from(document.querySelectorAll("style")).map(s => ({
        size: s.textContent.length, media: s.media || "all",
      })),
    }));

    // ── Accessibility audit ────────────────────────────────────────────────
    const a11y = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map(h => ({
        level: parseInt(h.tagName[1]),
        text:  h.textContent.trim().substring(0, 100),
        id:    h.id || null,
      }));

      const forms = Array.from(document.querySelectorAll("form")).map(form => {
        const inputs = Array.from(form.querySelectorAll("input, textarea, select"));
        const unlabeled = inputs.filter(inp => {
          if (["hidden","submit","button","reset","image"].includes(inp.type)) return false;
          if (inp.getAttribute("aria-label") || inp.getAttribute("aria-labelledby")) return false;
          return !inp.id || !document.querySelector('label[for="' + inp.id + '"]');
        });
        return {
          action:         form.action,
          method:         form.method || "get",
          inputCount:     inputs.length,
          unlabeled:      unlabeled.map(i => ({ type: i.type || i.tagName.toLowerCase(), name: i.name })),
        };
      });

      const allLinks = Array.from(document.querySelectorAll("a[href]"));
      const links = {
        total:          allLinks.length,
        external:       allLinks.filter(a => a.hostname && a.hostname !== location.hostname).length,
        noText:         allLinks.filter(a => !a.textContent.trim() && !a.getAttribute("aria-label") && !a.querySelector("img[alt]")).length,
        newTab:         allLinks.filter(a => a.target === "_blank").length,
        newTabNoOpener: allLinks.filter(a => a.target === "_blank" && !(a.rel || "").includes("noopener")).length,
      };

      const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).map(b => ({
        text:        (b.textContent || "").trim().substring(0, 60),
        ariaLabel:   b.getAttribute("aria-label") || null,
        hasText:     !!b.textContent.trim(),
        hasAriaLabel:!!b.getAttribute("aria-label"),
        disabled:    b.disabled || b.getAttribute("aria-disabled") === "true",
      }));

      const emptyButtons = buttons.filter(b => !b.hasText && !b.hasAriaLabel);

      return {
        htmlLang:    document.documentElement.lang || null,
        hasSkipLink: !!document.querySelector('a[href^="#"]'),
        landmarks: {
          main:   !!document.querySelector('main, [role="main"]'),
          nav:    !!document.querySelector('nav, [role="navigation"]'),
          banner: !!document.querySelector('header, [role="banner"]'),
          contentinfo: !!document.querySelector('footer, [role="contentinfo"]'),
          search: !!document.querySelector('[role="search"]'),
        },
        headings,
        forms,
        links,
        buttons,
        emptyButtons,
        imgsNoAlt:   document.querySelectorAll("img:not([alt])").length,
        imgsTotal:   document.querySelectorAll("img").length,
        tabindexPositive: Array.from(document.querySelectorAll("[tabindex]"))
          .filter(el => parseInt(el.getAttribute("tabindex")) > 0).length,
      };
    });

    // ── SEO deep audit ─────────────────────────────────────────────────────
    const seo = await page.evaluate(() => {
      const og = {}, tc = {};
      document.querySelectorAll('meta[property^="og:"]').forEach(m => { og[m.getAttribute("property")] = m.getAttribute("content"); });
      document.querySelectorAll('meta[name^="twitter:"]').forEach(m => { tc[m.getAttribute("name")] = m.getAttribute("content"); });
      const jsonLd = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => { try { jsonLd.push(JSON.parse(s.textContent)); } catch (_) {} });

      const title    = document.querySelector("title");
      const desc     = document.querySelector('meta[name="description"]');
      const kw       = document.querySelector('meta[name="keywords"]');
      const canonical = document.querySelector('link[rel="canonical"]');
      const robots   = document.querySelector('meta[name="robots"]');
      const viewport = document.querySelector('meta[name="viewport"]');

      return {
        title:       title ? title.innerText.trim() : null,
        titleLen:    title ? title.innerText.trim().length : 0,
        desc:        desc ? desc.getAttribute("content").trim() : null,
        descLen:     desc ? desc.getAttribute("content").trim().length : 0,
        keywords:    kw ? kw.getAttribute("content") : null,
        canonical:   canonical ? canonical.href : null,
        robots:      robots ? robots.getAttribute("content") : null,
        viewport:    viewport ? viewport.getAttribute("content") : null,
        htmlLang:    document.documentElement.lang || null,
        h1Count:     document.querySelectorAll("h1").length,
        h1Texts:     Array.from(document.querySelectorAll("h1")).map(h => h.textContent.trim()),
        isHttps:     location.protocol === "https:",
        openGraph:   og,
        twitterCards: tc,
        jsonLd,
        hasSitemap:  !!document.querySelector('link[rel="sitemap"]'),
        hasRss:      !!document.querySelector('link[type="application/rss+xml"]'),
        hasFavicon:  !!document.querySelector('link[rel="icon"], link[rel="shortcut icon"]'),
      };
    });

    // ── Security headers ───────────────────────────────────────────────────
    const sec = {
      hsts:       responseHeaders["strict-transport-security"] || null,
      csp:        responseHeaders["content-security-policy"]   || null,
      xframe:     responseHeaders["x-frame-options"]           || null,
      xctype:     responseHeaders["x-content-type-options"]    || null,
      referrer:   responseHeaders["referrer-policy"]           || null,
      permissions:responseHeaders["permissions-policy"] || responseHeaders["feature-policy"] || null,
      xss:        responseHeaders["x-xss-protection"]         || null,
      server:     responseHeaders["server"]                    || null,
      poweredBy:  responseHeaders["x-powered-by"]             || null,
      cacheCtrl:  responseHeaders["cache-control"]            || null,
    };

    // ── Coverage per file ──────────────────────────────────────────────────
    const [jsCov, cssCov] = await Promise.all([
      page.coverage.stopJSCoverage(),
      page.coverage.stopCSSCoverage(),
    ]);

    const jsFiles = jsCov.map(e => {
      const used = e.ranges.reduce((a, r) => a + r.end - r.start, 0);
      return { url: e.url, total: e.text.length, used, unusedPct: e.text.length > 0 ? Math.round((1 - used / e.text.length) * 100) : 0 };
    });
    const cssFiles = cssCov.map(e => {
      const used = e.ranges.reduce((a, r) => a + r.end - r.start, 0);
      return { url: e.url, total: e.text.length, used, unusedPct: e.text.length > 0 ? Math.round((1 - used / e.text.length) * 100) : 0 };
    });

    const totalJs  = jsFiles.reduce((a, f) => a + f.total, 0);
    const usedJs   = jsFiles.reduce((a, f) => a + f.used,  0);
    const totalCss = cssFiles.reduce((a, f) => a + f.total, 0);
    const usedCss  = cssFiles.reduce((a, f) => a + f.used,  0);

    return {
      url: fullUrl, httpStatus, responseHeaders,
      perf, cls,
      resources, images, scripts, cssLinks,
      a11y, seo, sec,
      coverage: {
        jsFiles, cssFiles,
        unusedJsPct:  totalJs  > 0 ? Math.round((1 - usedJs  / totalJs)  * 100) : 0,
        unusedCssPct: totalCss > 0 ? Math.round((1 - usedCss / totalCss) * 100) : 0,
        totalJsKB:  Math.round(totalJs  / 1024),
        totalCssKB: Math.round(totalCss / 1024),
      },
      consoleMessages,
    };

  } finally {
    await page.close();
  }
}

// ─── Recommendations builder ───────────────────────────────────────────────────

function buildDeepRecommendations(r) {
  const recs = [];

  // Performance
  if (r.perf.ttfb > 600)    recs.push({ cat: "Performance", pri: "high",   text: `TTFB is ${r.perf.ttfb}ms (>600ms). Use server-side caching, a CDN, or optimize your backend response time.` });
  if (r.perf.lcp  > 2500)   recs.push({ cat: "Performance", pri: "high",   text: `LCP is ${r.perf.lcp}ms (>2500ms). Preload the hero image, reduce server response, eliminate render-blocking resources.` });
  if (r.perf.fcp  > 1800)   recs.push({ cat: "Performance", pri: "medium", text: `FCP is ${r.perf.fcp}ms (>1800ms). Eliminate render-blocking CSS/JS; inline critical CSS.` });
  if (r.cls        > 0.1)   recs.push({ cat: "Performance", pri: "medium", text: `CLS is ${r.cls} (>0.1). Set explicit width & height on all images and iframes.` });
  if (r.perf.loadEvent > 5000) recs.push({ cat: "Performance", pri: "medium", text: `Total load time ${r.perf.loadEvent}ms. Reduce large resources and third-party scripts.` });
  if (r.perf.domElements > 1500) recs.push({ cat: "Performance", pri: "low", text: `${r.perf.domElements} DOM elements. Large DOMs slow rendering. Simplify page structure.` });

  // Resources
  const totalKB = r.resources.reduce((a, x) => a + x.size, 0) / 1024;
  if (totalKB > 3000)  recs.push({ cat: "Resources", pri: "high",   text: `Page weight is ${Math.round(totalKB)}KB (>3MB). Compress assets, remove unused dependencies.` });
  if (r.resources.length > 100) recs.push({ cat: "Resources", pri: "medium", text: `${r.resources.length} network requests. Bundle assets and use HTTP/2 push or resource hints.` });

  // JS
  if (r.coverage.unusedJsPct > 50) recs.push({ cat: "JavaScript", pri: "high",   text: `${r.coverage.unusedJsPct}% of JavaScript is unused (${r.coverage.totalJsKB}KB total). Use code splitting and tree shaking.` });
  const nonDeferredExternal = (r.scripts || []).filter(s => s.src && !s.defer && !s.async && !s.module);
  if (nonDeferredExternal.length > 0) recs.push({ cat: "JavaScript", pri: "high", text: `${nonDeferredExternal.length} render-blocking external script(s). Add defer or async attribute.` });

  // CSS
  if (r.coverage.unusedCssPct > 60) recs.push({ cat: "CSS", pri: "medium", text: `${r.coverage.unusedCssPct}% of CSS is unused (${r.coverage.totalCssKB}KB total). Remove dead CSS or use PurgeCSS.` });

  // Images
  const noAlt = r.images.filter(i => !i.hasAlt);
  if (noAlt.length > 0) recs.push({ cat: "Accessibility", pri: "high", text: `${noAlt.length} image(s) missing alt attribute. Add descriptive alt text for screen readers.` });
  const noSize = r.images.filter(i => !i.hasWidth || !i.hasHeight);
  if (noSize.length > 0) recs.push({ cat: "Performance",  pri: "medium", text: `${noSize.length} image(s) without explicit width/height. This causes layout shift (CLS).` });
  const oversized = r.images.filter(i => i.isOversized);
  if (oversized.length > 0) recs.push({ cat: "Resources", pri: "medium", text: `${oversized.length} oversized image(s) — rendered much smaller than natural size. Use responsive images or resize server-side.` });
  const oldFormat = r.images.filter(i => ["jpg","jpeg","png","gif"].includes(i.format));
  if (oldFormat.length > 0) recs.push({ cat: "Resources", pri: "low", text: `${oldFormat.length} image(s) in legacy format (JPEG/PNG/GIF). Convert to WebP or AVIF for 25–50% smaller files.` });
  const noLazy = r.images.filter((i, idx) => idx > 2 && !i.lazy);
  if (noLazy.length > 0) recs.push({ cat: "Performance", pri: "low", text: `${noLazy.length} below-fold image(s) not lazy-loaded. Add loading="lazy" to defer off-screen images.` });

  // Accessibility
  if (!r.a11y.htmlLang)  recs.push({ cat: "Accessibility", pri: "high",   text: 'HTML element is missing the lang attribute. Add lang="en" (or appropriate language code).' });
  if (!r.a11y.landmarks.main)   recs.push({ cat: "Accessibility", pri: "medium", text: "No <main> landmark found. Wrap primary content in <main> for screen reader navigation." });
  if (!r.a11y.landmarks.nav)    recs.push({ cat: "Accessibility", pri: "low",    text: "No <nav> landmark found. Wrap navigation links in <nav>." });
  if (r.a11y.emptyButtons.length > 0) recs.push({ cat: "Accessibility", pri: "high", text: `${r.a11y.emptyButtons.length} button(s) with no text or aria-label. Add descriptive labels.` });
  if (r.a11y.links.noText > 0)  recs.push({ cat: "Accessibility", pri: "high",  text: `${r.a11y.links.noText} link(s) have no visible text or aria-label. Screen readers cannot identify them.` });
  if (r.a11y.links.newTabNoOpener > 0) recs.push({ cat: "Accessibility", pri: "medium", text: `${r.a11y.links.newTabNoOpener} _blank link(s) missing rel="noopener noreferrer". Security + usability risk.` });
  r.a11y.forms.forEach(f => {
    if (f.unlabeled.length > 0) recs.push({ cat: "Accessibility", pri: "high", text: `Form (${f.action || "unnamed"}) has ${f.unlabeled.length} unlabeled input(s). Associate <label> elements or add aria-label.` });
  });
  if (r.a11y.tabindexPositive > 0) recs.push({ cat: "Accessibility", pri: "medium", text: `${r.a11y.tabindexPositive} element(s) use positive tabindex. This disrupts natural keyboard tab order.` });

  // SEO
  if (!r.seo.title)    recs.push({ cat: "SEO", pri: "high",   text: "Page is missing a <title> tag." });
  else if (r.seo.titleLen < 30) recs.push({ cat: "SEO", pri: "medium", text: `Title is too short (${r.seo.titleLen} chars). Aim for 30–60 characters.` });
  else if (r.seo.titleLen > 60) recs.push({ cat: "SEO", pri: "low",    text: `Title is too long (${r.seo.titleLen} chars). Keep under 60 characters to avoid truncation in SERPs.` });
  if (!r.seo.desc)     recs.push({ cat: "SEO", pri: "high",   text: "Missing meta description. Add one (120–160 chars) to improve click-through rate." });
  else if (r.seo.descLen < 120) recs.push({ cat: "SEO", pri: "low",  text: `Meta description is short (${r.seo.descLen} chars). Aim for 120–160 characters.` });
  if (r.seo.h1Count === 0) recs.push({ cat: "SEO", pri: "high",   text: "No H1 tag found. Add exactly one H1 per page." });
  if (r.seo.h1Count > 1)  recs.push({ cat: "SEO", pri: "medium", text: `${r.seo.h1Count} H1 tags found. Use exactly one H1 per page.` });
  if (!r.seo.canonical) recs.push({ cat: "SEO", pri: "medium", text: "No canonical URL tag. Add <link rel='canonical'> to prevent duplicate content issues." });
  if (!r.seo.openGraph["og:title"]) recs.push({ cat: "SEO", pri: "low", text: "Missing og:title (Open Graph). Add OG meta tags to improve social sharing previews." });
  if (!r.seo.twitterCards["twitter:card"]) recs.push({ cat: "SEO", pri: "low", text: "Missing twitter:card meta tag. Add Twitter Card tags for better X/Twitter previews." });

  // Security
  if (!r.sec.hsts)        recs.push({ cat: "Security", pri: r.seo.isHttps ? "medium" : "high", text: "Missing Strict-Transport-Security (HSTS) header. Enforce HTTPS connections." });
  if (!r.sec.csp)         recs.push({ cat: "Security", pri: "medium", text: "No Content-Security-Policy header. Reduces risk of XSS attacks." });
  if (!r.sec.xframe)      recs.push({ cat: "Security", pri: "low",    text: "Missing X-Frame-Options header. Consider adding DENY or SAMEORIGIN to prevent clickjacking." });
  if (!r.sec.xctype)      recs.push({ cat: "Security", pri: "low",    text: "Missing X-Content-Type-Options: nosniff header. Prevents MIME-type sniffing." });
  if (r.sec.poweredBy)    recs.push({ cat: "Security", pri: "low",    text: `X-Powered-By header reveals technology (${r.sec.poweredBy}). Remove it to reduce information disclosure.` });

  // Sort by priority
  const priOrder = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => priOrder[a.pri] - priOrder[b.pri]);
  return recs;
}

// ─── Report generator ──────────────────────────────────────────────────────────

function esc(s) { return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function kb(bytes) { return bytes > 0 ? (bytes / 1024).toFixed(1) + " KB" : "0 B"; }

function priColor(p) { return p === "high" ? "#ef4444" : p === "medium" ? "#f59e0b" : "#6b7280"; }
function priLabel(p) { return p === "high" ? "High" : p === "medium" ? "Medium" : "Low"; }

function timingBar(label, val, max, good, poor) {
  const pct = Math.min(100, (val / max) * 100);
  const cls = val <= good ? "good" : val >= poor ? "poor" : "warn";
  return `<div class="tbar-row">
    <span class="tbar-label">${label}</span>
    <div class="tbar-track"><div class="tbar-fill tbar-${cls}" style="width:${pct}%"></div></div>
    <span class="tbar-val tbar-${cls}">${val}ms</span>
  </div>`;
}

function resourceTypeGroup(resources) {
  const groups = {};
  for (const r of resources) {
    const t = r.type || "other";
    if (!groups[t]) groups[t] = { count: 0, size: 0 };
    groups[t].count++; groups[t].size += r.size;
  }
  return Object.entries(groups).sort((a, b) => b[1].size - a[1].size);
}

function headingTree(headings) {
  if (!headings.length) return "<em>No headings found.</em>";
  return headings.map(h => {
    const indent = (h.level - 1) * 16;
    const cls = h.level === 1 ? "h1" : h.level <= 3 ? "h-mid" : "h-low";
    return `<div class="heading-row ${cls}" style="padding-left:${indent}px">
      <span class="h-tag">H${h.level}</span> ${esc(h.text)}
    </div>`;
  }).join("");
}

function generateDeepDiveReport(result, outputDir) {
  const recs  = buildDeepRecommendations(result);
  const now   = new Date().toLocaleString("en-US", { year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit" });
  const slug  = result.url.replace(/https?:\/\//,"").replace(/[^a-z0-9]/gi,"_").substring(0, 60);
  const fname = `deepdive-${slug}-${Date.now()}.html`;
  const totalKB = Math.round(result.resources.reduce((a, r) => a + r.size, 0) / 1024);

  const highRecs   = recs.filter(r => r.pri === "high");
  const medRecs    = recs.filter(r => r.pri === "medium");
  const lowRecs    = recs.filter(r => r.pri === "low");
  const scoreApprox = Math.max(0, 100 - highRecs.length * 12 - medRecs.length * 5 - lowRecs.length * 1);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deep Dive — ${esc(result.url)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#f1f5f9;--card:#fff;--border:#e2e8f0;--text:#1e293b;--muted:#64748b;--head:#0f172a;--blue:#3b82f6;--green:#16a34a;--yellow:#d97706;--red:#dc2626;--purple:#7c3aed}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.55;font-size:14px}
a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}

/* Header */
.hdr{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:#fff;padding:2rem 2.5rem}
.hdr h1{font-size:1.5rem;font-weight:700;margin-bottom:.4rem}
.hdr .url{color:#93c5fd;font-size:.9rem;word-break:break-all}
.hdr .meta{color:#94a3b8;font-size:.8rem;margin-top:.3rem}
.score-badge{display:inline-block;margin-top:1rem;padding:.4rem 1.2rem;border-radius:20px;font-weight:700;font-size:1rem;color:#fff;background:${scoreApprox >= 80 ? "#16a34a" : scoreApprox >= 50 ? "#d97706" : "#dc2626"}}

/* Layout */
.page{max-width:1100px;margin:0 auto;padding:1.5rem}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem}

/* Cards */
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1.25rem;margin-bottom:1rem}
.card h2{font-size:.95rem;font-weight:700;margin-bottom:1rem;padding-bottom:.5rem;border-bottom:2px solid var(--border);color:var(--head);display:flex;align-items:center;gap:.5rem}
.card h3{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:.8rem 0 .4rem}

/* KPI grid */
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.6rem;margin-bottom:1rem}
.kpi{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.6rem .8rem;text-align:center}
.kpi .val{font-size:1.3rem;font-weight:700}
.kpi .lbl{font-size:.7rem;color:var(--muted);text-transform:uppercase}
.good{color:var(--green)} .warn{color:var(--yellow)} .poor{color:var(--red)} .neutral{color:var(--blue)}

/* Timing bars */
.tbar-row{display:flex;align-items:center;gap:.5rem;margin:.3rem 0;font-size:.8rem}
.tbar-label{width:130px;flex-shrink:0;color:var(--muted)}
.tbar-track{flex:1;background:#e2e8f0;border-radius:3px;height:8px;overflow:hidden}
.tbar-fill{height:100%;border-radius:3px}
.tbar-good{background:var(--green)} .tbar-warn{background:var(--yellow)} .tbar-poor{background:var(--red)}
.tbar-val{width:60px;text-align:right;font-weight:600;font-size:.78rem;flex-shrink:0}

/* Recommendations */
.rec-item{display:flex;gap:.75rem;padding:.6rem .75rem;border-radius:6px;margin-bottom:.4rem;background:var(--bg);border-left:3px solid}
.rec-item.high{border-color:var(--red)}
.rec-item.medium{border-color:var(--yellow)}
.rec-item.low{border-color:#94a3b8}
.rec-badge{font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:10px;flex-shrink:0;align-self:flex-start;margin-top:2px;color:#fff}
.rec-badge.high{background:var(--red)} .rec-badge.medium{background:var(--yellow)} .rec-badge.low{background:#94a3b8}
.rec-cat{font-size:.65rem;font-weight:600;color:var(--muted);margin-right:.3rem}
.rec-text{font-size:.82rem;line-height:1.4}

/* Table */
table.dt{width:100%;border-collapse:collapse;font-size:.8rem}
table.dt th{background:var(--bg);padding:.4rem .6rem;text-align:left;color:var(--muted);font-weight:600;border-bottom:1px solid var(--border);font-size:.72rem;text-transform:uppercase}
table.dt td{padding:.35rem .6rem;border-bottom:1px solid var(--border);word-break:break-all}
table.dt tr:last-child td{border-bottom:none}
table.dt tr:hover td{background:#f8fafc}
.url-cell{max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Heading tree */
.heading-row{font-size:.82rem;padding:.2rem 0;border-bottom:1px solid #f1f5f9}
.heading-row:last-child{border-bottom:none}
.h-tag{display:inline-block;width:26px;font-size:.65rem;font-weight:700;color:#fff;background:var(--blue);border-radius:3px;text-align:center;padding:1px 0;margin-right:.4rem}
.h1 .h-tag{background:#7c3aed}
.h-low .h-tag{background:#94a3b8}

/* Check grid */
.check-grid{display:grid;grid-template-columns:1fr 1fr;gap:.3rem}
.check-row{display:flex;align-items:center;gap:.4rem;font-size:.82rem;padding:.25rem 0}
.check-icon{font-size:.85rem;flex-shrink:0}

/* Badge */
.badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:.65rem;font-weight:600}
.badge-green{background:#dcfce7;color:#166534} .badge-red{background:#fee2e2;color:#991b1b}
.badge-yellow{background:#fef9c3;color:#854d0e} .badge-gray{background:#f1f5f9;color:#64748b}
.badge-blue{background:#dbeafe;color:#1e40af}

/* Security header rows */
.sec-row{display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid var(--border);font-size:.82rem}
.sec-row:last-child{border-bottom:none}
.sec-name{color:var(--muted);font-family:monospace;font-size:.78rem}
.sec-val{font-size:.75rem;color:var(--text);max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}

/* Section nav */
.section-nav{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem}
.section-nav a{padding:.3rem .8rem;background:var(--card);border:1px solid var(--border);border-radius:20px;font-size:.78rem;color:var(--muted);transition:all .15s}
.section-nav a:hover{color:var(--blue);border-color:var(--blue);text-decoration:none}

footer{text-align:center;padding:1.5rem;font-size:.72rem;color:var(--muted);border-top:1px solid var(--border);margin-top:1rem}
</style>
</head>
<body>

<div class="hdr">
  <h1>Deep Dive Analysis</h1>
  <div class="url"><a href="${esc(result.url)}" target="_blank" style="color:#93c5fd">${esc(result.url)}</a></div>
  <div class="meta">Generated ${now} &nbsp;|&nbsp; HTTP ${result.httpStatus} &nbsp;|&nbsp; ${totalKB} KB total &nbsp;|&nbsp; ${result.resources.length} requests</div>
  <div class="score-badge">Estimated Score: ${scoreApprox}/100</div>
</div>

<div class="page">

  <!-- Section nav -->
  <div class="section-nav">
    <a href="#s-recs">Recommendations</a>
    <a href="#s-perf">Performance</a>
    <a href="#s-resources">Resources</a>
    <a href="#s-js">JavaScript</a>
    <a href="#s-css">CSS</a>
    <a href="#s-images">Images</a>
    <a href="#s-a11y">Accessibility</a>
    <a href="#s-seo">SEO</a>
    <a href="#s-sec">Security</a>
    <a href="#s-console">Console</a>
  </div>

  <!-- Recommendations -->
  <div class="card" id="s-recs">
    <h2>&#9888; Recommendations <span style="font-size:.75rem;font-weight:400;color:var(--muted)">${recs.length} total — ${highRecs.length} high · ${medRecs.length} medium · ${lowRecs.length} low</span></h2>
    ${recs.length === 0
      ? `<p style="color:var(--green);font-weight:600">&#10003; No significant issues found — great work!</p>`
      : recs.map(r => `
        <div class="rec-item ${r.pri}">
          <span class="rec-badge ${r.pri}">${priLabel(r.pri)}</span>
          <div>
            <span class="rec-cat">[${r.cat}]</span>
            <span class="rec-text">${esc(r.text)}</span>
          </div>
        </div>`).join("")}
  </div>

  <!-- Performance -->
  <div class="card" id="s-perf">
    <h2>&#9201; Performance</h2>
    <div class="kpi-grid">
      <div class="kpi"><div class="val ${result.perf.ttfb <= 200 ? "good" : result.perf.ttfb >= 600 ? "poor" : "warn"}">${result.perf.ttfb}ms</div><div class="lbl">TTFB</div></div>
      <div class="kpi"><div class="val ${result.perf.fcp  <= 1800 ? "good" : result.perf.fcp >= 3000 ? "poor" : "warn"}">${result.perf.fcp}ms</div><div class="lbl">FCP</div></div>
      <div class="kpi"><div class="val ${result.perf.lcp  <= 2500 ? "good" : result.perf.lcp >= 4000 ? "poor" : "warn"}">${result.perf.lcp}ms</div><div class="lbl">LCP</div></div>
      <div class="kpi"><div class="val ${result.cls <= 0.1 ? "good" : result.cls >= 0.25 ? "poor" : "warn"}">${result.cls.toFixed(3)}</div><div class="lbl">CLS</div></div>
      <div class="kpi"><div class="val ${result.perf.loadEvent <= 3000 ? "good" : result.perf.loadEvent >= 6000 ? "poor" : "warn"}">${result.perf.loadEvent}ms</div><div class="lbl">Load</div></div>
      <div class="kpi"><div class="val neutral">${result.perf.domContentLoaded}ms</div><div class="lbl">DOMContentLoaded</div></div>
    </div>

    <h3>Navigation Waterfall</h3>
    ${timingBar("DNS Lookup",      result.perf.dnsLookup,        300,  50,  150)}
    ${timingBar("TCP Connect",     result.perf.tcpConnect,       500,  80,  250)}
    ${result.perf.tlsHandshake > 0 ? timingBar("TLS Handshake", result.perf.tlsHandshake, 500, 100, 300) : ""}
    ${timingBar("TTFB",            result.perf.ttfb,             800,  200, 600)}
    ${timingBar("Download",        result.perf.download,         2000, 200, 800)}
    ${timingBar("DOM Interactive", result.perf.domInteractive,   3000, 1000,2000)}
    ${timingBar("DOM Complete",    result.perf.domComplete,      6000, 2000,4000)}
    ${timingBar("Load Event",      result.perf.loadEvent,        8000, 3000,6000)}

    <h3>DOM Statistics</h3>
    <div class="check-grid">
      <div class="check-row"><span class="check-icon ${result.perf.domElements > 1500 ? "poor" : "good"}">&#9679;</span> DOM Elements: <strong>${result.perf.domElements}</strong></div>
      <div class="check-row"><span class="check-icon neutral">&#9679;</span> Max DOM Depth: <strong>${result.perf.domDepth}</strong></div>
      <div class="check-row"><span class="check-icon neutral">&#9679;</span> Iframes: <strong>${result.perf.iframes}</strong></div>
      <div class="check-row"><span class="check-icon neutral">&#9679;</span> Scripts: <strong>${result.perf.totalScripts}</strong> (${result.perf.externalScripts} ext · ${result.perf.inlineScripts} inline)</div>
      <div class="check-row"><span class="check-icon neutral">&#9679;</span> Stylesheets: <strong>${result.perf.totalStylesheets}</strong></div>
      <div class="check-row"><span class="check-icon neutral">&#9679;</span> Inline styles: <strong>${result.perf.inlineStyles}</strong></div>
    </div>
  </div>

  <!-- Resources -->
  <div class="card" id="s-resources">
    <h2>&#128228; Resources &nbsp;<span style="font-size:.8rem;font-weight:400;color:var(--muted)">${result.resources.length} requests · ${totalKB} KB</span></h2>
    <h3>By Type</h3>
    <table class="dt">
      <thead><tr><th>Type</th><th>Count</th><th>Size</th></tr></thead>
      <tbody>
        ${resourceTypeGroup(result.resources).map(([t, g]) =>
          `<tr><td>${esc(t)}</td><td>${g.count}</td><td>${kb(g.size)}</td></tr>`
        ).join("")}
      </tbody>
    </table>
    <h3>Largest Requests (top 15)</h3>
    <table class="dt">
      <thead><tr><th>URL</th><th>Type</th><th>Size</th><th>Duration</th><th>TTFB</th><th>Cached</th></tr></thead>
      <tbody>
        ${result.resources.slice().sort((a,b) => b.size - a.size).slice(0,15).map(r => `
          <tr>
            <td class="url-cell" title="${esc(r.url)}">${esc(r.url.split("/").slice(-2).join("/") || r.url)}</td>
            <td>${esc(r.type)}</td>
            <td>${kb(r.size)}</td>
            <td>${r.duration}ms</td>
            <td>${r.ttfb}ms</td>
            <td>${r.cached ? '<span class="badge badge-green">cached</span>' : '<span class="badge badge-gray">no</span>'}</td>
          </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <div class="grid2">

  <!-- JavaScript -->
  <div class="card" id="s-js">
    <h2>&#128196; JavaScript</h2>
    <div class="kpi-grid">
      <div class="kpi"><div class="val neutral">${result.coverage.totalJsKB} KB</div><div class="lbl">Total JS</div></div>
      <div class="kpi"><div class="val ${result.coverage.unusedJsPct > 60 ? "poor" : result.coverage.unusedJsPct > 30 ? "warn" : "good"}">${result.coverage.unusedJsPct}%</div><div class="lbl">Unused</div></div>
      <div class="kpi"><div class="val neutral">${result.coverage.jsFiles.length}</div><div class="lbl">Files</div></div>
    </div>
    <h3>Per-file Breakdown</h3>
    <table class="dt">
      <thead><tr><th>File</th><th>Size</th><th>Unused</th></tr></thead>
      <tbody>
        ${result.coverage.jsFiles.slice().sort((a,b) => b.total - a.total).map(f => `
          <tr>
            <td class="url-cell" title="${esc(f.url)}">${esc(f.url.split("/").pop() || f.url)}</td>
            <td>${kb(f.total)}</td>
            <td><span class="badge ${f.unusedPct > 60 ? "badge-red" : f.unusedPct > 30 ? "badge-yellow" : "badge-green"}">${f.unusedPct}%</span></td>
          </tr>`).join("")}
      </tbody>
    </table>
    <h3>Script Loading</h3>
    ${(result.scripts || []).filter(s => s.src).map(s => `
      <div class="check-row">
        <span class="check-icon ${(s.defer || s.async || s.module) ? "good" : "poor"}">&#9679;</span>
        <span style="font-size:.75rem;word-break:break-all">${esc(s.src.split("/").pop())}
          ${s.defer ? '<span class="badge badge-green">defer</span>' : ""}
          ${s.async ? '<span class="badge badge-blue">async</span>' : ""}
          ${s.module ? '<span class="badge badge-blue">module</span>' : ""}
          ${(!s.defer && !s.async && !s.module) ? '<span class="badge badge-red">render-blocking</span>' : ""}
        </span>
      </div>`).join("")}
  </div>

  <!-- CSS -->
  <div class="card" id="s-css">
    <h2>&#127912; CSS</h2>
    <div class="kpi-grid">
      <div class="kpi"><div class="val neutral">${result.coverage.totalCssKB} KB</div><div class="lbl">Total CSS</div></div>
      <div class="kpi"><div class="val ${result.coverage.unusedCssPct > 70 ? "poor" : result.coverage.unusedCssPct > 40 ? "warn" : "good"}">${result.coverage.unusedCssPct}%</div><div class="lbl">Unused</div></div>
      <div class="kpi"><div class="val neutral">${result.coverage.cssFiles.length}</div><div class="lbl">Files</div></div>
    </div>
    <h3>Per-file Breakdown</h3>
    <table class="dt">
      <thead><tr><th>File</th><th>Size</th><th>Unused</th></tr></thead>
      <tbody>
        ${result.coverage.cssFiles.slice().sort((a,b) => b.total - a.total).map(f => `
          <tr>
            <td class="url-cell" title="${esc(f.url)}">${esc(f.url.split("/").pop() || f.url)}</td>
            <td>${kb(f.total)}</td>
            <td><span class="badge ${f.unusedPct > 70 ? "badge-red" : f.unusedPct > 40 ? "badge-yellow" : "badge-green"}">${f.unusedPct}%</span></td>
          </tr>`).join("")}
      </tbody>
    </table>
    ${result.cssLinks.inline.length > 0 ? `<h3>Inline Styles</h3><p style="font-size:.8rem;color:var(--muted)">${result.cssLinks.inline.length} inline &lt;style&gt; block(s) — ${kb(result.cssLinks.inline.reduce((a,s)=>a+s.size,0))} total</p>` : ""}
  </div>

  </div><!-- /grid2 -->

  <!-- Images -->
  <div class="card" id="s-images">
    <h2>&#128247; Images &nbsp;<span style="font-size:.8rem;font-weight:400;color:var(--muted)">${result.images.length} found</span></h2>
    ${result.images.length === 0 ? "<p style='color:var(--muted)'>No images found.</p>" : `
    <table class="dt">
      <thead><tr><th>Source</th><th>Format</th><th>Natural</th><th>Rendered</th><th>Alt</th><th>Size attrs</th><th>Lazy</th><th>Issues</th></tr></thead>
      <tbody>
        ${result.images.map(img => {
          const issues = [];
          if (!img.hasAlt)    issues.push('<span class="badge badge-red">no alt</span>');
          if (!img.hasWidth || !img.hasHeight) issues.push('<span class="badge badge-yellow">no size</span>');
          if (img.isOversized) issues.push('<span class="badge badge-yellow">oversized</span>');
          if (!img.lazy)      issues.push('<span class="badge badge-gray">no lazy</span>');
          if (["jpg","jpeg","png"].includes(img.format)) issues.push('<span class="badge badge-gray">legacy fmt</span>');
          return `<tr>
            <td class="url-cell" title="${esc(img.src)}">${esc(img.src.split("/").pop() || img.src)}</td>
            <td>${img.format}</td>
            <td>${img.naturalW}&times;${img.naturalH}</td>
            <td>${img.renderedW}&times;${img.renderedH}</td>
            <td>${img.hasAlt ? '<span class="badge badge-green">yes</span>' : '<span class="badge badge-red">no</span>'}</td>
            <td>${(img.hasWidth && img.hasHeight) ? '<span class="badge badge-green">yes</span>' : '<span class="badge badge-yellow">no</span>'}</td>
            <td>${img.lazy ? '<span class="badge badge-green">lazy</span>' : '<span class="badge badge-gray">eager</span>'}</td>
            <td>${issues.join(" ")}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`}
  </div>

  <div class="grid2">

  <!-- Accessibility -->
  <div class="card" id="s-a11y">
    <h2>&#9855; Accessibility</h2>
    <div class="check-grid">
      <div class="check-row"><span class="check-icon ${result.a11y.htmlLang ? "good" : "poor"}">&#9679;</span> HTML lang: <strong>${result.a11y.htmlLang || "missing"}</strong></div>
      <div class="check-row"><span class="check-icon ${result.a11y.hasSkipLink ? "good" : "warn"}">&#9679;</span> Skip link: <strong>${result.a11y.hasSkipLink ? "present" : "missing"}</strong></div>
      <div class="check-row"><span class="check-icon ${result.a11y.landmarks.main ? "good" : "poor"}">&#9679;</span> &lt;main&gt;: <strong>${result.a11y.landmarks.main ? "present" : "missing"}</strong></div>
      <div class="check-row"><span class="check-icon ${result.a11y.landmarks.nav ? "good" : "warn"}">&#9679;</span> &lt;nav&gt;: <strong>${result.a11y.landmarks.nav ? "present" : "missing"}</strong></div>
      <div class="check-row"><span class="check-icon ${result.a11y.landmarks.banner ? "good" : "warn"}">&#9679;</span> &lt;header&gt;: <strong>${result.a11y.landmarks.banner ? "present" : "missing"}</strong></div>
      <div class="check-row"><span class="check-icon ${result.a11y.landmarks.contentinfo ? "good" : "warn"}">&#9679;</span> &lt;footer&gt;: <strong>${result.a11y.landmarks.contentinfo ? "present" : "missing"}</strong></div>
      <div class="check-row"><span class="check-icon ${result.a11y.imgsNoAlt === 0 ? "good" : "poor"}">&#9679;</span> Imgs missing alt: <strong>${result.a11y.imgsNoAlt}/${result.a11y.imgsTotal}</strong></div>
      <div class="check-row"><span class="check-icon ${result.a11y.emptyButtons.length === 0 ? "good" : "poor"}">&#9679;</span> Empty buttons: <strong>${result.a11y.emptyButtons.length}</strong></div>
      <div class="check-row"><span class="check-icon ${result.a11y.links.noText === 0 ? "good" : "poor"}">&#9679;</span> Links no text: <strong>${result.a11y.links.noText}/${result.a11y.links.total}</strong></div>
      <div class="check-row"><span class="check-icon ${result.a11y.links.newTabNoOpener === 0 ? "good" : "warn"}">&#9679;</span> _blank no opener: <strong>${result.a11y.links.newTabNoOpener}</strong></div>
      <div class="check-row"><span class="check-icon ${result.a11y.tabindexPositive === 0 ? "good" : "warn"}">&#9679;</span> Positive tabindex: <strong>${result.a11y.tabindexPositive}</strong></div>
    </div>
    <h3>Heading Structure</h3>
    <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:.5rem">
      ${headingTree(result.a11y.headings)}
    </div>
    ${result.a11y.forms.length > 0 ? `<h3>Forms (${result.a11y.forms.length})</h3>
      ${result.a11y.forms.map(f => `
        <div style="background:var(--bg);border-radius:6px;padding:.5rem .75rem;margin:.3rem 0;font-size:.8rem">
          <strong>${esc(f.method.toUpperCase())}</strong> ${esc(f.action || "—")} &nbsp;
          ${f.unlabeled.length > 0
            ? `<span class="badge badge-red">${f.unlabeled.length} unlabeled inputs</span>`
            : `<span class="badge badge-green">all labeled</span>`}
        </div>`).join("")}` : ""}
  </div>

  <!-- SEO -->
  <div class="card" id="s-seo">
    <h2>&#128269; SEO</h2>
    <div class="check-row"><span class="check-icon ${result.seo.title ? "good" : "poor"}">&#9679;</span>
      Title: <strong style="margin-left:.3rem">${esc(result.seo.title || "missing")}</strong>
      ${result.seo.title ? `<span class="badge ${result.seo.titleLen >= 30 && result.seo.titleLen <= 60 ? "badge-green" : "badge-yellow"}" style="margin-left:.3rem">${result.seo.titleLen} chars</span>` : ""}</div>
    <div class="check-row" style="margin-top:.4rem"><span class="check-icon ${result.seo.desc ? "good" : "poor"}">&#9679;</span>
      Meta desc: ${result.seo.desc ? `<span class="badge ${result.seo.descLen >= 120 && result.seo.descLen <= 160 ? "badge-green" : "badge-yellow"}">${result.seo.descLen} chars</span>` : '<span class="badge badge-red">missing</span>'}
    </div>
    <div class="check-grid" style="margin-top:.5rem">
      <div class="check-row"><span class="check-icon ${result.seo.h1Count === 1 ? "good" : "poor"}">&#9679;</span> H1 count: <strong>${result.seo.h1Count}</strong></div>
      <div class="check-row"><span class="check-icon ${result.seo.canonical ? "good" : "warn"}">&#9679;</span> Canonical: <strong>${result.seo.canonical ? "present" : "missing"}</strong></div>
      <div class="check-row"><span class="check-icon ${result.seo.isHttps ? "good" : "poor"}">&#9679;</span> HTTPS: <strong>${result.seo.isHttps ? "yes" : "no"}</strong></div>
      <div class="check-row"><span class="check-icon ${result.seo.htmlLang ? "good" : "warn"}">&#9679;</span> Lang attr: <strong>${result.seo.htmlLang || "missing"}</strong></div>
      <div class="check-row"><span class="check-icon ${result.seo.openGraph["og:title"] ? "good" : "warn"}">&#9679;</span> Open Graph: <strong>${result.seo.openGraph["og:title"] ? "present" : "missing"}</strong></div>
      <div class="check-row"><span class="check-icon ${result.seo.twitterCards["twitter:card"] ? "good" : "warn"}">&#9679;</span> Twitter Card: <strong>${result.seo.twitterCards["twitter:card"] ? result.seo.twitterCards["twitter:card"] : "missing"}</strong></div>
    </div>
    ${result.seo.jsonLd.length > 0 ? `<h3>Structured Data (JSON-LD)</h3>
      ${result.seo.jsonLd.map(j => `<div class="badge badge-blue" style="margin:.2rem .1rem;font-size:.72rem">${esc(j["@type"] || "Unknown")}</div>`).join("")}` : ""}
    ${Object.keys(result.seo.openGraph).length > 0 ? `<h3>Open Graph Tags</h3>
      ${Object.entries(result.seo.openGraph).map(([k,v]) =>
        `<div class="sec-row"><span class="sec-name">${esc(k)}</span><span class="sec-val" title="${esc(v)}">${esc(v)}</span></div>`
      ).join("")}` : ""}
  </div>

  </div><!-- /grid2 -->

  <!-- Security Headers -->
  <div class="card" id="s-sec">
    <h2>&#128274; Security Headers</h2>
    ${[
      ["Strict-Transport-Security (HSTS)", result.sec.hsts],
      ["Content-Security-Policy",          result.sec.csp],
      ["X-Frame-Options",                  result.sec.xframe],
      ["X-Content-Type-Options",           result.sec.xctype],
      ["Referrer-Policy",                  result.sec.referrer],
      ["Permissions-Policy",               result.sec.permissions],
      ["X-XSS-Protection",                 result.sec.xss],
      ["Cache-Control",                    result.sec.cacheCtrl],
      ["Server",                           result.sec.server],
      ["X-Powered-By",                     result.sec.poweredBy],
    ].map(([name, val]) => `
      <div class="sec-row">
        <span class="sec-name">${esc(name)}</span>
        ${val
          ? `<span class="sec-val ${name.includes("X-Powered-By") || name.includes("Server") ? "warn" : "good"}" title="${esc(val)}">${esc(val.substring(0, 80))}${val.length > 80 ? "…" : ""}</span>`
          : `<span class="badge badge-red">missing</span>`}
      </div>`).join("")}
  </div>

  <!-- Console Messages -->
  <div class="card" id="s-console">
    <h2>&#128187; Console Messages &nbsp;<span style="font-size:.75rem;font-weight:400;color:var(--muted)">${result.consoleMessages.length} total</span></h2>
    ${result.consoleMessages.length === 0
      ? `<p style="color:var(--green);font-weight:600">&#10003; No console messages</p>`
      : `<table class="dt">
          <thead><tr><th>Type</th><th>Message</th></tr></thead>
          <tbody>
            ${result.consoleMessages.map(m => `
              <tr>
                <td><span class="badge ${m.type === "error" ? "badge-red" : m.type === "warn" || m.type === "warning" ? "badge-yellow" : "badge-gray"}">${esc(m.type)}</span></td>
                <td style="font-size:.78rem;word-break:break-all">${esc(m.text.substring(0, 200))}</td>
              </tr>`).join("")}
          </tbody>
        </table>`}
  </div>

</div><!-- /page -->

<footer>Generated by <strong>BrowserCompare Deep Dive</strong> &nbsp;|&nbsp; ${now}</footer>

</body></html>`;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, fname);
  fs.writeFileSync(outPath, html, "utf8");
  return { path: outPath, file: fname };
}

module.exports = { deepDivePage, generateDeepDiveReport };
