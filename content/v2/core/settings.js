// Settings manager (copied from v1; unchanged behavior)

export const DEFAULT_SETTINGS = {
  autoSummarize: false,
  provider: 'openrouter',
  summaryMode: 'bullets',
  customPrompt: '',
  includeTimestamps: true,
  summaryCount: 0,
  isPremium: false,
  premiumCode: ''
};

export class SettingsManager {
  constructor(defaults = DEFAULT_SETTINGS) {
    this.defaults = { ...defaults };
    this.values = { ...defaults };
    this.ready = this.load();
    chrome.storage.onChanged.addListener(this.handleStorageChange.bind(this));
  }

  async load() {
    try {
      const stored = await chrome.storage.sync.get([
        'autoSummarize',
        'provider',
        'summaryMode',
        'customPrompt',
        'includeTimestamps',
        'summaryCount',
        'isPremium',
        'premiumCode'
      ]);
      if (Object.prototype.hasOwnProperty.call(stored, 'autoSummarize')) {
        this.values.autoSummarize = Boolean(stored.autoSummarize);
      }
      this.values.provider = stored.provider || this.defaults.provider || 'gemini';
      this.values.summaryMode = stored.summaryMode || this.defaults.summaryMode || 'bullets';
      this.values.customPrompt = stored.customPrompt || this.defaults.customPrompt || '';
      this.values.includeTimestamps = stored.includeTimestamps !== false;
      this.values.summaryCount = typeof stored.summaryCount === 'number' ? stored.summaryCount : this.defaults.summaryCount;
      this.values.isPremium = Boolean(stored.isPremium);
      this.values.premiumCode = stored.premiumCode || this.defaults.premiumCode || '';
    } catch (error) {
      console.warn('[YAIVS] Failed to load settings', error);
      this.values.provider = this.defaults.provider || 'gemini';
      this.values.summaryMode = this.defaults.summaryMode || 'bullets';
      this.values.customPrompt = this.defaults.customPrompt || '';
      this.values.includeTimestamps = true;
      this.values.summaryCount = this.defaults.summaryCount || 0;
      this.values.isPremium = this.defaults.isPremium || false;
      this.values.premiumCode = this.defaults.premiumCode || '';
    }
    return this.values;
  }

  handleStorageChange(changes, area) {
    if (area !== 'sync') return;
    let patched = false;

    if (Object.prototype.hasOwnProperty.call(changes, 'autoSummarize')) {
      this.values.autoSummarize = Boolean(changes.autoSummarize.newValue);
      patched = true;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'provider')) {
      this.values.provider = changes.provider.newValue || 'gemini';
      patched = true;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'summaryMode')) {
      this.values.summaryMode = changes.summaryMode.newValue || 'bullets';
      patched = true;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'customPrompt')) {
      this.values.customPrompt = changes.customPrompt.newValue || '';
      patched = true;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'includeTimestamps')) {
      this.values.includeTimestamps = Boolean(changes.includeTimestamps.newValue);
      patched = true;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'summaryCount')) {
      this.values.summaryCount = typeof changes.summaryCount.newValue === 'number' ? changes.summaryCount.newValue : 0;
      patched = true;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'isPremium')) {
      this.values.isPremium = Boolean(changes.isPremium.newValue);
      patched = true;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'premiumCode')) {
      this.values.premiumCode = changes.premiumCode.newValue || '';
      patched = true;
    }

    if (patched && typeof this.onChange === 'function') {
      this.onChange({ ...this.values });
    }
  }

  get(key) {
    return this.values[key];
  }

  subscribe(callback) {
    this.onChange = callback;
  }

  // Usage tracking methods
  async incrementSummaryCount() {
    const newCount = this.values.summaryCount + 1;
    await chrome.storage.sync.set({ summaryCount: newCount });
    this.values.summaryCount = newCount;
    return newCount;
  }

  canUseSummary() {
    return this.values.isPremium || this.values.summaryCount < 50;
  }

  getRemainingCount() {
    if (this.values.isPremium) return 'unlimited';
    return Math.max(0, 50 - this.values.summaryCount);
  }

  // Premium validation
  async validatePremiumCode(code) {
    const validCodes = ['PREMIUM2025']; // Can be expanded later
    if (validCodes.includes(code.trim().toUpperCase())) {
      await chrome.storage.sync.set({ 
        isPremium: true, 
        premiumCode: code.trim().toUpperCase() 
      });
      this.values.isPremium = true;
      this.values.premiumCode = code.trim().toUpperCase();
      return true;
    }
    return false;
  }
}
