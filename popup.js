const toggle = document.getElementById('autoSummarize');
const providerSelect = document.getElementById('provider');
const statusEl = document.getElementById('status');
const keyInputs = {
  gemini: document.getElementById('geminiKey'),
  gpt: document.getElementById('openaiKey'),
  claude: document.getElementById('claudeKey')
};

async function load() {
  try {
    const stored = await chrome.storage.sync.get([
      'autoSummarize',
      'provider',
      'geminiKey',
      'openaiKey',
      'claudeKey'
    ]);

    toggle.checked = Boolean(stored.autoSummarize);
    providerSelect.value = stored.provider || 'gemini';

    keyInputs.gemini.value = stored.geminiKey || '';
    keyInputs.gpt.value = stored.openaiKey || '';
    keyInputs.claude.value = stored.claudeKey || '';

    updateStatus(toggle.checked);
    highlightActiveKey();
  } catch (error) {
    console.error('[YAIVS] Failed to load popup settings', error);
  }
}

function updateStatus(value) {
  statusEl.textContent = value ? 'Summaries run automatically.' : 'Click the in-page button to summarize.';
}

function highlightActiveKey() {
  const sections = document.querySelectorAll('.key-section');
  sections.forEach(section => section.classList.remove('active'));
  const activeInput = keyInputs[providerSelect.value];
  if (activeInput) {
    activeInput.closest('.key-section')?.classList.add('active');
  }
}

toggle.addEventListener('change', () => {
  const value = toggle.checked;
  chrome.storage.sync
    .set({ autoSummarize: value })
    .then(() => updateStatus(value))
    .catch(error => console.error('[YAIVS] Failed to save popup settings', error));
});

providerSelect.addEventListener('change', () => {
  const provider = providerSelect.value;
  chrome.storage.sync
    .set({ provider })
    .then(() => highlightActiveKey())
    .catch(error => console.error('[YAIVS] Failed to save provider selection', error));
});

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
