import { CatalogImageProcessor } from './image-processor.js';

class BackgroundRemovalService {
  constructor() {
    this.module = null;
    this.isLoadingModule = false;
    this.loadPromise = null;
  }

  /**
   * Lazily loads the @imgly/background-removal ES module from CDN
   */
  async getModule() {
    if (this.module) return this.module;
    if (this.loadPromise) return this.loadPromise;

    this.isLoadingModule = true;
    this.loadPromise = (async () => {
      try {
        // Load via high-availability jsDelivr CDN
        const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.7/+esm');
        this.module = mod;
        return mod;
      } catch (err) {
        console.warn('Primary CDN failed, trying fallback unpkg CDN...', err);
        try {
          const mod = await import('https://unpkg.com/@imgly/background-removal@1.5.7/dist/bundle.esm.mjs');
          this.module = mod;
          return mod;
        } catch (fallbackErr) {
          throw new Error(`Failed to load AI background removal engine: ${fallbackErr.message}`);
        }
      } finally {
        this.isLoadingModule = false;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Removes background from an image with full-bleed padding assist and chroma refinement
   * @param {File|Blob|string} imageSource
   * @param {Function} [onProgress] - Callback for model download and processing progress
   * @param {Object} [options]
   * @param {boolean} [options.paddingAssist=true] - Extends margins with edge clamping before inference
   * @param {boolean} [options.autoChroma=true] - Clean flat banner backgrounds
   * @param {number} [options.padRatio=0.15] - Margin injection ratio
   * @returns {Promise<Blob>} - Output transparent PNG blob
   */
  async removeBackground(imageSource, onProgress = null, options = {}) {
    const {
      paddingAssist = true,
      solidifyProduct = true,
      padRatio = 0.15
    } = options;

    const mod = await this.getModule();
    const removeBackgroundFn = mod.removeBackground || mod.default?.removeBackground;

    if (!removeBackgroundFn) {
      throw new Error('removeBackground function not found in loaded module');
    }

    const config = {
      progress: (key, current, total) => {
        if (typeof onProgress === 'function') {
          const percent = total > 0 ? Math.round((current / total) * 100) : 0;
          onProgress({
            phase: key, // e.g., 'fetch:model', 'compute:inference'
            current,
            total,
            percent
          });
        }
      },
      debug: false
    };

    try {
      let inferenceInput = imageSource;
      let padData = null;

      // Step 1: Pre-inference Padding Injection for edge-to-edge / full-bleed products
      if (paddingAssist) {
        if (typeof onProgress === 'function') {
          onProgress({ phase: 'preprocess:padding', current: 0, total: 100, percent: 10 });
        }
        const img = await CatalogImageProcessor.loadImage(imageSource);
        padData = await CatalogImageProcessor.preparePaddedImage(img, padRatio);
        inferenceInput = padData.paddedBlob;
      }

      // Step 2: AI Background Removal Inference
      const rawCutoutBlob = await removeBackgroundFn(inferenceInput, config);

      // Step 3: Crop back to exact original frame
      let finalCutoutBlob = rawCutoutBlob;
      if (padData) {
        const { blob: croppedBlob } = await CatalogImageProcessor.cropFromPaddedCutout(
          rawCutoutBlob,
          padData.padX,
          padData.padY,
          padData.originalWidth,
          padData.originalHeight
        );
        finalCutoutBlob = croppedBlob;
      }

      // Step 4: Solidify product mask & restore 100% original RGB colors
      // Fixes washed-out / faded packaging colors (like purple carton faces or orange wrappers)
      if (solidifyProduct) {
        try {
          const solidifiedResult = await CatalogImageProcessor.solidifyProductMask(
            finalCutoutBlob,
            imageSource,
            { alphaThreshold: 20 }
          );
          finalCutoutBlob = solidifiedResult.blob;
        } catch (solidifyErr) {
          console.warn('Product mask solidification skipped:', solidifyErr);
        }
      }

      return finalCutoutBlob;
    } catch (error) {
      console.error('Background removal inference error:', error);
      throw error;
    }
  }
}

export const bgRemover = new BackgroundRemovalService();

