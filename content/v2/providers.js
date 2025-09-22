// Provider utilities (copied from v1; unchanged behavior)

export async function ensureProviderKey(provider) {
  const keyName =
    provider === 'gpt'
      ? 'openaiKey'
      : provider === 'claude'
      ? 'claudeKey'
      : provider === 'openrouter'
      ? 'openrouterKey'
      : provider === 'ollama'
      ? 'ollamaUrl'
      : 'geminiKey';

  const stored = await chrome.storage.sync.get([keyName]);
  let value = stored[keyName];

  if (!value && provider === 'gemini') {
    const entered = window.prompt('Enter your Gemini API key (stored locally in Chrome Sync):');
    if (!entered) throw new Error('Gemini API key is required to summarize.');
    const trimmed = entered.trim();
    if (!trimmed) throw new Error('Gemini API key cannot be empty.');
    await chrome.storage.sync.set({ [keyName]: trimmed });
    value = trimmed;
  }

  if (!value) {
    const label =
      provider === 'gpt'
        ? 'OpenAI'
        : provider === 'claude'
        ? 'Anthropic'
        : provider === 'openrouter'
        ? 'OpenRouter'
        : provider === 'ollama'
        ? 'Ollama'
        : 'Gemini';
    throw new Error(`${label} API key is required. Add it from the extension popup.`);
  }

  return value;
}

