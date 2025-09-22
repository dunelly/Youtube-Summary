// Settings manager (copied from v1; unchanged behavior)

export const DEFAULT_SETTINGS = {
  autoSummarize: false,
  provider: 'gemini',
  summaryMode: 'simple',
  customPrompt: '',
  includeTimestamps: true
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
        'includeTimestamps'
      ]);
      if (Object.prototype.hasOwnProperty.call(stored, 'autoSummarize')) {
        this.values.autoSummarize = Boolean(stored.autoSummarize);
      }
      this.values.provider = stored.provider || this.defaults.provider || 'gemini';
      this.values.summaryMode = stored.summaryMode || this.defaults.summaryMode || 'simple';
      this.values.customPrompt = stored.customPrompt || this.defaults.customPrompt || '';
      this.values.includeTimestamps = stored.includeTimestamps !== false;
    } catch (error) {
      console.warn('[YAIVS] Failed to load settings', error);
      this.values.provider = this.defaults.provider || 'gemini';
      this.values.summaryMode = this.defaults.summaryMode || 'simple';
      this.values.customPrompt = this.defaults.customPrompt || '';
      this.values.includeTimestamps = true;
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
      this.values.summaryMode = changes.summaryMode.newValue || 'simple';
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
}

