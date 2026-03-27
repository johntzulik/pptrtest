// content.js — Injected into the audited page to collect metrics
// Communicates back to background.js via chrome.runtime.sendMessage

(async () => {
  const result = await collectAuditData();
  chrome.runtime.sendMessage({ action: 'auditData', data: result });
})();

async function collectAuditData() {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paint = performance.getEntriesByType('paint');

  // ── Web Vitals via PerformanceObserver (already-collected entries) ──────
  const vitals = { fcp: null, lcp: null, cls: 0, fid: null };

  paint.forEach(entry => {
    if (entry.name === 'first-contentful-paint') vitals.fcp = entry.startTime;
  });

  // LCP
  try {
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
    if (lcpEntries.length) vitals.lcp = lcpEntries[lcpEntries.length - 1].startTime;
  } catch (_) {}

  // CLS (layout-shift entries)
  try {
    let clsVal = 0;
    performance.getEntriesByType('layout-shift').forEach(e => {
      if (!e.hadRecentInput) clsVal += e.value;
    });
    vitals.cls = clsVal;
  } catch (_) {}

  // ── Timing ──────────────────────────────────────────────────────────────
  const timing = {
    ttfb:       nav.responseStart - nav.requestStart,
    fcp:        vitals.fcp,
    lcp:        vitals.lcp,
    cls:        vitals.cls,
    domInteractive: nav.domInteractive,
    domComplete:    nav.domComplete,
    loadEvent:      nav.loadEventEnd - nav.startTime,
    dns:        nav.domainLookupEnd - nav.domainLookupStart,
    tcp:        nav.connectEnd - nav.connectStart,
    tls:        nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0,
    transferSize: nav.transferSize,
    encodedBodySize: nav.encodedBodySize,
    decodedBodySize: nav.decodedBodySize
  };

  // ── SEO ─────────────────────────────────────────────────────────────────
  const titleEl = document.querySelector('title');
  const metaDesc = document.querySelector('meta[name="description"]');
  const canonical = document.querySelector('link[rel="canonical"]');
  const viewport  = document.querySelector('meta[name="viewport"]');
  const h1s = document.querySelectorAll('h1');
  const robotsMeta = document.querySelector('meta[name="robots"]');

  const images = [...document.querySelectorAll('img')];
  const imagesNoAlt = images.filter(img => !img.alt || !img.alt.trim()).length;
  const imagesTotal = images.length;

  const seo = {
    title:            titleEl ? titleEl.textContent.trim() : null,
    titleLength:      titleEl ? titleEl.textContent.trim().length : 0,
    metaDescription:  metaDesc ? metaDesc.getAttribute('content') : null,
    metaDescLength:   metaDesc ? (metaDesc.getAttribute('content') || '').length : 0,
    h1Count:          h1s.length,
    h1Text:           h1s[0] ? h1s[0].textContent.trim().slice(0, 80) : null,
    canonical:        canonical ? canonical.getAttribute('href') : null,
    robotsMeta:       robotsMeta ? robotsMeta.getAttribute('content') : null,
    isHttps:          location.protocol === 'https:',
    imagesTotal,
    imagesNoAlt
  };

  // ── Headings structure ──────────────────────────────────────────────────
  const headings = {};
  ['h1','h2','h3','h4','h5','h6'].forEach(tag => {
    headings[tag] = document.querySelectorAll(tag).length;
  });

  // ── Scripts ─────────────────────────────────────────────────────────────
  const scripts = [...document.querySelectorAll('script')];
  const scriptStats = {
    total:    scripts.length,
    external: scripts.filter(s => s.src).length,
    inline:   scripts.filter(s => !s.src).length,
    defer:    scripts.filter(s => s.defer).length,
    async:    scripts.filter(s => s.async).length
  };

  // ── Stylesheets ─────────────────────────────────────────────────────────
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
  const styleStats = {
    external: links.length,
    inline:   document.querySelectorAll('style').length
  };

  // ── Images detail ───────────────────────────────────────────────────────
  const imageDetails = images.slice(0, 50).map(img => ({
    src:         img.currentSrc || img.src,
    alt:         img.alt,
    hasAlt:      !!(img.alt && img.alt.trim()),
    lazy:        img.loading === 'lazy',
    naturalW:    img.naturalWidth,
    naturalH:    img.naturalHeight,
    renderedW:   img.width,
    renderedH:   img.height,
    oversized:   img.naturalWidth > img.width * 2 && img.naturalWidth > 200
  }));

  // ── Accessibility ────────────────────────────────────────────────────────
  const inputs = [...document.querySelectorAll('input, textarea, select')];
  const unlabeledInputs = inputs.filter(el => {
    const id = el.id;
    const label = id ? document.querySelector(`label[for="${id}"]`) : null;
    const ariaLabel = el.getAttribute('aria-label');
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    return !label && !ariaLabel && !ariaLabelledBy && el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button';
  }).length;

  const emptyButtons = [...document.querySelectorAll('button, a')].filter(el => {
    return !el.textContent.trim() && !el.getAttribute('aria-label') && !el.title;
  }).length;

  const a11y = {
    imagesNoAlt,
    unlabeledInputs,
    emptyButtons,
    headings
  };

  // ── Mixed content ────────────────────────────────────────────────────────
  let mixedContent = 0;
  if (location.protocol === 'https:') {
    document.querySelectorAll('img[src], script[src], link[href]').forEach(el => {
      const url = el.src || el.href;
      if (url && url.startsWith('http:')) mixedContent++;
    });
  }

  // ── Resources from PerformanceResourceTiming ─────────────────────────────
  const resources = performance.getEntriesByType('resource').map(r => ({
    name:         r.name,
    type:         r.initiatorType,
    duration:     Math.round(r.duration),
    transferSize: r.transferSize,
    encodedSize:  r.encodedBodySize
  }));

  const totalTransferKB = Math.round(resources.reduce((sum, r) => sum + (r.transferSize || 0), 0) / 1024);
  const totalRequests   = resources.length;

  return {
    url:      location.href,
    title:    document.title,
    timing,
    seo,
    a11y,
    scripts:  scriptStats,
    styles:   styleStats,
    images:   imageDetails,
    headings,
    resources: {
      total:      totalRequests,
      transferKB: totalTransferKB,
      items:      resources.slice(0, 100)
    },
    mixedContent,
    viewport: !!viewport,
    userAgent: navigator.userAgent,
    timestamp: Date.now()
  };
}
