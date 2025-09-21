const toggle = document.getElementById('autoSummarize');
const providerSelect = document.getElementById('provider');
const statusEl = document.getElementById('status');
// Chrome on-device summarizer removed; no language selector.
const summaryModeSelect = document.getElementById('summaryMode');
const customPromptContainer = document.getElementById('customPromptContainer');
const customPromptTextarea = document.getElementById('customPrompt');
const includeTimestampsToggle = document.getElementById('includeTimestamps');
const keyInputs = {
  gemini: document.getElementById('geminiKey'),
  gpt: document.getElementById('openaiKey'),
  claude: document.getElementById('claudeKey')
};
const keySections = Array.from(document.querySelectorAll('.key-section'));
// No Chrome language list needed.
const defaultPlaceholders = {
  gemini: keyInputs.gemini.placeholder,
  gpt: keyInputs.gpt.placeholder,
  claude: keyInputs.claude.placeholder
};

async function load() {
  try {
    const stored = await chrome.storage.sync.get([
      'autoSummarize',
      'provider',
      'geminiKey',
      'openaiKey',
      'claudeKey',
      'summaryMode',
      'customPrompt',
      'includeTimestamps'
    ]);

    toggle.checked = Boolean(stored.autoSummarize);
    providerSelect.value = stored.provider || 'gemini';

    keyInputs.gemini.value = stored.geminiKey || '';
    keyInputs.gpt.value = stored.openaiKey || '';
    keyInputs.claude.value = stored.claudeKey || '';

    // Summary mode + custom prompt
    if (summaryModeSelect) {
      const mode = typeof stored.summaryMode === 'string' ? stored.summaryMode : 'simple';
      summaryModeSelect.value = ['simple', 'detailed', 'custom'].includes(mode) ? mode : 'simple';
    }
    if (customPromptTextarea) {
      customPromptTextarea.value = (stored.customPrompt || '').toString();
    }
    toggleCustomPromptVisibility();

    updateStatus(toggle.checked);
    highlightActiveKey();
    // Timestamps preference
    if (includeTimestampsToggle) {
      includeTimestampsToggle.checked = stored.includeTimestamps !== false;
    }

    // Ensure we have persistent access to youtube.com (requests once, then persists).
    await ensureYouTubePermission();

    // Try to inject the in-page panel when popup opens on a YouTube tab.
    // Works even if site access is still "On click" before the user accepts.
    maybeInjectOnActiveYouTubeTab();
  } catch (error) {
    console.error('[YAIVS] Failed to load popup settings', error);
  }
}

function updateStatus(value) {
  statusEl.textContent = value ? 'Summaries run automatically.' : 'Click the in-page button to summarize.';
}

function highlightActiveKey() {
  const provider = providerSelect.value;
  keySections.forEach(section => {
    const sectionProvider = section.dataset.provider;
    if (sectionProvider === provider) {
      section.classList.add('active');
      const input = section.querySelector('input');
      input.disabled = false;
      input.placeholder = defaultPlaceholders[sectionProvider];
    } else {
      section.classList.remove('active');
      const input = section.querySelector('input');
      input.disabled = false;
      input.placeholder = defaultPlaceholders[sectionProvider];
    }
  });
  updateStatus(toggle.checked);
}

toggle.addEventListener('change', () => {
  const value = toggle.checked;
  chrome.storage.sync
    .set({ autoSummarize: value })
    .then(() => {
      updateStatus(value);
      highlightActiveKey();
    })
    .catch(error => console.error('[YAIVS] Failed to save popup settings', error));
});

providerSelect.addEventListener('change', () => {
  const provider = providerSelect.value;
  chrome.storage.sync
    .set({ provider })
    .then(() => highlightActiveKey())
    .catch(error => console.error('[YAIVS] Failed to save provider selection', error));
});

if (summaryModeSelect) {
  summaryModeSelect.addEventListener('change', () => {
    const value = summaryModeSelect.value;
    const mode = ['simple', 'detailed', 'custom'].includes(value) ? value : 'simple';
    chrome.storage.sync
      .set({ summaryMode: mode })
      .then(() => toggleCustomPromptVisibility())
      .catch(error => console.error('[YAIVS] Failed to save summary mode', error));
  });
}

if (customPromptTextarea) {
  const handler = () => {
    const value = customPromptTextarea.value.trim();
    chrome.storage.sync
      .set({ customPrompt: value })
      .catch(error => console.error('[YAIVS] Failed to save custom prompt', error));
  };
  customPromptTextarea.addEventListener('change', handler);
  customPromptTextarea.addEventListener('blur', handler);
}

if (includeTimestampsToggle) {
  includeTimestampsToggle.addEventListener('change', () => {
    const value = Boolean(includeTimestampsToggle.checked);
    chrome.storage.sync
      .set({ includeTimestamps: value })
      .catch(error => console.error('[YAIVS] Failed to save includeTimestamps', error));
  });
}

// No Chrome language selection

Object.entries(keyInputs).forEach(([provider, input]) => {
  input.addEventListener('change', () => {
    const value = input.value.trim();
    const keyName = provider === 'gpt' ? 'openaiKey' : provider === 'claude' ? 'claudeKey' : 'geminiKey';
    chrome.storage.sync
      .set({ [keyName]: value })
      .catch(error => console.error(`[YAIVS] Failed to save ${provider} key`, error));
  });
});

load();

// No language state toggling needed.

function toggleCustomPromptVisibility() {
  if (!customPromptContainer || !summaryModeSelect) return;
  const isCustom = summaryModeSelect.value === 'custom';
  customPromptContainer.hidden = !isCustom;
}

async function maybeInjectOnActiveYouTubeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url) return;
    const url = tab.url;
    const isYouTube = /https?:\/\/(?:www\.|m\.)?youtube\.com\//i.test(url);
    if (!isYouTube) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/index.js']
    });
  } catch (error) {
    console.debug('[YAIVS] Injection skipped/failed (likely already injected):', error?.message || String(error));
  }
}

async function ensureYouTubePermission() {
  try {
    const origin = 'https://www.youtube.com/*';
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      // User declined. We can still inject on click via activeTab.
      return;
    }
    // If granted, content scripts will auto-run on future YouTube pages.
  } catch (err) {
    // Ignore; permission request may fail in older Chrome or restricted contexts.
  }
}
