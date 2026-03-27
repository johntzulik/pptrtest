/**
 * routes/crawler.js - Site page discovery via link crawling
 *
 * POST /api/crawler — crawl a URL to discover same-origin page paths
 * body: { url: "https://example.com", maxPages: 100 }
 */

const express   = require("express");
const puppeteer = require("puppeteer");

const router = express.Router();

router.post("/", async (req, res) => {
  const { url, maxPages = 100 } = req.body;
  if (!url) return res.status(400).json({ error: "Missing url" });

  let browser;
  try {
    const baseUrl = new URL(url);
    const origin  = baseUrl.origin;

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(30000);
    await page.setUserAgent(
      "Mozilla/5.0 (compatible; BrowserCompare-Crawler/1.0)"
    );

    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Collect all same-origin hrefs
    const links = await page.evaluate((origin) => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const paths   = new Set();
      paths.add("/"); // always include homepage
      for (const a of anchors) {
        try {
          const u = new URL(a.href, location.href);
          if (u.origin === origin) {
            let p = u.pathname;
            if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1); // normalize trailing slash
            paths.add(p);
          }
        } catch (_) {}
      }
      return Array.from(paths).sort();
    }, origin);

    await page.close();
    await browser.close();
    browser = null;

    // Filter out static asset extensions
    const filtered = links.filter(p =>
      !p.match(/\.(pdf|jpg|jpeg|png|gif|webp|avif|svg|css|js|ico|xml|txt|zip|mp4|mp3|woff2?|ttf|eot|map)$/i)
    ).slice(0, maxPages);

    res.json({ origin, pages: filtered });

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
