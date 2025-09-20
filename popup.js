const toggle = document.getElementById('autoSummarize');
const statusEl = document.getElementById('status');

async function load() {
  try {
    const { autoSummarize } = await chrome.storage.sync.get(['autoSummarize']);
    toggle.checked = Boolean(autoSummarize);
    updateStatus(toggle.checked);
  } catch (error) {
    console.error('[YAIVS] Failed to load popup settings', error);
  }
}

function updateStatus(value) {
  statusEl.textContent = value ? 'Summaries run automatically.' : 'Click the in-page button to summarize.';
}

toggle.addEventListener('change', () => {
  const value = toggle.checked;
  chrome.storage.sync
    .set({ autoSummarize: value })
    .then(() => updateStatus(value))
    .catch(error => console.error('[YAIVS] Failed to save popup settings', error));
});

load();
