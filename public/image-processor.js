/**
 * Catalog Image Processor
 * Handles bounding-box alpha trimming, aspect-ratio scaling, and centering
 * onto a standardized white square canvas (default 1000x1000 px).
 */

export class CatalogImageProcessor {
  /**
   * Load any Image source (File, Blob, or URL) into an HTMLImageElement
   * @param {File|Blob|string} source
   * @returns {Promise<HTMLImageElement>}
   */
  static loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      const url = source instanceof Blob ? URL.createObjectURL(source) : source;

      img.onload = () => {
        if (source instanceof Blob) {
          // Keep object URL active or clean up if needed
        }
        resolve(img);
      };

      img.onerror = (err) => {
        reject(new Error(`Failed to load image: ${err?.message || 'Unknown error'}`));
      };

      img.src = url;
    });
  }

  /**
   * Scans pixel alpha values to detect the tight bounding box around the subject,
   * eliminating redundant transparent margins.
   * @param {HTMLImageElement|HTMLCanvasElement} img
   * @param {number} alphaThreshold - Alpha cutoff (0-255), defaults to 15
   * @returns {{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number}}
   */
  static getAlphaBoundingBox(img, alphaThreshold = 15) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const alpha = data[(y * w + x) * 4 + 3];
        if (alpha > alphaThreshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // If completely transparent or no pixels met threshold, return full bounds
    if (maxX === -1) {
      return { minX: 0, minY: 0, maxX: w, maxY: h, width: w, height: h };
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };
  }

  /**
   * Extends the image borders by clamping the outer pixel edges into a padded margin.
   * This provides neural segmentation models with necessary negative space around
   * full-bleed and edge-touching products (e.g. pouches, snack bars, cartons).
   * @param {HTMLImageElement|HTMLCanvasElement} img
   * @param {number} padRatio - Margin fraction (e.g. 0.15 for 15% on each edge)
   * @returns {Promise<{paddedCanvas: HTMLCanvasElement, paddedBlob: Blob, padX: number, padY: number, originalWidth: number, originalHeight: number}>}
   */
  static preparePaddedImage(img, padRatio = 0.15) {
    return new Promise((resolve, reject) => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;

        const padX = Math.round(w * padRatio);
        const padY = Math.round(h * padRatio);
        const paddedW = w + 2 * padX;
        const paddedH = h + 2 * padY;

        const canvas = document.createElement('canvas');
        canvas.width = paddedW;
        canvas.height = paddedH;
        const ctx = canvas.getContext('2d');

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // 1. Edge clamping: stretch outermost pixels into the padded margins
        // Top edge strip
        ctx.drawImage(img, 0, 0, w, 1, padX, 0, w, padY);
        // Bottom edge strip
        ctx.drawImage(img, 0, h - 1, w, 1, padX, padY + h, w, padY);
        // Left edge strip
        ctx.drawImage(img, 0, 0, 1, h, 0, padY, padX, h);
        // Right edge strip
        ctx.drawImage(img, w - 1, 0, 1, h, padX + w, padY, padX, h);

        // 4 Corners
        ctx.drawImage(img, 0, 0, 1, 1, 0, 0, padX, padY);
        ctx.drawImage(img, w - 1, 0, 1, 1, padX + w, 0, padX, padY);
        ctx.drawImage(img, 0, h - 1, 1, 1, 0, padY + h, padX, padY);
        ctx.drawImage(img, w - 1, h - 1, 1, 1, padX + w, padY + h, padX, padY);

        // 2. Draw original image centered
        ctx.drawImage(img, 0, 0, w, h, padX, padY, w, h);

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to create padded blob'));
            return;
          }
          resolve({
            paddedCanvas: canvas,
            paddedBlob: blob,
            padX,
            padY,
            originalWidth: w,
            originalHeight: h
          });
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Crops the central region from a padded cutout back to exact original coordinates.
   * @param {HTMLImageElement|HTMLCanvasElement|Blob} cutoutSource
   * @param {number} padX
   * @param {number} padY
   * @param {number} origW
   * @param {number} origH
   * @returns {Promise<{blob: Blob, canvas: HTMLCanvasElement}>}
   */
  static async cropFromPaddedCutout(cutoutSource, padX, padY, origW, origH) {
    const img = cutoutSource instanceof HTMLImageElement || cutoutSource instanceof HTMLCanvasElement
      ? cutoutSource
      : await this.loadImage(cutoutSource);

    const canvas = document.createElement('canvas');
    canvas.width = origW;
    canvas.height = origH;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, padX, padY, origW, origH, 0, 0, origW, origH);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to crop cutout'));
          return;
        }
        resolve({ blob, canvas });
      }, 'image/png');
    });
  }

  /**
   * Solidifies the product mask and restores original RGB colors from the source photo.
   * Consumer products (boxes, pouches, bottles) are physically 100% opaque.
   * Neural background removal often assigns semi-transparent alpha (0.2-0.5) to packaging
   * faces (such as the purple sides of a carton), causing the colors to look faded or bleached on white.
   * This method restores 100% opacity and uses the exact original RGB pixels.
   * @param {HTMLImageElement|HTMLCanvasElement|Blob} cutoutSource - Transparent cutout from AI
   * @param {HTMLImageElement|HTMLCanvasElement|Blob} originalSource - Original untouched photo
   * @param {Object} options
   * @param {number} [options.alphaThreshold=25] - Cutoff to consider foreground (0-255)
   * @returns {Promise<{blob: Blob, canvas: HTMLCanvasElement, dataUrl: string}>}
   */
  static async solidifyProductMask(cutoutSource, originalSource, options = {}) {
    const { alphaThreshold = 25 } = options;

    const cutoutImg = cutoutSource instanceof HTMLImageElement || cutoutSource instanceof HTMLCanvasElement
      ? cutoutSource
      : await this.loadImage(cutoutSource);

    const origImg = originalSource instanceof HTMLImageElement || originalSource instanceof HTMLCanvasElement
      ? originalSource
      : await this.loadImage(originalSource);

    const w = origImg.naturalWidth || origImg.width;
    const h = origImg.naturalHeight || origImg.height;

    // 1. Draw original uncompressed image to read true RGB colors
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(origImg, 0, 0, w, h);
    const origData = ctx.getImageData(0, 0, w, h);

    // 2. Draw cutout to read AI alpha values
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    maskCtx.drawImage(cutoutImg, 0, 0, w, h);
    const maskData = maskCtx.getImageData(0, 0, w, h);

    const srcPixels = origData.data;
    const maskPixels = maskData.data;

    // 3. Solidify product pixels: clamp alpha to 255 for all foreground packaging pixels
    for (let i = 0; i < srcPixels.length; i += 4) {
      const maskA = maskPixels[i + 3];

      if (maskA >= alphaThreshold) {
        // Foreground packaging pixel: 100% opaque, 100% original color
        srcPixels[i + 3] = 255;
      } else {
        // Background: 100% transparent
        srcPixels[i + 3] = 0;
      }
    }

    ctx.putImageData(origData, 0, 0);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to export solidified blob'));
          return;
        }
        resolve({
          blob,
          canvas,
          dataUrl: canvas.toDataURL('image/png')
        });
      }, 'image/png');
    });
  }
  /**
   * Automatically heals concave bites, jagged dips, and holes along product borders.
   * Useful when AI mistakenly carves into packaging edges (like snack bars, cartons, boxes).
   * Computes the upper and lower outer envelopes across the active span, bridging any dips,
   * and copies 100% original RGB pixels from the source photo.
   * @param {HTMLImageElement|HTMLCanvasElement|Blob} cutoutSource
   * @param {HTMLImageElement|HTMLCanvasElement|Blob} originalSource
   * @param {Object} options
   * @param {number} [options.alphaThreshold=15]
   * @param {boolean} [options.boxSnap=false] - When true, snaps completely to bounding rectangle
   * @returns {Promise<{blob: Blob, canvas: HTMLCanvasElement, dataUrl: string}>}
   */
  static async healMaskBorders(cutoutSource, originalSource, options = {}) {
    const { alphaThreshold = 15, boxSnap = false } = options;

    const cutoutImg = cutoutSource instanceof HTMLImageElement || cutoutSource instanceof HTMLCanvasElement
      ? cutoutSource
      : await this.loadImage(cutoutSource);

    const origImg = originalSource instanceof HTMLImageElement || originalSource instanceof HTMLCanvasElement
      ? originalSource
      : await this.loadImage(originalSource);

    const w = origImg.naturalWidth || origImg.width;
    const h = origImg.naturalHeight || origImg.height;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(origImg, 0, 0, w, h);
    const origData = ctx.getImageData(0, 0, w, h);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    maskCtx.drawImage(cutoutImg, 0, 0, w, h);
    const maskData = maskCtx.getImageData(0, 0, w, h);

    const src = origData.data;
    const mask = maskData.data;

    if (boxSnap) {
      // 1. Find overall bounding box of any detected product pixels
      const bbox = this.getAlphaBoundingBox(maskCanvas, alphaThreshold);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          if (x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY) {
            src[idx + 3] = 255;
          } else {
            src[idx + 3] = 0;
          }
        }
      }
    } else {
      // 2. Column-wise envelope closing (Upper and lower hulls)
      const topEdge = new Int32Array(w).fill(-1);
      const botEdge = new Int32Array(w).fill(-1);

      let firstX = w;
      let lastX = -1;

      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          if (mask[(y * w + x) * 4 + 3] > alphaThreshold) {
            if (topEdge[x] === -1) topEdge[x] = y;
            botEdge[x] = y;
            if (x < firstX) firstX = x;
            if (x > lastX) lastX = x;
          }
        }
      }

      if (firstX <= lastX) {
        // Heal concave bites in top edge: rolling envelope interpolation
        const healedTop = new Int32Array(w).fill(-1);
        const healedBot = new Int32Array(w).fill(-1);

        for (let x = firstX; x <= lastX; x++) {
          healedTop[x] = topEdge[x];
          healedBot[x] = botEdge[x];
        }

        // Bridge gaps and concave dips across columns
        let prevValidX = -1;
        for (let x = firstX; x <= lastX; x++) {
          if (topEdge[x] !== -1) {
            if (prevValidX !== -1 && x - prevValidX > 1) {
              const y1 = topEdge[prevValidX];
              const y2 = topEdge[x];
              for (let k = prevValidX + 1; k < x; k++) {
                const interpY = Math.round(y1 + ((y2 - y1) * (k - prevValidX)) / (x - prevValidX));
                healedTop[k] = interpY;
              }
            }
            prevValidX = x;
          }
        }

        prevValidX = -1;
        for (let x = firstX; x <= lastX; x++) {
          if (botEdge[x] !== -1) {
            if (prevValidX !== -1 && x - prevValidX > 1) {
              const y1 = botEdge[prevValidX];
              const y2 = botEdge[x];
              for (let k = prevValidX + 1; k < x; k++) {
                const interpY = Math.round(y1 + ((y2 - y1) * (k - prevValidX)) / (x - prevValidX));
                healedBot[k] = interpY;
              }
            }
            prevValidX = x;
          }
        }

        // Convex upper envelope pass: bridge sharp downward bite drops along top border
        for (let pass = 0; pass < 5; pass++) {
          for (let x = firstX + 1; x < lastX; x++) {
            if (healedTop[x] !== -1 && healedTop[x - 1] !== -1 && healedTop[x + 1] !== -1) {
              const minNeighbor = Math.min(healedTop[x - 1], healedTop[x + 1]);
              if (healedTop[x] > minNeighbor + 4) {
                healedTop[x] = minNeighbor;
              }
            }
            if (healedBot[x] !== -1 && healedBot[x - 1] !== -1 && healedBot[x + 1] !== -1) {
              const maxNeighbor = Math.max(healedBot[x - 1], healedBot[x + 1]);
              if (healedBot[x] < maxNeighbor - 4) {
                healedBot[x] = maxNeighbor;
              }
            }
          }
        }

        // Write healed mask to src
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            if (x >= firstX && x <= lastX && healedTop[x] !== -1 && healedBot[x] !== -1 && y >= healedTop[x] && y <= healedBot[x]) {
              src[idx + 3] = 255;
            } else {
              src[idx + 3] = 0;
            }
          }
        }
      }
    }

    ctx.putImageData(origData, 0, 0);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to export healed blob'));
          return;
        }
        resolve({
          blob,
          canvas,
          dataUrl: canvas.toDataURL('image/png')
        });
      }, 'image/png');
    });
  }

  /**
   * Crops a specified rectangular region from the original photo and centers it on a square canvas.
   * Perfect for rectangular product boxes (like cartons, cereal, multi-packs).
   * @param {HTMLImageElement|HTMLCanvasElement|Blob} originalSource
   * @param {{x: number, y: number, width: number, height: number}} cropRect
   * @param {Object} options
   * @returns {Promise<{blob: Blob, dataUrl: string, canvas: HTMLCanvasElement}>}
   */
  static async cropBoxToSquare(originalSource, cropRect, options = {}) {
    const {
      targetSize = 1000,
      paddingPercent = 10,
      backgroundColor = '#FFFFFF',
      format = 'image/jpeg',
      quality = 0.92
    } = options;

    const img = originalSource instanceof HTMLImageElement || originalSource instanceof HTMLCanvasElement
      ? originalSource
      : await this.loadImage(originalSource);

    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    // Sanitize crop bounds
    const rx = Math.max(0, Math.min(origW - 1, Math.round(cropRect.x)));
    const ry = Math.max(0, Math.min(origH - 1, Math.round(cropRect.y)));
    const rw = Math.max(1, Math.min(origW - rx, Math.round(cropRect.width)));
    const rh = Math.max(1, Math.min(origH - ry, Math.round(cropRect.height)));

    // Create intermediate cropped canvas
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = rw;
    cropCanvas.height = rh;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh);

    // Center on standardized target square canvas
    return this.centerOnSquare(cropCanvas, {
      targetSize,
      paddingPercent,
      backgroundColor,
      format,
      quality,
      isFullFrame: true
    });
  }

  /**
   * Applies an interactive brush stroke on a cutout mask.
   * 'restore': paints back original image pixels.
   * 'erase': erases pixels to transparent.
   * @param {HTMLCanvasElement} currentCanvas
   * @param {HTMLImageElement|HTMLCanvasElement} origImg
   * @param {number} x
   * @param {number} y
   * @param {'restore'|'erase'} mode
   * @param {number} radius
   * @returns {Promise<{blob: Blob, canvas: HTMLCanvasElement, dataUrl: string}>}
   */
  static async applyBrush(currentCanvas, origImg, x, y, mode = 'restore', radius = 24) {
    const w = currentCanvas.width;
    const h = currentCanvas.height;
    const ctx = currentCanvas.getContext('2d', { willReadFrequently: true });

    if (mode === 'erase') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Restore from original image
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(origImg, 0, 0, w, h);
      ctx.restore();
    }

    return new Promise((resolve, reject) => {
      currentCanvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to export brush canvas'));
          return;
        }
        resolve({
          blob,
          canvas: currentCanvas,
          dataUrl: currentCanvas.toDataURL('image/png')
        });
      }, 'image/png');
    });
  }

  /**
   * Fast flood-fill chroma/color-key background removal for flat studio banners
   * (e.g. solid orange or purple marketing graphics matching product brand).
   * Floods from outer corners inward, stopping at the product edges.
   * @param {HTMLImageElement|HTMLCanvasElement|Blob} source
   * @param {Object} options
   * @param {number} [options.tolerance=34] - Color distance threshold (0-150)
   * @param {Array<{x: number, y: number}>} [options.seeds] - Seed points to flood from
   * @param {{r: number, g: number, b: number}} [options.targetColor] - Specific color to erase
   * @returns {Promise<{blob: Blob, canvas: HTMLCanvasElement, dataUrl: string}>}
   */
  static async removeChromaBackground(source, options = {}) {
    const {
      tolerance = 34,
      seeds = null,
      targetColor = null
    } = options;

    const img = source instanceof HTMLImageElement || source instanceof HTMLCanvasElement
      ? source
      : await this.loadImage(source);

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Default seed points: 4 outer corners + middle top/bottom
    const defaultSeeds = [
      { x: 0, y: 0 },
      { x: w - 1, y: 0 },
      { x: 0, y: h - 1 },
      { x: w - 1, y: h - 1 },
      { x: Math.floor(w / 2), y: 0 },
      { x: Math.floor(w / 2), y: h - 1 }
    ];

    const floodSeeds = seeds && seeds.length > 0 ? seeds : defaultSeeds;
    const visited = new Uint8Array(w * h);

    // Queue for BFS flood fill
    const queue = [];

    // Helper to test if a pixel matches target color within tolerance
    const colorDist = (r1, g1, b1, r2, g2, b2) => {
      const dr = r1 - r2;
      const dg = g1 - g2;
      const db = b1 - b2;
      // Perceptually weighted Euclidean color distance
      return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
    };

    // Initialize seeds
    for (const seed of floodSeeds) {
      const sx = Math.max(0, Math.min(w - 1, Math.round(seed.x)));
      const sy = Math.max(0, Math.min(h - 1, Math.round(seed.y)));
      const idx = sy * w + sx;

      if (!visited[idx]) {
        const pR = data[idx * 4];
        const pG = data[idx * 4 + 1];
        const pB = data[idx * 4 + 2];
        const pA = data[idx * 4 + 3];

        if (pA > 20) {
          const refColor = targetColor || { r: pR, g: pG, b: pB };
          const dist = colorDist(pR, pG, pB, refColor.r, refColor.g, refColor.b);

          if (dist <= tolerance * 2.2) {
            queue.push({ x: sx, y: sy, ref: refColor });
            visited[idx] = 1;
          }
        }
      }
    }

    // BFS Flood Fill
    let head = 0;
    while (head < queue.length) {
      const { x, y, ref } = queue[head++];
      const idx = y * w + x;
      const pIdx = idx * 4;

      const pR = data[pIdx];
      const pG = data[pIdx + 1];
      const pB = data[pIdx + 2];
      const dist = colorDist(pR, pG, pB, ref.r, ref.g, ref.b);

      const maxDist = tolerance * 2.2;
      if (dist <= maxDist) {
        // Feather alpha slightly near threshold boundary
        if (dist > maxDist * 0.8) {
          const factor = (dist - maxDist * 0.8) / (maxDist * 0.2);
          data[pIdx + 3] = Math.round(data[pIdx + 3] * factor);
        } else {
          data[pIdx + 3] = 0;
        }

        // Check 4-connected neighbors
        const neighbors = [
          { nx: x + 1, ny: y },
          { nx: x - 1, ny: y },
          { nx: x, ny: y + 1 },
          { nx: x, ny: y - 1 }
        ];

        for (const { nx, ny } of neighbors) {
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nIdx = ny * w + nx;
            if (!visited[nIdx]) {
              visited[nIdx] = 1;
              const nR = data[nIdx * 4];
              const nG = data[nIdx * 4 + 1];
              const nB = data[nIdx * 4 + 2];
              const nA = data[nIdx * 4 + 3];

              if (nA > 10 && colorDist(nR, nG, nB, ref.r, ref.g, ref.b) <= maxDist) {
                queue.push({ x: nx, y: ny, ref });
              }
            }
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Chroma fill canvas export failed'));
          return;
        }
        resolve({
          blob,
          canvas,
          dataUrl: canvas.toDataURL('image/png')
        });
      }, 'image/png');
    });
  }

  /**
   * Center the subject image on a square canvas with specified padding and background.
   * Supports both AI cutouts and Box Mode (Full-frame packaging boxes).
   * @param {HTMLImageElement|Blob} cutoutSource - Cutout or full image
   * @param {Object} options
   * @param {number} [options.targetSize=1000] - Square dimension in pixels (e.g. 1000)
   * @param {number} [options.paddingPercent=10] - Edge padding percentage (e.g. 10%)
   * @param {string} [options.backgroundColor='#FFFFFF'] - Background fill color
   * @param {string} [options.format='image/jpeg'] - Output mime type
   * @param {number} [options.quality=0.92] - Compression quality for jpeg/webp
   * @param {boolean} [options.isFullFrame=false] - When true, preserves the entire box without alpha trimming
   * @returns {Promise<{blob: Blob, dataUrl: string, canvas: HTMLCanvasElement, bbox: Object, scale: number}>}
   */
  static async centerOnSquare(cutoutSource, options = {}) {
    const {
      targetSize = 1000,
      paddingPercent = 10,
      backgroundColor = '#FFFFFF',
      format = 'image/jpeg',
      quality = 0.92,
      isFullFrame = false
    } = options;

    const img = cutoutSource instanceof HTMLImageElement || cutoutSource instanceof HTMLCanvasElement
      ? cutoutSource 
      : await this.loadImage(cutoutSource);

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    // 1. Detect tight bounding box of cutout subject, or use full bounds in Box Mode
    const bbox = isFullFrame
      ? { minX: 0, minY: 0, maxX: w, maxY: h, width: w, height: h }
      : this.getAlphaBoundingBox(img);

    // 2. Calculate usable area based on padding
    // e.g. 10% padding on each edge gives 20% total padding (800x800 usable area inside 1000x1000)
    const margin = (targetSize * (paddingPercent / 100));
    const usableWidth = targetSize - (margin * 2);
    const usableHeight = targetSize - (margin * 2);

    // 3. Calculate scale factor preserving aspect ratio
    const scale = Math.min(
      usableWidth / bbox.width,
      usableHeight / bbox.height
    );

    const scaledWidth = Math.round(bbox.width * scale);
    const scaledHeight = Math.round(bbox.height * scale);

    // 4. Center coordinates on the target square canvas
    const drawX = Math.round((targetSize - scaledWidth) / 2);
    const drawY = Math.round((targetSize - scaledHeight) / 2);

    // 5. Render onto target square canvas
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');

    // Fill background (unless transparent is requested)
    if (backgroundColor && backgroundColor.toLowerCase() !== 'transparent') {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, targetSize, targetSize);
    } else {
      ctx.clearRect(0, 0, targetSize, targetSize);
    }

    // High quality interpolation
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw the cropped subject centered onto the canvas
    ctx.drawImage(
      img,
      bbox.minX,
      bbox.minY,
      bbox.width,
      bbox.height,
      drawX,
      drawY,
      scaledWidth,
      scaledHeight
    );

    // 6. Export as Blob and Data URL
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Canvas export failed'));
            return;
          }
          const dataUrl = canvas.toDataURL(format, quality);
          resolve({
            blob,
            dataUrl,
            canvas,
            bbox,
            scale,
            drawX,
            drawY,
            scaledWidth,
            scaledHeight,
            targetSize
          });
        },
        format,
        quality
      );
    });
  }
}
