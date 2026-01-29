/**
 * core/config.js - Configuration management utilities
 *
 * Reads and writes .env settings and sites/*.json config files.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const SITES_DIR = path.join(ROOT, "sites");

// -- .env management ---------------------------------------------------------

/**
 * Parses the .env file and returns all key-value pairs as an object.
 * Strips surrounding quotes from values.
 * @returns {Object<string, string>}
 */
function readEnvConfig() {
  const content = fs.readFileSync(ENV_PATH, "utf8");
  const config = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    config[key] = val;
  }
  return config;
}

/**
 * Writes a config object back to the .env file.
 * Preserves the key order from the existing file where possible.
 * @param {Object<string, string>} config
 */
function writeEnvConfig(config) {
  const lines = [];
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const written = new Set();

  // Preserve existing structure (comments, blank lines, key order)
  for (const line of existing.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      lines.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      lines.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (key in config) {
      const val = config[key];
      // Quote values that contain spaces or are strings
      const needsQuotes = /\s/.test(val) || !/^(true|false|\d+)$/.test(val);
      lines.push(needsQuotes ? `${key}="${val}"` : `${key}=${val}`);
      written.add(key);
    } else {
      lines.push(line);
    }
  }

  // Append any new keys not in the original file
  for (const [key, val] of Object.entries(config)) {
    if (!written.has(key)) {
      const needsQuotes = /\s/.test(val) || !/^(true|false|\d+)$/.test(val);
      lines.push(needsQuotes ? `${key}="${val}"` : `${key}=${val}`);
    }
  }

  fs.writeFileSync(ENV_PATH, lines.join("\n"), "utf8");
}

// -- Sites management --------------------------------------------------------

/**
 * Lists all available site config names (without .json extension).
 * @returns {string[]}
 */
function listSites() {
  if (!fs.existsSync(SITES_DIR)) return [];
  return fs
    .readdirSync(SITES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}

/**
 * Reads and parses a site config file.
 * @param {string} name - Site config name (without .json)
 * @returns {Object} Parsed site config
 */
function readSite(name) {
  const filePath = path.join(SITES_DIR, `${name}.json`);
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

/**
 * Saves a site config to disk.
 * @param {string} name - Site config name (without .json)
 * @param {Object} data - Site config data
 */
function writeSite(name, data) {
  if (!fs.existsSync(SITES_DIR)) fs.mkdirSync(SITES_DIR, { recursive: true });
  const filePath = path.join(SITES_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Deletes a site config file.
 * @param {string} name - Site config name (without .json)
 * @returns {boolean} True if deleted
 */
function deleteSite(name) {
  const filePath = path.join(SITES_DIR, `${name}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Validates a site config structure.
 * @param {*} data - Data to validate
 * @returns {{valid: boolean, error?: string}}
 */
function validateSiteConfig(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return { valid: false, error: "Config must be a non-empty array" };
  }
  const site = data[0];
  if (!site.config || typeof site.config !== "object") {
    return { valid: false, error: "Missing 'config' object" };
  }
  const required = ["PRODUCTION_URL", "STAGING_URL"];
  for (const key of required) {
    if (!site.config[key]) {
      return { valid: false, error: `Missing required config field: ${key}` };
    }
  }
  if (!Array.isArray(site.pages)) {
    return { valid: false, error: "Missing 'pages' array" };
  }
  for (let i = 0; i < site.pages.length; i++) {
    const p = site.pages[i];
    if (!p.id || !p.url) {
      return { valid: false, error: `Page at index ${i} missing 'id' or 'url'` };
    }
  }
  return { valid: true };
}

/**
 * Builds a runtime config object from .env and a site config.
 * Used by core modules to avoid reading globals.
 * @param {string} [siteName] - Override template name (defaults to .env TEMPLATE)
 * @returns {Object} Merged config
 */
function buildRuntimeConfig(siteName) {
  const env = readEnvConfig();
  const template = siteName || env.TEMPLATE;
  const siteData = readSite(template);
  const siteConfig = siteData[0].config;
  const pages = siteData[0].pages;

  const outputDir = env.COMPFILE || "html_cmp";

  return {
    template,
    productionUrl: siteConfig.PRODUCTION_URL,
    stagingUrl: siteConfig.STAGING_URL,
    cookieProduction: siteConfig.COOKIE_PRODUCTION || "",
    cookieStaging: siteConfig.COOKIE_STAGING || "",
    cookieName: siteConfig.COOKIE_ONE || "",
    cookieValue: siteConfig.COOKIEVALUE || "displayed",
    isCookieSet: siteConfig.ISCOOKIESET === "true",
    pages,
    outputDir,
    imagesDir: env.IMAGES_FOLDER || path.join(outputDir, "images"),
    timeout: parseInt(env.TIMEOUT) || 60000,
    viewports: {
      desktop: {
        width: parseInt(env.DESKTOP_WIDTH) || 1440,
        height: parseInt(env.DESKTOP_HEIGHT) || 1080,
      },
      mobile: {
        width: parseInt(env.MOBILE_WIDTH) || 360,
        height: parseInt(env.MOBILE_HEIGHT) || 640,
      },
    },
    enableDesktop: env.DESKTOP === "true",
    enableMobile: env.MOBILE === "true",
    pixelmatchThreshold: 0.1,
  };
}

module.exports = {
  readEnvConfig,
  writeEnvConfig,
  listSites,
  readSite,
  writeSite,
  deleteSite,
  validateSiteConfig,
  buildRuntimeConfig,
  ROOT,
  SITES_DIR,
};
