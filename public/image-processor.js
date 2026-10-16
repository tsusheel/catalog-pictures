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
   * Center the subject image on a square canvas with specified padding and background
   * @param {HTMLImageElement|Blob} cutoutSource - Transparent cutout image
   * @param {Object} options
   * @param {number} [options.targetSize=1000] - Square dimension in pixels (e.g. 1000)
   * @param {number} [options.paddingPercent=10] - Edge padding percentage (e.g. 10%)
   * @param {string} [options.backgroundColor='#FFFFFF'] - Background fill color
   * @param {string} [options.format='image/jpeg'] - Output mime type
   * @param {number} [options.quality=0.92] - Compression quality for jpeg/webp
   * @returns {Promise<{blob: Blob, dataUrl: string, canvas: HTMLCanvasElement, bbox: Object, scale: number}>}
   */
  static async centerOnSquare(cutoutSource, options = {}) {
    const {
      targetSize = 1000,
      paddingPercent = 10,
      backgroundColor = '#FFFFFF',
      format = 'image/jpeg',
      quality = 0.92
    } = options;

    const img = cutoutSource instanceof HTMLImageElement 
      ? cutoutSource 
      : await this.loadImage(cutoutSource);

    // 1. Detect tight bounding box of cutout subject
    const bbox = this.getAlphaBoundingBox(img);

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
