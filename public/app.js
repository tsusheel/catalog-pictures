/**
 * Catalog Picture Studio - Application Controller
 * Handles batch queue management, UI interactions, AI execution,
 * Edge-to-Edge Padding Assist, Auto-Chroma Banner Keying, Box Mode,
 * and ZIP export packaging.
 */

import { CatalogImageProcessor } from './image-processor.js';
import { bgRemover } from './bg-remover.js';

class CatalogApp {
  constructor() {
    this.items = [];
    this.isProcessing = false;
    this.cancelRequested = false;

    this.settings = {
      targetSize: 1000,
      paddingPercent: 10,
      backgroundColor: '#FFFFFF',
      format: 'image/jpeg',
      quality: 0.92,
      namingSuffix: '_catalog',
      paddingAssist: true,
      solidifyProduct: true
    };

    this.currentModalItem = null;
    this.modalTempCutout = null;
    this.modalTempResult = null;
    this.modalTempMode = null;
    this.isWandActive = false;
    this.lastSeedPoint = null;
    this.brushMode = null;
    this.brushRadius = 24;
    this.isPainting = false;
    this.brushWorkingCanvas = null;
    this.origWorkingImage = null;

    this.initElements();
    this.attachEventListeners();
    this.renderStats();
  }

  initElements() {
    // Dropzone & Inputs
    this.dropzone = document.getElementById('dropzone');
    this.fileInput = document.getElementById('file-input');
    this.btnSelectFiles = document.getElementById('btn-select-files');

    // Controls
    this.selectSize = document.getElementById('select-size');
    this.sliderPadding = document.getElementById('slider-padding');
    this.valPadding = document.getElementById('val-padding');
    this.selectBg = document.getElementById('select-bg');
    this.selectFormat = document.getElementById('select-format');
    this.togglePaddingAssist = document.getElementById('toggle-padding-assist');
    this.toggleSolidify = document.getElementById('toggle-solidify');

    // Batch Actions
    this.btnStartBatch = document.getElementById('btn-start-batch');
    this.btnClearQueue = document.getElementById('btn-clear-queue');
    this.btnDownloadZip = document.getElementById('btn-download-zip');

    // Stats
    this.statTotal = document.getElementById('stat-total');
    this.statQueued = document.getElementById('stat-queued');
    this.statProcessing = document.getElementById('stat-processing');
    this.statCompleted = document.getElementById('stat-completed');
    this.progressBarWrap = document.getElementById('master-progress-bar-wrap');
    this.progressBarFill = document.getElementById('master-progress-bar-fill');

    // Grid Container & Empty State
    this.cardsGrid = document.getElementById('cards-grid');
    this.emptyState = document.getElementById('empty-state');

    // Inspection & Repair Modal
    this.modal = document.getElementById('compare-modal');
    this.modalClose = document.getElementById('modal-close');
    this.modalImgOriginal = document.getElementById('modal-img-original');
    this.modalImgResult = document.getElementById('modal-img-result');
    this.modalTitle = document.getElementById('modal-title');
    this.boxOriginal = document.getElementById('box-original');
    this.btnFixHealBorders = document.getElementById('btn-fix-heal-borders');
    this.btnFixSnapBox = document.getElementById('btn-fix-snap-box');
    this.btnToolBrushRestore = document.getElementById('btn-tool-brush-restore');
    this.btnToolBrushErase = document.getElementById('btn-tool-brush-erase');
    this.btnFixBoxMode = document.getElementById('btn-fix-box-mode');
    this.btnFixSolidify = document.getElementById('btn-fix-solidify');
    this.btnFixChroma = document.getElementById('btn-fix-chroma');
    this.btnFixAiRetry = document.getElementById('btn-fix-ai-retry');
    this.brushControls = document.getElementById('brush-controls');
    this.sliderBrushSize = document.getElementById('slider-brush-size');
    this.valBrushSize = document.getElementById('val-brush-size');
    this.brushHint = document.getElementById('brush-hint');
    this.wandControls = document.getElementById('wand-controls');
    this.sliderTolerance = document.getElementById('slider-tolerance');
    this.valTolerance = document.getElementById('val-tolerance');
    this.modalStatusText = document.getElementById('modal-status-text');
    this.btnModalCancel = document.getElementById('btn-modal-cancel');
    this.btnModalSave = document.getElementById('btn-modal-save');
  }

  attachEventListeners() {
    // Dropzone interactions
    this.btnSelectFiles.addEventListener('click', (e) => {
      e.stopPropagation();
      this.fileInput.click();
    });

    this.dropzone.addEventListener('click', () => this.fileInput.click());

    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files?.length) {
        this.addFiles(Array.from(e.target.files));
        this.fileInput.value = '';
      }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      this.dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropzone.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      this.dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropzone.classList.remove('drag-active');
      });
    });

    this.dropzone.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith('image/')
      );
      if (files.length > 0) {
        this.addFiles(files);
      }
    });

    // Settings adjustments
    this.selectSize.addEventListener('change', (e) => {
      this.settings.targetSize = parseInt(e.target.value, 10);
    });

    this.sliderPadding.addEventListener('input', (e) => {
      this.settings.paddingPercent = parseInt(e.target.value, 10);
      this.valPadding.textContent = `${this.settings.paddingPercent}%`;
    });

    this.selectBg.addEventListener('change', (e) => {
      this.settings.backgroundColor = e.target.value;
    });

    this.selectFormat.addEventListener('change', (e) => {
      this.settings.format = e.target.value;
    });

    if (this.togglePaddingAssist) {
      this.togglePaddingAssist.addEventListener('change', (e) => {
        this.settings.paddingAssist = e.target.checked;
      });
    }

    if (this.toggleSolidify) {
      this.toggleSolidify.addEventListener('change', (e) => {
        this.settings.solidifyProduct = e.target.checked;
      });
    }

    // Batch Actions
    this.btnStartBatch.addEventListener('click', () => this.startBatchProcessing());
    this.btnClearQueue.addEventListener('click', () => this.clearQueue());
    this.btnDownloadZip.addEventListener('click', () => this.downloadAllAsZip());

    // Modal Close
    this.modalClose.addEventListener('click', () => this.closeModal());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });
    if (this.btnModalCancel) {
      this.btnModalCancel.addEventListener('click', () => this.closeModal());
    }

    // Modal Repair Tools
    if (this.btnFixHealBorders) {
      this.btnFixHealBorders.addEventListener('click', () => this.handleFixHealBorders(false));
    }
    if (this.btnFixSnapBox) {
      this.btnFixSnapBox.addEventListener('click', () => this.handleFixHealBorders(true));
    }
    if (this.btnToolBrushRestore) {
      this.btnToolBrushRestore.addEventListener('click', () => this.setBrushMode('restore'));
    }
    if (this.btnToolBrushErase) {
      this.btnToolBrushErase.addEventListener('click', () => this.setBrushMode('erase'));
    }
    if (this.btnFixBoxMode) {
      this.btnFixBoxMode.addEventListener('click', () => this.handleFixBoxMode());
    }
    if (this.btnFixSolidify) {
      this.btnFixSolidify.addEventListener('click', () => this.handleFixSolidify());
    }
    if (this.btnFixChroma) {
      this.btnFixChroma.addEventListener('click', () => this.toggleWandMode());
    }
    if (this.btnFixAiRetry) {
      this.btnFixAiRetry.addEventListener('click', () => this.handleFixAiRetry());
    }
    if (this.btnModalSave) {
      this.btnModalSave.addEventListener('click', () => this.saveModalResult());
    }

    if (this.sliderBrushSize) {
      this.sliderBrushSize.addEventListener('input', (e) => {
        this.brushRadius = parseInt(e.target.value, 10);
        this.valBrushSize.textContent = `${this.brushRadius}px`;
      });
    }

    if (this.sliderTolerance) {
      this.sliderTolerance.addEventListener('input', (e) => {
        this.valTolerance.textContent = e.target.value;
        if (this.lastSeedPoint) {
          this.runChromaWand(this.lastSeedPoint.x, this.lastSeedPoint.y, parseInt(e.target.value, 10));
        }
      });
    }

    // Modal Mouse Interactions (Wand click & Brush painting)
    if (this.modalImgOriginal) {
      this.modalImgOriginal.addEventListener('mousedown', (e) => {
        if (this.brushMode && this.currentModalItem) {
          e.preventDefault();
          this.isPainting = true;
          this.paintAtEvent(e);
        }
      });

      this.modalImgOriginal.addEventListener('click', (e) => {
        if (!this.isWandActive || !this.currentModalItem) return;
        const rect = this.modalImgOriginal.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        const normX = Math.max(0, Math.min(1, clickX / rect.width));
        const normY = Math.max(0, Math.min(1, clickY / rect.height));
        const naturalW = this.modalImgOriginal.naturalWidth || rect.width;
        const naturalH = this.modalImgOriginal.naturalHeight || rect.height;
        const imgX = Math.round(normX * naturalW);
        const imgY = Math.round(normY * naturalH);

        this.lastSeedPoint = { x: imgX, y: imgY };
        this.runChromaWand(imgX, imgY, parseInt(this.sliderTolerance.value, 10));
      });
    }

    window.addEventListener('mousemove', (e) => {
      if (this.isPainting) {
        this.paintAtEvent(e);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isPainting) {
        this.isPainting = false;
        this.finalizeBrushStroke();
      }
    });
  }

  addFiles(files) {
    for (const file of files) {
      const id = 'item_' + Math.random().toString(36).substr(2, 9);
      const originalUrl = URL.createObjectURL(file);

      const item = {
        id,
        file,
        name: file.name,
        size: this.formatBytes(file.size),
        status: 'queued', // queued, processing, completed, error
        progressDetail: 'Waiting in queue',
        originalUrl,
        cutoutBlob: null,
        resultBlob: null,
        resultDataUrl: null,
        activeView: 'result', // or 'original'
        mode: 'ai', // 'ai' or 'box' (Full Box / Frame)
        error: null
      };

      this.items.push(item);
    }

    this.render();
  }

  removeFile(id) {
    const idx = this.items.findIndex((item) => item.id === id);
    if (idx !== -1) {
      if (this.items[idx].originalUrl) {
        URL.revokeObjectURL(this.items[idx].originalUrl);
      }
      this.items.splice(idx, 1);
      this.render();
    }
  }

  clearQueue() {
    if (this.isProcessing) return;
    this.items.forEach((item) => {
      if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
    });
    this.items = [];
    this.render();
  }

  async startBatchProcessing() {
    if (this.isProcessing) {
      // Allow pause / cancel
      this.cancelRequested = true;
      this.btnStartBatch.textContent = 'Stopping...';
      return;
    }

    const pendingItems = this.items.filter(
      (item) => item.status === 'queued' || item.status === 'error'
    );
    if (pendingItems.length === 0) return;

    this.isProcessing = true;
    this.cancelRequested = false;
    this.btnStartBatch.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      Pause
    `;
    this.progressBarWrap.style.display = 'block';

    for (const item of this.items) {
      if (this.cancelRequested) break;
      if (item.status === 'completed') continue;

      await this.processItem(item);
      this.updateMasterProgress();
    }

    this.isProcessing = false;
    this.btnStartBatch.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Process Queue
    `;
    this.renderStats();
  }

  async processItem(item) {
    item.status = 'processing';
    this.updateCardUI(item);

    try {
      if (item.mode === 'box') {
        // Box Mode: The photo itself is the product box (e.g. multi-pack carton covering full frame).
        // Center full frame without destructive AI cuts.
        item.progressDetail = `Centering full box on ${this.settings.targetSize}×${this.settings.targetSize}...`;
        this.updateCardUI(item);

        const centerResult = await CatalogImageProcessor.centerOnSquare(
          item.file,
          {
            targetSize: this.settings.targetSize,
            paddingPercent: this.settings.paddingPercent,
            backgroundColor: this.settings.backgroundColor,
            format: this.settings.format,
            quality: this.settings.quality,
            isFullFrame: true
          }
        );

        item.cutoutBlob = null;
        item.resultBlob = centerResult.blob;
        item.resultDataUrl = centerResult.dataUrl;
        item.status = 'completed';
        item.progressDetail = 'Box centered on 1000×1000';
        item.activeView = 'result';
      } else {
        // AI Cutout Mode: Automatic background removal with edge-clamping padding assist & chroma keying
        item.progressDetail = 'Initializing AI engine...';
        this.updateCardUI(item);

        const cutoutBlob = await bgRemover.removeBackground(
          item.file,
          ({ phase, percent }) => {
            if (phase.includes('fetch')) {
              item.progressDetail = `Downloading AI Model (${percent}%)`;
            } else if (phase.includes('padding')) {
              item.progressDetail = `Injecting Padded Margins...`;
            } else {
              item.progressDetail = `Extracting Product (${percent}%)`;
            }
            this.updateCardUI(item);
          },
          {
            paddingAssist: this.settings.paddingAssist,
            solidifyProduct: this.settings.solidifyProduct
          }
        );

        // Automatically heal concave border bites and packaging gaps
        let processedCutout = cutoutBlob;
        try {
          const healed = await CatalogImageProcessor.healMaskBorders(cutoutBlob, item.file, {
            boxSnap: false
          });
          processedCutout = healed.blob;
        } catch (healErr) {
          console.warn('Auto-heal border bites skipped:', healErr);
        }

        item.cutoutBlob = processedCutout;
        item.progressDetail = `Centering on ${this.settings.targetSize}×${this.settings.targetSize} white canvas...`;
        this.updateCardUI(item);

        const centerResult = await CatalogImageProcessor.centerOnSquare(
          processedCutout,
          {
            targetSize: this.settings.targetSize,
            paddingPercent: this.settings.paddingPercent,
            backgroundColor: this.settings.backgroundColor,
            format: this.settings.format,
            quality: this.settings.quality,
            isFullFrame: false
          }
        );

        item.resultBlob = centerResult.blob;
        item.resultDataUrl = centerResult.dataUrl;
        item.status = 'completed';
        item.progressDetail = 'Ready for catalog';
        item.activeView = 'result';
      }
    } catch (err) {
      console.error('Failed to process item:', item.name, err);
      item.status = 'error';
      item.error = err.message || 'Processing failed';
      item.progressDetail = 'Error processing image';
    }

    this.updateCardUI(item);
    this.renderStats();
  }

  updateMasterProgress() {
    const total = this.items.length;
    if (total === 0) return;
    const completed = this.items.filter((i) => i.status === 'completed').length;
    const percent = Math.round((completed / total) * 100);
    this.progressBarFill.style.width = `${percent}%`;
  }

  /**
   * Generates output filename: ci_[originalName].[ext]
   * @param {string} originalName
   * @returns {string}
   */
  getOutputFilename(originalName) {
    const lastDot = originalName.lastIndexOf('.');
    const baseName = lastDot !== -1 ? originalName.substring(0, lastDot) : originalName;
    const origExt = lastDot !== -1 ? originalName.substring(lastDot + 1).toLowerCase() : '';

    let ext = 'jpg';
    if (this.settings.format === 'image/png') {
      ext = 'png';
    } else if (this.settings.format === 'image/webp') {
      ext = 'webp';
    } else if (this.settings.format === 'image/jpeg') {
      ext = origExt === 'jpeg' ? 'jpeg' : 'jpg';
    } else if (origExt) {
      ext = origExt;
    }

    return `ci_${baseName}.${ext}`;
  }

  /**
   * Reliably triggers browser download of a Blob with explicit filename and extension
   * @param {Blob} blob
   * @param {string} filename
   */
  downloadBlob(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = blobUrl;
    link.setAttribute('download', filename);
    link.download = filename;
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    }, 2000);
  }

  downloadSingleItem(item) {
    const blob = item.resultBlob || (item.resultDataUrl ? this.dataUrlToBlob(item.resultDataUrl) : null);
    if (!blob) return;

    const filename = this.getOutputFilename(item.name);
    this.downloadBlob(blob, filename);
  }

  dataUrlToBlob(dataUrl) {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  async downloadAllAsZip() {
    const completedItems = this.items.filter((i) => i.status === 'completed' && i.resultBlob);
    if (completedItems.length === 0) {
      alert('No completed images to download yet! Process your queue first.');
      return;
    }

    if (typeof JSZip === 'undefined') {
      alert('ZIP archive library is still loading. Please try again in a moment.');
      return;
    }

    this.btnDownloadZip.disabled = true;
    const originalText = this.btnDownloadZip.innerHTML;
    this.btnDownloadZip.innerHTML = `
      <div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
      Archiving ${completedItems.length} Images...
    `;

    try {
      const zip = new JSZip();

      for (let i = 0; i < completedItems.length; i++) {
        const item = completedItems[i];
        const filename = this.getOutputFilename(item.name);
        zip.file(filename, item.resultBlob);
      }

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/zip',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      this.downloadBlob(zipBlob, 'ci_catalog_images.zip');
    } catch (err) {
      console.error('Failed to create ZIP package:', err);
      alert('Failed to generate ZIP archive: ' + err.message);
    } finally {
      this.btnDownloadZip.disabled = false;
      this.btnDownloadZip.innerHTML = originalText;
    }
  }

  async openModal(item) {
    this.currentModalItem = item;
    this.modalTempCutout = item.cutoutBlob;
    this.modalTempResult = { blob: item.resultBlob, dataUrl: item.resultDataUrl };
    this.modalTempMode = item.mode || 'ai';
    this.lastSeedPoint = null;
    this.toggleWandMode(false);
    this.setBrushMode(null);

    this.modalTitle.textContent = `${item.name} - Inspection & Border Repair`;
    this.modalImgOriginal.src = item.originalUrl;
    this.modalImgResult.src = item.resultDataUrl || item.originalUrl;
    this.modalStatusText.textContent = item.mode === 'box'
      ? 'Box Mode is active (Full box packaging preserved).'
      : 'Click "Heal Bites" or "Restore Brush" to fix missing borders.';
    this.modal.style.display = 'flex';

    await this.initBrushWorkingCanvas();
  }

  closeModal() {
    this.modal.style.display = 'none';
    this.currentModalItem = null;
    this.toggleWandMode(false);
    this.setBrushMode(null);
  }

  setBrushMode(mode) {
    if (this.brushMode === mode) {
      this.brushMode = null;
    } else {
      this.brushMode = mode;
      this.toggleWandMode(false);
    }

    if (this.btnToolBrushRestore) {
      this.btnToolBrushRestore.classList.toggle('btn-tool-active', this.brushMode === 'restore');
    }
    if (this.btnToolBrushErase) {
      this.btnToolBrushErase.classList.toggle('btn-tool-active', this.brushMode === 'erase');
    }
    if (this.brushControls) {
      this.brushControls.style.display = this.brushMode ? 'flex' : 'none';
    }
    if (this.boxOriginal) {
      this.boxOriginal.classList.toggle('cursor-brush', !!this.brushMode);
    }

    if (this.brushMode) {
      if (this.brushHint) {
        this.brushHint.textContent = this.brushMode === 'restore'
          ? 'Click & drag on the left image to restore packaging border pixels'
          : 'Click & drag on the left image to erase unwanted background bits';
      }
      this.modalStatusText.textContent = `${this.brushMode === 'restore' ? 'Restore' : 'Erase'} Brush Active: drag on Original preview to paint.`;
    } else {
      this.modalStatusText.textContent = 'Previewing current result';
    }
  }

  async initBrushWorkingCanvas() {
    if (!this.currentModalItem) return;
    this.origWorkingImage = await CatalogImageProcessor.loadImage(this.currentModalItem.file);
    const w = this.origWorkingImage.naturalWidth || this.origWorkingImage.width;
    const h = this.origWorkingImage.naturalHeight || this.origWorkingImage.height;

    this.brushWorkingCanvas = document.createElement('canvas');
    this.brushWorkingCanvas.width = w;
    this.brushWorkingCanvas.height = h;
    const ctx = this.brushWorkingCanvas.getContext('2d', { willReadFrequently: true });

    const currentSource = this.modalTempCutout || this.currentModalItem.cutoutBlob || this.currentModalItem.file;
    const currentImg = await CatalogImageProcessor.loadImage(currentSource);
    ctx.drawImage(currentImg, 0, 0, w, h);
  }

  async paintAtEvent(e) {
    if (!this.brushMode || !this.currentModalItem || !this.brushWorkingCanvas) return;
    const rect = this.modalImgOriginal.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const normX = Math.max(0, Math.min(1, clickX / rect.width));
    const normY = Math.max(0, Math.min(1, clickY / rect.height));
    const naturalW = this.brushWorkingCanvas.width;
    const naturalH = this.brushWorkingCanvas.height;
    const imgX = Math.round(normX * naturalW);
    const imgY = Math.round(normY * naturalH);

    await CatalogImageProcessor.applyBrush(
      this.brushWorkingCanvas,
      this.origWorkingImage,
      imgX,
      imgY,
      this.brushMode,
      this.brushRadius
    );

    this.modalImgResult.src = this.brushWorkingCanvas.toDataURL('image/png');
  }

  async finalizeBrushStroke() {
    if (!this.brushWorkingCanvas || !this.currentModalItem) return;
    this.modalStatusText.textContent = 'Updating 1000×1000 square preview...';

    const centerResult = await CatalogImageProcessor.centerOnSquare(
      this.brushWorkingCanvas,
      {
        targetSize: this.settings.targetSize,
        paddingPercent: this.settings.paddingPercent,
        backgroundColor: this.settings.backgroundColor,
        format: this.settings.format,
        quality: this.settings.quality,
        isFullFrame: false
      }
    );

    this.modalTempCutout = this.brushWorkingCanvas;
    this.modalTempResult = centerResult;
    this.modalTempMode = 'brushed';
    this.modalImgResult.src = centerResult.dataUrl;
    this.modalStatusText.textContent = 'Brush stroke applied! Click "Apply to Queue" to save.';
  }

  async handleFixHealBorders(boxSnap = false) {
    if (!this.currentModalItem) return;
    this.modalStatusText.textContent = boxSnap
      ? 'Snapping to straight rectangular box borders...'
      : 'Healing concave border bites and missing chunks...';

    try {
      const sourceCutout = this.modalTempCutout || this.currentModalItem.cutoutBlob || this.currentModalItem.file;
      const healedResult = await CatalogImageProcessor.healMaskBorders(
        sourceCutout,
        this.currentModalItem.file,
        { alphaThreshold: 20, boxSnap }
      );

      const centerResult = await CatalogImageProcessor.centerOnSquare(
        healedResult.blob,
        {
          targetSize: this.settings.targetSize,
          paddingPercent: this.settings.paddingPercent,
          backgroundColor: this.settings.backgroundColor,
          format: this.settings.format,
          quality: this.settings.quality,
          isFullFrame: false
        }
      );

      this.modalTempCutout = healedResult.blob;
      this.modalTempResult = centerResult;
      this.modalTempMode = boxSnap ? 'boxSnap' : 'healed';
      this.modalImgResult.src = centerResult.dataUrl;
      this.modalStatusText.textContent = boxSnap
        ? 'Box packaging snapped to straight borders! Click "Apply to Queue" to save.'
        : 'Border bites healed & bridged! Click "Apply to Queue" to save.';

      await this.initBrushWorkingCanvas();
    } catch (err) {
      console.error('Border healing failed:', err);
      this.modalStatusText.textContent = 'Border healing error: ' + err.message;
    }
  }

  toggleWandMode(forceState = null) {
    this.isWandActive = forceState !== null ? forceState : !this.isWandActive;
    if (this.btnFixChroma) {
      this.btnFixChroma.classList.toggle('btn-wand-active', this.isWandActive);
    }
    if (this.wandControls) {
      this.wandControls.style.display = this.isWandActive ? 'flex' : 'none';
    }
    if (this.boxOriginal) {
      this.boxOriginal.classList.toggle('cursor-crosshair', this.isWandActive);
    }
    if (this.modalStatusText) {
      this.modalStatusText.textContent = this.isWandActive
        ? 'Magic Wand Active: Click any background area on the Original image to erase it.'
        : 'Previewing current result';
    }
  }

  async runChromaWand(x, y, tolerance) {
    if (!this.currentModalItem) return;
    this.modalStatusText.textContent = `Erasing background color at (${x}, ${y})...`;

    try {
      const chromaResult = await CatalogImageProcessor.removeChromaBackground(
        this.currentModalItem.file,
        {
          seeds: [{ x, y }],
          tolerance
        }
      );

      const centerResult = await CatalogImageProcessor.centerOnSquare(
        chromaResult.blob,
        {
          targetSize: this.settings.targetSize,
          paddingPercent: this.settings.paddingPercent,
          backgroundColor: this.settings.backgroundColor,
          format: this.settings.format,
          quality: this.settings.quality,
          isFullFrame: false
        }
      );

      this.modalTempCutout = chromaResult.blob;
      this.modalTempResult = centerResult;
      this.modalTempMode = 'chroma';
      this.modalImgResult.src = centerResult.dataUrl;
      this.modalStatusText.textContent = `Color at (${x}, ${y}) erased with tolerance ${tolerance}. Click "Apply to Queue" to save.`;
    } catch (err) {
      console.error('Wand chroma failed:', err);
      this.modalStatusText.textContent = 'Failed to erase background: ' + err.message;
    }
  }

  async handleFixBoxMode() {
    if (!this.currentModalItem) return;
    this.modalStatusText.textContent = 'Formatting full packaging box at 1000×1000...';

    try {
      const centerResult = await CatalogImageProcessor.centerOnSquare(
        this.currentModalItem.file,
        {
          targetSize: this.settings.targetSize,
          paddingPercent: this.settings.paddingPercent,
          backgroundColor: this.settings.backgroundColor,
          format: this.settings.format,
          quality: this.settings.quality,
          isFullFrame: true
        }
      );

      this.modalTempCutout = null;
      this.modalTempResult = centerResult;
      this.modalTempMode = 'box';
      this.modalImgResult.src = centerResult.dataUrl;
      this.modalStatusText.textContent = 'Box Mode applied (Full box packaging preserved). Click "Apply to Queue" to save.';
    } catch (err) {
      console.error('Box Mode failed:', err);
      this.modalStatusText.textContent = 'Box Mode error: ' + err.message;
    }
  }

  async handleFixSolidify() {
    if (!this.currentModalItem) return;
    this.modalStatusText.textContent = 'Solidifying product packaging & restoring 100% original colors...';

    try {
      const sourceCutout = this.modalTempCutout || this.currentModalItem.cutoutBlob || this.currentModalItem.file;
      const solidifiedResult = await CatalogImageProcessor.solidifyProductMask(
        sourceCutout,
        this.currentModalItem.file,
        { alphaThreshold: 20 }
      );

      const centerResult = await CatalogImageProcessor.centerOnSquare(
        solidifiedResult.blob,
        {
          targetSize: this.settings.targetSize,
          paddingPercent: this.settings.paddingPercent,
          backgroundColor: this.settings.backgroundColor,
          format: this.settings.format,
          quality: this.settings.quality,
          isFullFrame: false
        }
      );

      this.modalTempCutout = solidifiedResult.blob;
      this.modalTempResult = centerResult;
      this.modalTempMode = 'solidified';
      this.modalImgResult.src = centerResult.dataUrl;
      this.modalStatusText.textContent = 'Product colors 100% restored and solidified! Click "Apply to Queue" to save.';
    } catch (err) {
      console.error('Solidify failed:', err);
      this.modalStatusText.textContent = 'Solidify error: ' + err.message;
    }
  }

  async handleFixAiRetry() {
    if (!this.currentModalItem) return;
    this.modalStatusText.textContent = 'Retrying AI with Padding Injection & Mask Solidification...';

    try {
      const cutoutBlob = await bgRemover.removeBackground(
        this.currentModalItem.file,
        null,
        { paddingAssist: true, solidifyProduct: true }
      );

      const centerResult = await CatalogImageProcessor.centerOnSquare(
        cutoutBlob,
        {
          targetSize: this.settings.targetSize,
          paddingPercent: this.settings.paddingPercent,
          backgroundColor: this.settings.backgroundColor,
          format: this.settings.format,
          quality: this.settings.quality,
          isFullFrame: false
        }
      );

      this.modalTempCutout = cutoutBlob;
      this.modalTempResult = centerResult;
      this.modalTempMode = 'ai';
      this.modalImgResult.src = centerResult.dataUrl;
      this.modalStatusText.textContent = 'AI Segmentation completed! Click "Apply to Queue" to save.';
    } catch (err) {
      console.error('AI retry failed:', err);
      this.modalStatusText.textContent = 'AI Retry failed: ' + err.message;
    }
  }

  saveModalResult() {
    if (this.currentModalItem && this.modalTempResult) {
      this.currentModalItem.resultBlob = this.modalTempResult.blob;
      this.currentModalItem.resultDataUrl = this.modalTempResult.dataUrl;
      if (this.modalTempCutout) {
        this.currentModalItem.cutoutBlob = this.modalTempCutout;
      }
      if (this.modalTempMode) {
        this.currentModalItem.mode = this.modalTempMode;
      }
      this.currentModalItem.status = 'completed';
      this.currentModalItem.progressDetail = 'Refined in Studio';
      this.currentModalItem.activeView = 'result';
      this.updateCardUI(this.currentModalItem);
      this.renderStats();
    }
    this.closeModal();
  }

  render() {
    if (this.items.length === 0) {
      this.emptyState.style.display = 'flex';
      this.cardsGrid.innerHTML = '';
      this.cardsGrid.appendChild(this.emptyState);
    } else {
      this.emptyState.style.display = 'none';
      this.cardsGrid.innerHTML = '';
      for (const item of this.items) {
        this.cardsGrid.appendChild(this.createCardElement(item));
      }
    }

    this.renderStats();
  }

  createCardElement(item) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.id = `card-${item.id}`;

    const isDone = item.status === 'completed';
    const isProcessing = item.status === 'processing';
    const isError = item.status === 'error';
    const isBoxMode = item.mode === 'box';

    const currentSrc = isDone && item.activeView === 'result' ? item.resultDataUrl : item.originalUrl;

    card.innerHTML = `
      <div class="card-top">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="status-badge ${item.status}">
            ${isProcessing ? '<div class="spinner" style="width: 10px; height: 10px; border-width: 2px;"></div>' : ''}
            ${item.status}
          </span>
          ${isBoxMode ? '<span class="badge-mode">Box Mode</span>' : ''}
        </div>
        <button class="btn-icon btn-remove" title="Remove image" id="remove-${item.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="card-preview-area" id="preview-area-${item.id}">
        <img class="card-preview-img" id="img-${item.id}" src="${currentSrc}" alt="${item.name}">
        ${isDone ? `<button class="toggle-view-btn" id="toggle-${item.id}">${item.activeView === 'result' ? 'Show Original' : 'Show 1000×1000'}</button>` : ''}
        ${isProcessing ? `
          <div class="card-loader-overlay">
            <div class="spinner"></div>
            <div class="loader-status-text" id="loader-text-${item.id}">${item.progressDetail}</div>
          </div>
        ` : ''}
      </div>

      <div class="card-info">
        <div class="product-filename" title="${item.name}">${item.name}</div>
        <div class="product-meta">
          <span>${item.size}</span>
          <span>${isDone ? `→ ${this.getOutputFilename(item.name)}` : 'Catalog Input'}</span>
        </div>
      </div>

      <div class="card-actions">
        ${isDone ? `
          <button class="btn btn-secondary btn-card btn-inspect" id="inspect-${item.id}" title="Inspect & Repair">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Inspect
          </button>
          <button class="btn btn-secondary btn-card" id="toggle-mode-${item.id}" title="${isBoxMode ? 'Switch to AI Cutout' : 'Switch to Box Mode'}">
            ${isBoxMode ? 'AI Cut' : 'Box Mode'}
          </button>
          <button class="btn btn-primary btn-card btn-download" id="download-${item.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
        ` : `
          <button class="btn btn-secondary btn-card" id="toggle-mode-${item.id}" title="Set processing mode">
            ${isBoxMode ? 'Mode: Box' : 'Mode: AI'}
          </button>
          <button class="btn btn-secondary btn-card" disabled>
            ${isProcessing ? 'Processing...' : 'Queued'}
          </button>
        `}
      </div>
    `;

    // Bind card buttons
    card.querySelector(`#remove-${item.id}`).addEventListener('click', () => this.removeFile(item.id));

    const toggleModeBtn = card.querySelector(`#toggle-mode-${item.id}`);
    if (toggleModeBtn) {
      toggleModeBtn.addEventListener('click', async () => {
        item.mode = item.mode === 'box' ? 'ai' : 'box';
        if (isDone) {
          await this.processItem(item);
        } else {
          this.updateCardUI(item);
        }
      });
    }

    if (isDone) {
      const toggleBtn = card.querySelector(`#toggle-${item.id}`);
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          item.activeView = item.activeView === 'result' ? 'original' : 'result';
          this.updateCardUI(item);
        });
      }

      card.querySelector(`#download-${item.id}`).addEventListener('click', () => this.downloadSingleItem(item));
      card.querySelector(`#inspect-${item.id}`).addEventListener('click', () => this.openModal(item));
    }

    return card;
  }

  updateCardUI(item) {
    const existingCard = document.getElementById(`card-${item.id}`);
    if (!existingCard) return;

    const newCard = this.createCardElement(item);
    existingCard.replaceWith(newCard);
  }

  renderStats() {
    const total = this.items.length;
    const queued = this.items.filter((i) => i.status === 'queued').length;
    const processing = this.items.filter((i) => i.status === 'processing').length;
    const completed = this.items.filter((i) => i.status === 'completed').length;

    this.statTotal.textContent = total;
    this.statQueued.textContent = queued;
    this.statProcessing.textContent = processing;
    this.statCompleted.textContent = completed;

    this.btnStartBatch.disabled = (queued === 0 && processing === 0) || this.isProcessing;
    this.btnClearQueue.disabled = this.isProcessing || total === 0;
    this.btnDownloadZip.disabled = completed === 0;

    this.btnDownloadZip.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Download ZIP (${completed})
    `;
  }

  formatBytes(bytes, decimals = 1) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }
}

// Instantiate on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.catalogApp = new CatalogApp();
});
