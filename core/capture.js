/**
 * core/capture.js - Screenshot capture module
 *
 * Captures full-page screenshots for all pages of a given
 * environment (production or staging) and device type.
 */

const path = require("path");

/**
 * Generates a readable name from a page URL path.
 * @param {string} url
 * @returns {string}
 */
function getPageName(url) {
  const segments = url.split("/").filter(Boolean);
  return segments.length === 0 ? "homepage" : segments.join("_");
}

/**
 * Builds the filename for a screenshot (without extension).
 * @param {string} id
 * @param {string} phase
 * @param {string} device
 * @param {string} name
 * @returns {string}
 */
function buildFileName(id, phase, device, name) {
  return `${id}-${phase}-${device}-${name}`;
}

/**
 * Captures screenshots of all pages for a given environment and device.
 *
 * @param {import('puppeteer').Browser} browser - Puppeteer browser instance
 * @param {"prod"|"staging"} phase - Environment to capture
 * @param {"desktop"|"mobile"} device - Device type
 * @param {Object} config - Runtime config from buildRuntimeConfig()
 * @param {Function} [onProgress] - Optional callback: onProgress(level, message)
 * @returns {Promise<string[]>} Paths of captured images
 */
async function captureScreenshots(browser, phase, device, config, onProgress) {
  const log = onProgress || (() => {});
  const baseUrl = phase === "prod" ? config.productionUrl : config.stagingUrl;
  const cookieDomain = phase === "prod" ? config.cookieProduction : config.cookieStaging;
  const viewport = config.viewports[device];
  const capturedFiles = [];

  const page = await browser.newPage();

  // Set cookie if configured
  if (config.isCookieSet && config.cookieName) {
    log("success ", `Setting cookie ${config.cookieName}=${config.cookieValue} for domain ${cookieDomain}`);
    await page.setCookie({
      name: config.cookieName,
      value: config.cookieValue,
      domain: cookieDomain,
    });
  }

  await page.setDefaultNavigationTimeout(config.timeout);
  await page.setViewport({ width: viewport.width, height: viewport.height });

  for (const { id, url } of config.pages) {
    const name = getPageName(url);
    const fileName = `${buildFileName(id, phase, device, name)}.png`;
    const filePath = path.join(config.imagesDir, fileName);

    try {
      await page.goto(`${baseUrl}${url}`, { waitUntil: "networkidle2" });

      // Wait for animations and lazy-loaded content to settle
      await new Promise((r) => setTimeout(r, 1500));

      await page.screenshot({ path: filePath, fullPage: true });
      capturedFiles.push(filePath);
      log("success", `[${phase}][${device}] ${name} -> ${fileName}`);
    } catch (err) {
      log("error", `[${phase}][${device}] ${name} -> ${err.message}`);
    }
  }

  await page.close();
  return capturedFiles;
}

module.exports = { captureScreenshots, getPageName, buildFileName };
