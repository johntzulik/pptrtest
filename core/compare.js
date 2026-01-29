/**
 * core/compare.js - Image comparison module
 *
 * Compares production vs staging screenshots using pixelmatch
 * and generates diff images highlighting the differences.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { PNG } = require("pngjs");

const { getPageName, buildFileName } = require("./capture");

/**
 * Reads a PNG file from disk and returns the parsed PNG object.
 * @param {string} filePath
 * @returns {Promise<PNG>}
 */
async function readPNG(filePath) {
  const buffer = await fsp.readFile(filePath);
  return new Promise((resolve, reject) => {
    const img = new PNG();
    img.parse(buffer, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/**
 * Compares production and staging images for all pages of a given device.
 * Generates a diff image where changed pixels are highlighted in red.
 *
 * When images have different sizes, both are normalized to the maximum
 * size by padding with transparency.
 *
 * @param {"desktop"|"mobile"} device
 * @param {Object} config - Runtime config from buildRuntimeConfig()
 * @param {Function} pixelmatch - The pixelmatch function (loaded dynamically)
 * @param {Function} [onProgress] - Optional callback: onProgress(level, message)
 * @returns {Promise<Object[]>} Array of comparison results
 */
async function compareScreenshots(device, config, pixelmatch, onProgress) {
  const log = onProgress || (() => {});
  const results = [];

  for (const { id, url } of config.pages) {
    const name = getPageName(url);
    const prodFileName = `${buildFileName(id, "prod", device, name)}.png`;
    const stagingFileName = `${buildFileName(id, "staging", device, name)}.png`;
    const diffFileName = `${buildFileName(id, "diff", device, name)}.png`;

    const prodPath = path.join(config.imagesDir, prodFileName);
    const stagingPath = path.join(config.imagesDir, stagingFileName);
    const diffPath = path.join(config.imagesDir, diffFileName);

    try {
      const [imgProd, imgStaging] = await Promise.all([
        readPNG(prodPath),
        readPNG(stagingPath),
      ]);

      // Normalize to the larger size if they differ
      const width = Math.max(imgProd.width, imgStaging.width);
      const height = Math.max(imgProd.height, imgStaging.height);

      const normalize = (img) => {
        if (img.width === width && img.height === height) return img.data;
        const normalized = new PNG({ width, height });
        normalized.data.fill(0);
        PNG.bitblt(img, normalized, 0, 0, img.width, img.height, 0, 0);
        return normalized.data;
      };

      const prodData = normalize(imgProd);
      const stagingData = normalize(imgStaging);
      const diffImage = new PNG({ width, height });

      const diffPixels = pixelmatch(
        prodData,
        stagingData,
        diffImage.data,
        width,
        height,
        { threshold: config.pixelmatchThreshold, alpha: 0.3 }
      );

      const totalPixels = width * height;
      const mismatchPercentage = (diffPixels / totalPixels) * 100;

      // Save diff image
      const diffBuffer = PNG.sync.write(diffImage);
      await fsp.writeFile(diffPath, diffBuffer);

      const result = {
        id,
        url,
        name,
        device,
        mismatchPercentage: Math.round(mismatchPercentage * 100) / 100,
        totalPixels,
        diffPixels,
        prodFile: prodPath,
        stagingFile: stagingPath,
        diffFile: diffPath,
        success: true,
      };

      results.push(result);

      const label =
        mismatchPercentage === 0
          ? "IDENTICAL"
          : mismatchPercentage < 1
          ? "MINOR"
          : "CHANGED";
      log(
        mismatchPercentage === 0 ? "success" : "warn",
        `[diff][${device}] ${name}: ${result.mismatchPercentage}% (${label})`
      );
    } catch (err) {
      log("error", `[diff][${device}] ${name}: ${err.message}`);
      results.push({
        id,
        url,
        name,
        device,
        mismatchPercentage: -1,
        totalPixels: 0,
        diffPixels: 0,
        prodFile: prodPath,
        stagingFile: stagingPath,
        diffFile: diffPath,
        success: false,
        error: err.message,
      });
    }
  }

  return results;
}

module.exports = { compareScreenshots };
