export async function ensureGeminiKey() {
  const { geminiKey } = await chrome.storage.sync.get(['geminiKey']);
  if (geminiKey) {
    return geminiKey;
  }

  const entered = window.prompt(
    'Enter your Gemini 1.5 Flash API key (stored locally in Chrome Sync):'
  );

  if (!entered) {
    throw new Error('Gemini API key is required to summarize.');
  }

  const trimmed = entered.trim();
  if (!trimmed) {
    throw new Error('Gemini API key cannot be empty.');
  }

  const response = await chrome.runtime.sendMessage({
    type: 'saveGeminiKey',
    key: trimmed
  });

  if (!response || response.status !== 'ok') {
    throw new Error(response?.message || 'Failed to save Gemini API key.');
  }

  return trimmed;
}
