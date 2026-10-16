/**
 * AI Background Remover Module
 * Interfaces with @imgly/background-removal running client-side via WebAssembly/WebGPU.
 * Completely free, no API keys, zero cloud costs.
 */

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
   * Removes background from an image file or blob
   * @param {File|Blob|string} imageSource
   * @param {Function} [onProgress] - Callback for model download and processing progress
   * @returns {Promise<Blob>} - Output transparent PNG blob
   */
  async removeBackground(imageSource, onProgress = null) {
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
      const resultBlob = await removeBackgroundFn(imageSource, config);
      return resultBlob;
    } catch (error) {
      console.error('Background removal inference error:', error);
      throw error;
    }
  }
}

export const bgRemover = new BackgroundRemovalService();
