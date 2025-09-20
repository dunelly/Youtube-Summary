import { waitForElement, sleep } from './utils.js';
import { ensureGeminiKey } from './settings.js';

const PANEL_ID = 'yaivs-summary-panel';
const STYLE_ID = 'yaivs-summary-styles';

export class SummaryPanel {
  constructor(collector) {
    this.collector = collector;
    this.generateHandler = null;
    this.panel = null;
    this.summaryEl = null;
    this.statusEl = null;
    this.generateBtn = null;
    this.observeNavigation();
    this.setup();
  }

  observeNavigation() {
    window.addEventListener('yt-navigate-start', () => this.resetState());
    window.addEventListener('yt-navigate-finish', () => this.setup());
  }

  async setup() {
    injectStyles();

    const metadata = await waitForElement('ytd-watch-metadata', 8000).catch(() => null);
    if (!metadata) {
      return;
    }

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = this.createPanel();
      const description = metadata.querySelector('#description');
      if (description?.parentElement) {
        description.parentElement.insertBefore(panel, description);
      } else {
        metadata.insertBefore(panel, metadata.firstChild);
      }
    }

    this.bindElements(panel);
    this.resetState();
  }

  createPanel() {
    const container = document.createElement('section');
    container.id = PANEL_ID;
    container.className = 'yaivs-panel';
    container.innerHTML = `
      <header class="yaivs-panel__header">
        <h2 class="yaivs-panel__title">AI Summary</h2>
        <button class="yaivs-button" type="button" id="yaivs-generate">Summarize with Gemini</button>
      </header>
      <p class="yaivs-status yaivs-status--info" id="yaivs-status">Click to summarize the current video.</p>
      <pre class="yaivs-summary" id="yaivs-summary" hidden></pre>
    `;
    return container;
  }

  bindElements(panel) {
    this.panel = panel;
    this.summaryEl = panel.querySelector('#yaivs-summary');
    this.statusEl = panel.querySelector('#yaivs-status');
    this.generateBtn = panel.querySelector('#yaivs-generate');

    if (this.generateHandler) {
      this.generateBtn.removeEventListener('click', this.generateHandler);
    }

    this.generateHandler = () => this.handleSummarize();
    this.generateBtn.addEventListener('click', this.generateHandler);
  }

  resetState() {
    if (!this.panel) {
      return;
    }

    if (this.summaryEl) {
      this.summaryEl.textContent = '';
      this.summaryEl.hidden = true;
    }

    if (this.statusEl) {
      this.statusEl.textContent = 'Click to summarize the current video.';
      this.statusEl.className = 'yaivs-status yaivs-status--info';
    }

    if (this.generateBtn) {
      this.generateBtn.disabled = false;
      this.generateBtn.textContent = 'Summarize with Gemini';
    }
  }

  async handleSummarize() {
    if (!this.generateBtn || this.generateBtn.disabled) {
      return;
    }

    this.setLoading(true, 'Fetching transcript...');

    try {
      await ensureGeminiKey();
      const transcript = await this.collector.collect();
      this.setLoading(true, 'Summarizing with Gemini 1.5 Flash...');

      const response = await chrome.runtime.sendMessage({
        type: 'summarizeWithGemini',
        transcript
      });

      if (!response) {
        throw new Error('No response from background service.');
      }

      if (response.status === 'error') {
        throw new Error(response.message);
      }

      this.renderSummary(response.summary);
      this.updateStatus('Summary ready.', 'success');
    } catch (error) {
      console.error('Summary generation failed', error);
      this.renderSummary('');
      this.updateStatus(error.message || 'Failed to generate summary.', 'error');
      chrome.runtime.sendMessage({ type: 'logError', message: error.message || String(error) }).catch(() => {});
    } finally {
      this.setLoading(false);
    }
  }

  renderSummary(summary) {
    if (!this.summaryEl) return;

    const text = summary ? summary.toString().trim() : '';
    if (!text) {
      this.summaryEl.hidden = true;
      this.summaryEl.textContent = '';
      return;
    }

    this.summaryEl.textContent = text;
    this.summaryEl.hidden = false;
  }

  updateStatus(message, variant) {
    if (!this.statusEl) return;
    this.statusEl.textContent = message;
    this.statusEl.className = `yaivs-status yaivs-status--${variant}`;
  }

  setLoading(isLoading, message) {
    if (!this.generateBtn) return;
    this.generateBtn.disabled = isLoading;
    this.generateBtn.textContent = isLoading ? 'Summarizing…' : 'Summarize with Gemini';
    if (message) {
      this.updateStatus(message, 'loading');
    }
  }
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} {
      padding: 16px;
      margin-top: 16px;
      border-radius: 12px;
      border: 1px solid rgba(0, 0, 0, 0.08);
      background: rgba(248, 249, 251, 0.85);
      backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .yaivs-panel__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .yaivs-panel__title {
      margin: 0;
      font-size: 18px;
      color: #0f172a;
    }

    .yaivs-button {
      padding: 8px 14px;
      border-radius: 8px;
      border: none;
      font-size: 14px;
      font-weight: 600;
      background: #1a73e8;
      color: #fff;
      cursor: pointer;
      transition: background 0.2s ease;
    }

    .yaivs-button:hover:enabled {
      background: #1558b0;
    }

    .yaivs-button:disabled {
      background: #a1c2f7;
      cursor: not-allowed;
    }

    .yaivs-status {
      margin: 0;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid transparent;
      font-size: 13px;
      text-align: left;
    }

    .yaivs-status--info {
      background: rgba(26, 115, 232, 0.1);
      color: #0b3c70;
      border-color: rgba(26, 115, 232, 0.2);
    }

    .yaivs-status--loading {
      background: rgba(26, 115, 232, 0.08);
      color: #0b3c70;
      border-color: rgba(26, 115, 232, 0.24);
    }

    .yaivs-status--success {
      background: rgba(15, 157, 88, 0.12);
      color: #0f5132;
      border-color: rgba(15, 157, 88, 0.24);
    }

    .yaivs-status--error {
      background: rgba(217, 48, 37, 0.12);
      color: #7f1d1d;
      border-color: rgba(217, 48, 37, 0.24);
    }

    .yaivs-summary {
      margin: 0;
      padding: 12px;
      border-radius: 8px;
      background: #fff;
      border: 1px solid rgba(15, 23, 42, 0.1);
      font-family: inherit;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      max-height: 320px;
      overflow-y: auto;
    }
  `;

  document.head.appendChild(style);
}
