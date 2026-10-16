/**
 * Catalog Picture Studio - Application Controller
 * Handles batch queue management, UI interactions, AI execution,
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
      namingSuffix: '_catalog'
    };

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

    // Comparison Modal
    this.modal = document.getElementById('compare-modal');
    this.modalClose = document.getElementById('modal-close');
    this.modalImgOriginal = document.getElementById('modal-img-original');
    this.modalImgResult = document.getElementById('modal-img-result');
    this.modalTitle = document.getElementById('modal-title');
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

    // Batch Actions
    this.btnStartBatch.addEventListener('click', () => this.startBatchProcessing());
    this.btnClearQueue.addEventListener('click', () => this.clearQueue());
    this.btnDownloadZip.addEventListener('click', () => this.downloadAllAsZip());

    // Modal
    this.modalClose.addEventListener('click', () => this.closeModal());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
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
    item.progressDetail = 'Initializing AI model...';
    this.updateCardUI(item);

    try {
      // Step 1: AI Background Removal
      const cutoutBlob = await bgRemover.removeBackground(
        item.file,
        ({ phase, percent }) => {
          if (phase.includes('fetch')) {
            item.progressDetail = `Downloading AI Model (${percent}%)`;
          } else {
            item.progressDetail = `Extracting Product (${percent}%)`;
          }
          this.updateCardUI(item);
        }
      );

      item.cutoutBlob = cutoutBlob;
      item.progressDetail = `Centering on ${this.settings.targetSize}×${this.settings.targetSize} white canvas...`;
      this.updateCardUI(item);

      // Step 2: Precision Alpha Trimming & 1000x1000 White Square Centering
      const centerResult = await CatalogImageProcessor.centerOnSquare(
        cutoutBlob,
        {
          targetSize: this.settings.targetSize,
          paddingPercent: this.settings.paddingPercent,
          backgroundColor: this.settings.backgroundColor,
          format: this.settings.format,
          quality: this.settings.quality
        }
      );

      item.resultBlob = centerResult.blob;
      item.resultDataUrl = centerResult.dataUrl;
      item.status = 'completed';
      item.progressDetail = 'Ready for catalog';
      item.activeView = 'result';
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

  openModal(item) {
    this.modalTitle.textContent = `${item.name} - Catalog Inspection`;
    this.modalImgOriginal.src = item.originalUrl;
    this.modalImgResult.src = item.resultDataUrl || item.originalUrl;
    this.modal.style.display = 'flex';
  }

  closeModal() {
    this.modal.style.display = 'none';
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

    const currentSrc = isDone && item.activeView === 'result' ? item.resultDataUrl : item.originalUrl;

    card.innerHTML = `
      <div class="card-top">
        <span class="status-badge ${item.status}">
          ${isProcessing ? '<div class="spinner" style="width: 10px; height: 10px; border-width: 2px;"></div>' : ''}
          ${item.status}
        </span>
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
          <button class="btn btn-secondary btn-card btn-inspect" id="inspect-${item.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Inspect
          </button>
          <button class="btn btn-primary btn-card btn-download" id="download-${item.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
        ` : `
          <button class="btn btn-secondary btn-card" disabled>
            ${isProcessing ? 'Processing...' : 'Queued'}
          </button>
        `}
      </div>
    `;

    // Bind card buttons
    card.querySelector(`#remove-${item.id}`).addEventListener('click', () => this.removeFile(item.id));

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
