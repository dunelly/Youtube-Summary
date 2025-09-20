const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

async function saveGeminiKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid Gemini API key.');
  }
  await chrome.storage.sync.set({ geminiKey: key.trim() });
}

async function summarizeWithGemini(transcript) {
  const { geminiKey } = await chrome.storage.sync.get(['geminiKey']);
  if (!geminiKey) {
    throw new Error('Gemini API key not found. Click summarize again and enter your key.');
  }

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              'You are generating a concise, bullet-style summary of a YouTube video.',
              'Focus on major sections, key takeaways, and noteworthy facts.',
              'Avoid speculation, note if transcript seems incomplete.',
              '',
              'Transcript:',
              transcript
            ].join('\n')
          }
        ]
      }
    ]
  };

  const response = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const summary = data?.candidates?.[0]?.content?.parts
    ?.map(part => part.text)
    .filter(Boolean)
    .join('\n') || '';

  if (!summary.trim()) {
    throw new Error('Gemini response was empty.');
  }

  return summary;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === 'saveGeminiKey') {
    saveGeminiKey(request.key)
      .then(() => sendResponse({ status: 'ok' }))
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true;
  }

  if (request?.type === 'summarizeWithGemini') {
    summarizeWithGemini(request.transcript)
      .then(summary => sendResponse({ status: 'ok', summary }))
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true;
  }

  if (request?.type === 'logError') {
    console.error('Content script error:', request.message);
  }

  return undefined;
});
