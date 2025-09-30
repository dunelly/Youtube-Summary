// Settings manager (copied from v1; unchanged behavior)

export const DEFAULT_SETTINGS = {
  autoSummarize: false,
  provider: 'openrouter',
  summaryMode: 'bullets',
  customPrompt: '',
  includeTimestamps: true,
  summaryCount: 0,
  isPremium: false,
  premiumCode: '',
  dailyCount: 0,
  lastResetDate: null
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
        'premiumCode',
        'dailyCount',
        'lastResetDate'
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
      this.values.dailyCount = typeof stored.dailyCount === 'number' ? stored.dailyCount : this.defaults.dailyCount;
      this.values.lastResetDate = stored.lastResetDate || this.defaults.lastResetDate;
    } catch (error) {
      console.warn('[YAIVS] Failed to load settings', error);
      this.values.provider = this.defaults.provider || 'gemini';
      this.values.summaryMode = this.defaults.summaryMode || 'bullets';
      this.values.customPrompt = this.defaults.customPrompt || '';
      this.values.includeTimestamps = true;
      this.values.summaryCount = this.defaults.summaryCount || 0;
      this.values.isPremium = this.defaults.isPremium || false;
      this.values.premiumCode = this.defaults.premiumCode || '';
      this.values.dailyCount = this.defaults.dailyCount || 0;
      this.values.lastResetDate = this.defaults.lastResetDate || null;
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

    if (Object.prototype.hasOwnProperty.call(changes, 'dailyCount')) {
      this.values.dailyCount = typeof changes.dailyCount.newValue === 'number' ? changes.dailyCount.newValue : 0;
      patched = true;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'lastResetDate')) {
      this.values.lastResetDate = changes.lastResetDate.newValue || null;
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
    // Check if we need to reset daily count (new day)
    const today = new Date().toDateString();
    if (this.values.lastResetDate !== today) {
      await chrome.storage.sync.set({
        dailyCount: 1,
        lastResetDate: today,
        summaryCount: this.values.summaryCount + 1
      });
      this.values.dailyCount = 1;
      this.values.lastResetDate = today;
      this.values.summaryCount = this.values.summaryCount + 1;
    } else {
      const newCount = this.values.summaryCount + 1;
      const newDailyCount = this.values.dailyCount + 1;
      await chrome.storage.sync.set({
        summaryCount: newCount,
        dailyCount: newDailyCount
      });
      this.values.summaryCount = newCount;
      this.values.dailyCount = newDailyCount;
    }
    return this.values.summaryCount;
  }

  canUseSummary() {
    if (this.values.isPremium) return true;

    // First 150 summaries are always available
    if (this.values.summaryCount < 150) return true;

    // After 150, check daily limit
    const today = new Date().toDateString();
    if (this.values.lastResetDate !== today) {
      // New day, reset available
      return true;
    }

    // Check if under daily limit of 10
    return this.values.dailyCount < 10;
  }

  getRemainingCount() {
    if (this.values.isPremium) return 'unlimited';

    // Before hitting 150, show total remaining
    if (this.values.summaryCount < 150) {
      return Math.max(0, 150 - this.values.summaryCount);
    }

    // After 150, show daily remaining
    const today = new Date().toDateString();
    if (this.values.lastResetDate !== today) {
      return 10; // New day, all 10 available
    }
    return Math.max(0, 10 - this.values.dailyCount);
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
