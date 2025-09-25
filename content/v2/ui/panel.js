import { formatSummaryHtml, findDescriptionElement } from '../utils.js';
import { injectStyles, getPanelMountPoint, PANEL_ID } from './mount.js';
import { ensureProviderKey } from '../providers.js';

export class SummaryPanel {
  constructor(settings, transcriptService) {
    this.settings = settings;
    this.transcriptService = transcriptService;
    this.panel = null;
    this.summaryEl = null;
    this.statusEl = null;
    this.unifiedBtn = null;
    this.generateBtn = null;
    this.promptInput = null;
    this.sendBtn = null;
    this.askBtn = null;
    this.styleBtn = null;
    this.styleMenu = null;
    this.clearBtn = null;
    this.toolsRow = null;
    this.copyBtn = null;
    this.toggleBtn = null;
    this.isSummarizing = false;
    this.autoTriggeredVideoId = null;
    this.lastRawSummary = '';
    this.settings.subscribe(values => this.handleSettingsChange(values));
    this.observeNavigation();
    this.setup();
  }

  observeNavigation() {
    window.addEventListener('yt-navigate-start', () => {
      this.autoTriggeredVideoId = null;
      this.resetState();
    });
    window.addEventListener('yt-navigate-finish', () => this.setup());
  }

  async setup() {
    injectStyles();
    await this.settings.ready;
    const mountPoint = await getPanelMountPoint();
    if (!mountPoint?.parent) {
      console.warn('[YAIVS v2] Unable to locate a mount point for the summary panel.');
      return;
    }
    let panel = document.getElementById(PANEL_ID);
    if (!panel) panel = this.createPanel();

    const { parent, anchor } = mountPoint;
    const alreadyMounted = panel.parentElement === parent;

    if (anchor) {
      if (!alreadyMounted || panel.nextElementSibling !== anchor) {
        parent.insertBefore(panel, anchor);
      }
    } else if (!alreadyMounted || parent.firstElementChild !== panel) {
      if (parent.firstChild) parent.insertBefore(panel, parent.firstChild);
      else parent.appendChild(panel);
    }

    this.bindElements(panel);
    this.resetState();
    this.updateSendVisibility();
    this.ensureAboveDescription(mountPoint.container);
    this.maybeAutoSummarize();
  }

  createPanel() {
    const container = document.createElement('section');
    container.id = PANEL_ID;
    container.className = 'yaivs-panel';
    container.innerHTML = `
      <div class="yaivs-header-row">
        <p class="yaivs-status yaivs-status--info" id="yaivs-status">Click to summarize the current video.</p>
        <button class="yaivs-unified-button" type="button" id="yaivs-unified" aria-label="AI Summarize">
          <span class="yaivs-unified-main" id="yaivs-generate">
            <span class="yaivs-text">SUMMARIZE</span>
          </span>
          <span class="yaivs-unified-dropdown" id="yaivs-menu" aria-label="Style options">
            <span class="yaivs-arrow">▾</span>
          </span>
        </button>
      </div>
      <div class="yaivs-actions" id="yaivs-actions">
        <div class="yaivs-prompt" id="yaivs-prompt-row">
          <div class="yaivs-input-wrap">
            <input class="yaivs-input" id="yaivs-prompt-input" type="text" placeholder="Ask about this video… (or leave blank to summarize)" aria-label="Ask about this video" />
            <button class="yaivs-send" id="yaivs-send" aria-label="Send" hidden>↑</button>
          </div>
        </div>
        <div class="yaivs-style-menu" id="yaivs-style-menu" hidden>
          <button type="button" data-style="simple">Bullets</button>
          <button type="button" data-style="detailed">Detailed</button>
          <button type="button" data-style="chapters">Chapters</button>
          <button type="button" data-style="proscons">Pros / Cons</button>
          <button type="button" data-style="recipe">Recipe</button>
          <button type="button" data-style="outline">Outline</button>
        </div>
      </div>
      <div class="yaivs-tools" id="yaivs-tools" hidden>
        <button type="button" id="yaivs-copy" class="yaivs-tool">Copy</button>
      </div>
      <div class="yaivs-onboarding" id="yaivs-onboarding" hidden>
        <div class="yaivs-onb-text">Connect a free OpenRouter key to start summarizing.</div>
        <div class="yaivs-onb-actions">
          <button type="button" class="yaivs-onb-btn" id="yaivs-onb-get">Get free key</button>
          <button type="button" class="yaivs-onb-btn" id="yaivs-onb-paste">Paste from clipboard</button>
          <button type="button" class="yaivs-onb-btn" id="yaivs-onb-test">Test key</button>
        </div>
        <div class="yaivs-onb-hint">We’ll auto-detect the key on the OpenRouter keys page.</div>
      </div>
      <div class="yaivs-summary" id="yaivs-summary" hidden></div>
    `;
    return container;
  }

  bindElements(panel) {
    this.panel = panel;
    this.summaryEl = panel.querySelector('#yaivs-summary');
    this.statusEl = panel.querySelector('#yaivs-status');
    this.unifiedBtn = panel.querySelector('#yaivs-unified');
    this.generateBtn = panel.querySelector('#yaivs-generate');
    this.promptInput = panel.querySelector('#yaivs-prompt-input');
    this.sendBtn = panel.querySelector('#yaivs-send');
    this.askBtn = null;
    this.styleBtn = panel.querySelector('#yaivs-menu');
    this.styleMenu = panel.querySelector('#yaivs-style-menu');
    this.clearBtn = null;
    this.toolsRow = panel.querySelector('#yaivs-tools');
    this.copyBtn = panel.querySelector('#yaivs-copy');
    this.toggleBtn = null;
    this.onboardingEl = panel.querySelector('#yaivs-onboarding');
    this.onbGetBtn = panel.querySelector('#yaivs-onb-get');
    this.onbPasteBtn = panel.querySelector('#yaivs-onb-paste');
    this.onbTestBtn = panel.querySelector('#yaivs-onb-test');

    if (this.generateHandler) {
      this.generateBtn.removeEventListener('click', this.generateHandler);
    }
    this.generateHandler = (event) => {
      event.stopPropagation();
      this.handleSummarize();
    };
    this.generateBtn.addEventListener('click', this.generateHandler);

    if (this.promptInput) {
      this.promptInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handlePromptSubmit();
        }
      });
      this.promptInput.addEventListener('input', () => this.updateSendVisibility());
    }

    if (!panel.dataset.listenersBound) {
      panel.addEventListener('click', event => this.handleTimestampClick(event));
      panel.dataset.listenersBound = 'true';
    }

    if (this.styleBtn && this.styleMenu && !this.styleBtn.dataset.bound) {
      this.styleBtn.dataset.bound = 'true';
      this.styleBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.toggleStyleMenu();
      });
      document.addEventListener('click', () => this.hideStyleMenu());
      this.styleMenu.addEventListener('click', e => this.handleStyleMenuClick(e));
    }

    if (this.sendBtn) {
      this.sendBtn.addEventListener('click', () => this.handlePromptSubmit());
    }

    if (this.copyBtn) {
      this.copyBtn.addEventListener('click', () => this.copySummary());
    }
    if (this.onbGetBtn) this.onbGetBtn.addEventListener('click', () => this.handleOnboardingGetKey());
    if (this.onbPasteBtn) this.onbPasteBtn.addEventListener('click', () => this.handleOnboardingPaste());
    if (this.onbTestBtn) this.onbTestBtn.addEventListener('click', () => this.handleOnboardingTest());

    this.updateInfoMessage();
    this.updateOnboardingVisibility();
  }

  ensureAboveDescription(container) {
    try {
      const moveAbove = () => {
        if (!this.panel) return;
        const description = findDescriptionElement(container) || findDescriptionElement(document);
        if (!description || !description.parentElement) return;
        const parent = description.parentElement;
        const alreadyCorrect = this.panel.parentElement === parent && this.panel.nextElementSibling === description;
        if (!alreadyCorrect) {
          parent.insertBefore(this.panel, description);
        }
      };
      moveAbove();

      const target = container || document;
      const observer = new MutationObserver(() => {
        const desc = findDescriptionElement(container) || findDescriptionElement(document);
        if (desc) {
          moveAbove();
          observer.disconnect();
        }
      });
      observer.observe(target, { childList: true, subtree: true });
    } catch (err) {
      console.debug('[YAIVS v2] ensureAboveDescription failed:', err?.message || String(err));
    }
  }

  resetState() {
    if (!this.panel) return;
    if (this.summaryEl) {
      this.summaryEl.innerHTML = '';
      this.summaryEl.hidden = true;
    }
    if (this.promptInput) {
      this.promptInput.value = '';
    }
    this.updateInfoMessage();
    if (this.unifiedBtn) {
      this.unifiedBtn.disabled = false;
      const textSpan = this.unifiedBtn.querySelector('.yaivs-text');
      if (textSpan) textSpan.textContent = 'SUMMARIZE';
    }
    if (this.promptInput) this.promptInput.disabled = false;
    if (this.sendBtn) this.sendBtn.hidden = true;
    if (this.toolsRow) this.toolsRow.hidden = true;
    this.lastRawSummary = '';
    this.updateOnboardingVisibility();
  }

  async handleSummarize(overrides) {
    if (!this.unifiedBtn || this.unifiedBtn.disabled) return;
    if (this.promptInput) this.updateSendVisibility();

    const videoId = this.transcriptService.getVideoId();
    if (videoId) this.autoTriggeredVideoId = videoId;

    this.setLoading(true, 'Fetching transcript…');
    this.isSummarizing = true;

    try {
      await this.settings.ready;
      const provider = this.settings.get('provider') || 'gemini';
      const selectedMode = (overrides && overrides.summaryMode) || (this.settings.get('summaryMode') || 'bullets');
      const modeLabel = this.getModeLabel(selectedMode);
      const { text: transcript, durationSeconds } = await this.transcriptService.collect();

      this.setLoading(true, `Summarizing (${modeLabel}) with ${this.getProviderLabel(provider)}…`);
      const summary = await this.summarizeUsingProvider(provider, transcript, durationSeconds, overrides);
      this.renderSummary(summary);
      this.updateStatus(`Summary ready (${this.getProviderLabel(provider)} — ${modeLabel}).`, 'success');
    } catch (error) {
      console.error('[YAIVS v2] Summary generation failed', error);
      this.renderSummary('');
      this.updateStatus(error.message || 'Failed to generate summary.', 'error');
      chrome.runtime.sendMessage({ type: 'logError', message: error.message || String(error) }).catch(() => {});
    } finally {
      this.setLoading(false);
      this.isSummarizing = false;
    }
  }

  renderSummary(summary) {
    if (!this.summaryEl) return;
    const text = summary ? summary.toString().trim() : '';
    if (!text) {
      this.summaryEl.hidden = true;
      this.summaryEl.innerHTML = '';
      return;
    }
    this.lastRawSummary = text;
    const linkify = this.settings.get('includeTimestamps') !== false;
    this.summaryEl.innerHTML = formatSummaryHtml(text, linkify);
    this.summaryEl.hidden = false;
    if (this.toolsRow) this.toolsRow.hidden = false;
  }

  updateStatus(message, variant) {
    if (!this.statusEl) return;
    this.statusEl.textContent = message;
    this.statusEl.className = `yaivs-status yaivs-status--${variant}`;
  }

  setLoading(isLoading, message) {
    if (!this.unifiedBtn) return;
    this.unifiedBtn.disabled = isLoading;
    const textSpan = this.unifiedBtn.querySelector('.yaivs-text');
    if (textSpan) textSpan.textContent = isLoading ? 'WORKING…' : 'SUMMARIZE';
    if (this.promptInput) this.promptInput.disabled = isLoading;
    if (this.sendBtn) this.sendBtn.disabled = isLoading;
    if (message) this.updateStatus(message, 'loading');
  }

  async maybeAutoSummarize() {
    await this.settings.ready;
    if (!this.settings.get('autoSummarize')) return;
    const videoId = this.transcriptService.getVideoId();
    if (!videoId || this.autoTriggeredVideoId === videoId) return;
    if (this.unifiedBtn?.disabled || this.isSummarizing) return;
    if (!this.summaryEl?.hidden) return;
    this.handleSummarize();
  }

  async summarizeUsingProvider(provider, transcript, durationSeconds, overrides) {
    await ensureProviderKey(provider);
    const response = await chrome.runtime.sendMessage({
      type: 'summarizeVideo',
      provider,
      transcript,
      durationSeconds,
      summaryMode: (overrides && overrides.summaryMode) || (this.settings.get('summaryMode') || 'bullets'),
      customPrompt: (overrides && overrides.customPrompt) || (this.settings.get('customPrompt') || '').trim(),
      includeTimestamps: this.settings.get('includeTimestamps') !== false
    });
    if (!response) throw new Error('No response from background service.');
    if (response.status === 'error') throw new Error(response.message);
    return response.summary;
  }

  handleTimestampClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('yaivs-timestamp')) return;
    event.preventDefault();
    const seconds = Number(target.dataset.seconds || 'NaN');
    if (!Number.isFinite(seconds)) return;
    const video = document.querySelector('video');
    if (!video) return;
    video.currentTime = seconds;
    video.focus?.();
  }

  updateInfoMessage() {
    if (!this.statusEl || this.isSummarizing || !this.summaryEl?.hidden) return;
    const providerLabel = this.getProviderLabel(this.settings.get('provider') || 'gemini');
    const modeLabel = this.getModeLabel(this.settings.get('summaryMode') || 'bullets');
    if (this.settings.get('autoSummarize')) {
      this.statusEl.textContent = `Preparing summary (${modeLabel}) with ${providerLabel}…`;
      this.statusEl.className = 'yaivs-status yaivs-status--loading';
    } else {
      this.statusEl.textContent = `Click to summarize with ${providerLabel} — ${modeLabel}.`;
      this.statusEl.className = 'yaivs-status yaivs-status--info';
    }
  }

  async updateOnboardingVisibility() {
    try {
      await this.settings.ready;
      const provider = this.settings.get('provider') || 'openrouter';
      const needOnboard = await this.needsOpenRouterOnboarding(provider);
      if (this.onboardingEl) this.onboardingEl.hidden = !needOnboard;
      if (this.unifiedBtn) this.unifiedBtn.disabled = !!needOnboard;
      if (needOnboard && this.statusEl) {
        this.statusEl.textContent = 'Connect OpenRouter to start summarizing.';
        this.statusEl.className = 'yaivs-status yaivs-status--info';
      }
    } catch {}
  }

  async needsOpenRouterOnboarding(provider) {
    if (provider !== 'openrouter') return false;
    const stored = await chrome.storage.sync.get(['openrouterKey']);
    const key = (stored.openrouterKey || '').trim();
    return !key || !/^sk-or-/i.test(key);
  }

  async handleOnboardingGetKey() {
    try {
      const origin = 'https://openrouter.ai/*';
      const has = await chrome.permissions.contains({ origins: [origin] });
      if (!has) {
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) {
          this.updateStatus('Permission denied. Use Paste from clipboard.', 'error');
          return;
        }
      }
      const tab = await chrome.tabs.create({ url: 'https://openrouter.ai/keys', active: true });
      if (tab?.id) {
        setTimeout(() => {
          chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/onboarding/openrouter_sniffer.js'] }).catch(() => {});
        }, 1200);
      }
      this.updateStatus('Opened OpenRouter keys page. We will auto-detect the key.', 'success');
    } catch (e) {
      this.updateStatus('Failed to open OpenRouter keys page.', 'error');
    }
  }

  async handleOnboardingPaste() {
    try {
      const text = await navigator.clipboard.readText();
      const key = (text || '').trim();
      if (!/^sk-or-/i.test(key)) {
        this.updateStatus('Clipboard does not contain an OpenRouter key.', 'error');
        return;
      }
      await chrome.storage.sync.set({ openrouterKey: key });
      this.updateStatus('OpenRouter key saved.', 'success');
      this.updateOnboardingVisibility();
    } catch (e) {
      this.updateStatus('Clipboard blocked. Paste into Settings instead.', 'error');
    }
  }

  async handleOnboardingTest() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'testOpenRouterKey' });
      if (res?.status === 'ok') this.updateStatus('Key works ✓', 'success');
      else this.updateStatus(res?.message || 'Key test failed.', 'error');
    } catch (e) {
      this.updateStatus('Key test failed.', 'error');
    }
  }

  handleSettingsChange(_values) {
    this.updateInfoMessage();
  }

  getProviderLabel(provider) {
    switch (provider) {
      case 'gpt':
        return 'GPT';
      case 'claude':
        return 'Claude';
      case 'openrouter':
        return 'OpenRouter';
      case 'ollama':
        return 'Ollama';
      default:
        return 'Gemini';
    }
  }

  toggleStyleMenu() {
    if (!this.styleMenu) return;
    const isHidden = this.styleMenu.hasAttribute('hidden');
    if (isHidden) {
      this.styleMenu.removeAttribute('hidden');
      this.positionStyleMenu();
    } else {
      this.styleMenu.setAttribute('hidden', '');
    }
  }

  hideStyleMenu() {
    if (this.styleMenu) this.styleMenu.setAttribute('hidden', '');
  }

  positionStyleMenu() {
    if (!this.styleMenu || !this.styleBtn || !this.panel) return;
    const headerRow = this.panel.querySelector('.yaivs-header-row');
    if (!headerRow) return;
    const headerRect = headerRow.getBoundingClientRect();
    const arrowSymbol = this.styleBtn.querySelector('.yaivs-arrow');
    const targetRect = arrowSymbol ? arrowSymbol.getBoundingClientRect() : this.styleBtn.getBoundingClientRect();

    const prevLeft = this.styleMenu.style.left;
    this.styleMenu.style.left = '0px';
    const menuRect = this.styleMenu.getBoundingClientRect();

    const dropdownRect = this.styleBtn.getBoundingClientRect();
    const dropdownRight = dropdownRect.right - headerRect.left;
    const dropdownBottom = dropdownRect.bottom - headerRect.top;

    const desiredLeft = Math.round(dropdownRight - menuRect.width);
    const minLeft = 0;
    const maxLeft = Math.max(0, Math.round(headerRect.width - menuRect.width));
    const clampedLeft = Math.min(maxLeft, Math.max(minLeft, desiredLeft));

    this.styleMenu.style.left = `${clampedLeft}px`;
    this.styleMenu.style.top = `${dropdownBottom - 2}px`;
  }

  handleStyleMenuClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.tagName !== 'BUTTON') return;
    const style = target.dataset.style;
    const preset = this.getPreset(style);
    if (!preset) return;
    this.hideStyleMenu();
    this.handleSummarize(preset);
  }

  copySummary() {
    const text = this.lastRawSummary || this.summaryEl?.textContent || '';
    if (!text) return;
    navigator.clipboard?.writeText(text)
      .then(() => this.updateStatus('Copied to clipboard.', 'success'))
      .catch(() => this.updateStatus('Copy failed.', 'error'));
  }

  getPreset(style) {
    switch (style) {
      case 'simple':
        return { summaryMode: 'bullets', customPrompt: '' };
      case 'detailed':
        return { summaryMode: 'detailed', customPrompt: '' };
      case 'chapters':
        return {
          summaryMode: 'custom',
          customPrompt:
            'Summarize by chapters. For each chapter: use the chapter title as a heading with an emoji, then 2–4 bullets with timestamps for key points. If chapters are missing, approximate with sensible time ranges. Keep it concise.'
        };
      case 'proscons':
        return {
          summaryMode: 'custom',
          customPrompt:
            'Organize as two sections: "👍 Pros" and "👎 Cons". Under each, provide 3–6 concise bullets with timestamps where relevant. End with an "👉 Takeaway".'
        };
      case 'recipe':
        return {
          summaryMode: 'custom',
          customPrompt:
            'Format as a recipe: Title, Ingredients (bulleted list), then Steps (numbered with concise instructions). Include timestamps for each step if applicable. Keep it factual and concise.'
        };
      case 'outline':
        return {
          summaryMode: 'custom',
          customPrompt:
            'Produce a structured outline: I., II., III. with nested bullets (A., 1.) where helpful. Include timestamps for key segments. Keep items under ~18 words.'
        };
      default:
        return null;
    }
  }

  updateSendVisibility() {
    if (!this.promptInput || !this.sendBtn) return;
    const hasText = (this.promptInput.value || '').trim().length > 0;
    this.sendBtn.hidden = !hasText;
  }

  async handlePromptSubmit() {
    if (this.unifiedBtn?.disabled) return;
    const value = (this.promptInput?.value || '').trim();
    if (!value) return;

    this.setLoading(true, 'Fetching transcript…');
    try {
      await this.settings.ready;
      const provider = this.settings.get('provider') || 'gemini';
      const { text: transcript, durationSeconds } = await this.transcriptService.collect();
      this.setLoading(true, `Answering with ${this.getProviderLabel(provider)}…`);
      const answer = await this.askUsingProvider(provider, transcript, durationSeconds, value);
      this.renderSummary(answer);
      this.updateStatus(`Answer ready (${this.getProviderLabel(provider)}).`, 'success');
    } catch (error) {
      console.error('[YAIVS v2] Prompt failed', error);
      this.renderSummary('');
      this.updateStatus(error.message || 'Failed to answer prompt.', 'error');
      chrome.runtime.sendMessage({ type: 'logError', message: error.message || String(error) }).catch(() => {});
    } finally {
      this.setLoading(false);
    }
  }

  async askUsingProvider(provider, transcript, durationSeconds, question) {
    await ensureProviderKey(provider);
    const response = await chrome.runtime.sendMessage({
      type: 'askVideo',
      provider,
      transcript,
      durationSeconds,
      question,
      includeTimestamps: this.settings.get('includeTimestamps') !== false
    });
    if (!response) throw new Error('No response from background service.');
    if (response.status === 'error') throw new Error(response.message);
    return response.summary;
  }

  getModeLabel(mode) {
    switch (mode) {
      case 'bullets':
        return 'Bullets';
      case 'detailed':
        return 'Detailed';
      case 'chapters':
        return 'Chapters';
      case 'proscons':
        return 'Pros & Cons';
      case 'recipe':
        return 'Recipe';
      case 'outline':
        return 'Outline';
      case 'custom':
        return 'Custom';
      default:
        return 'Simple';
    }
  }
}
