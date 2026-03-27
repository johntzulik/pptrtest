/**
 * pixelmatch — browser-compatible pixel-level image comparison
 * Adapted from https://github.com/mapbox/pixelmatch (ISC License)
 *
 * @param {Uint8ClampedArray} img1   RGBA pixel data (prod)
 * @param {Uint8ClampedArray} img2   RGBA pixel data (staging)
 * @param {Uint8ClampedArray|null} output  RGBA pixel data to write diff into (or null)
 * @param {number} width
 * @param {number} height
 * @param {object} options
 * @param {number} [options.threshold=0.1]   Color similarity threshold (0–1)
 * @param {boolean} [options.includeAA=false] Count anti-aliased pixels as different
 * @returns {number} Number of different pixels
 */
export function pixelmatch(img1, img2, output, width, height, options = {}) {
  const threshold = options.threshold !== undefined ? options.threshold : 0.1;
  const includeAA = options.includeAA || false;

  // Max color delta for the given threshold (YIQ color space)
  const maxDelta = 35215 * threshold * threshold;

  let diff = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = (y * width + x) * 4;

      const r1 = img1[pos],     g1 = img1[pos+1], b1 = img1[pos+2], a1 = img1[pos+3];
      const r2 = img2[pos],     g2 = img2[pos+1], b2 = img2[pos+2], a2 = img2[pos+3];

      // Blend with white background if transparent
      const alpha1 = a1 / 255;
      const alpha2 = a2 / 255;
      const br1 = blend(r1, alpha1), bg1 = blend(g1, alpha1), bb1 = blend(b1, alpha1);
      const br2 = blend(r2, alpha2), bg2 = blend(g2, alpha2), bb2 = blend(b2, alpha2);

      const delta = colorDelta(br1, bg1, bb1, br2, bg2, bb2);

      if (delta > maxDelta) {
        // Check for anti-aliasing
        if (!includeAA && (isAntiAliased(img1, x, y, width, height, img2) ||
                           isAntiAliased(img2, x, y, width, height, img1))) {
          if (output) drawPixel(output, pos, 255, 255, 0); // yellow = AA
        } else {
          if (output) drawPixel(output, pos, 255, 0, 0); // red = changed
          diff++;
        }
      } else {
        // Similar pixels — draw as dimmed grayscale
        if (output) {
          const gray = Math.round(toGray(br1, bg1, bb1) * 0.1 + 230);
          drawPixel(output, pos, gray, gray, gray);
        }
      }
    }
  }

  return diff;
}

function blend(channel, alpha) {
  return 255 + (channel - 255) * alpha;
}

function colorDelta(r1, g1, b1, r2, g2, b2) {
  const y1 = toGray(r1, g1, b1);
  const y2 = toGray(r2, g2, b2);
  const dy = y1 - y2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return 0.5053 * dr*dr + 0.3720 * dg*dg + 0.1223 * db*db - 0.0990 * dy*dy;
}

function toGray(r, g, b) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function drawPixel(output, pos, r, g, b) {
  output[pos]   = r;
  output[pos+1] = g;
  output[pos+2] = b;
  output[pos+3] = 255;
}

function isAntiAliased(img, x, y, width, height, img2) {
  const x1 = Math.max(x - 1, 0), y1 = Math.max(y - 1, 0);
  const x2 = Math.min(x + 1, width - 1), y2 = Math.min(y + 1, height - 1);
  let zeroes = x === x1 || x === x2 || y === y1 || y === y2 ? 1 : 0;
  let min = 0, max = 0, minX, minY, maxX, maxY;

  const pos0 = (y * width + x) * 4;
  const g0 = toGray(img[pos0], img[pos0+1], img[pos0+2]);

  for (let xi = x1; xi <= x2; xi++) {
    for (let yi = y1; yi <= y2; yi++) {
      if (xi === x && yi === y) continue;
      const pos = (yi * width + xi) * 4;
      const g = toGray(img[pos], img[pos+1], img[pos+2]);
      const delta = g - g0;
      if (delta === 0) { zeroes++; if (zeroes > 2) return false; }
      else if (delta < min) { min = delta; minX = xi; minY = yi; }
      else if (delta > max) { max = delta; maxX = xi; maxY = yi; }
    }
  }

  if (min === 0 || max === 0) return false;

  return (hasColorDiff(img, img2, minX, minY, width) || hasColorDiff(img, img2, maxX, maxY, width));
}

function hasColorDiff(img1, img2, x, y, width) {
  const pos = (y * width + x) * 4;
  return colorDelta(img1[pos], img1[pos+1], img1[pos+2], img2[pos], img2[pos+1], img2[pos+2]) > 0;
}
