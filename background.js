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
              'Summarize the video in a polished ChatGPT recap style.',
              'Return only plain text (no markdown tables). Follow these rules:',
              '',
              '• Use 5-7 sections total.',
              '• Start every section title with an expressive emoji and a short label, for example "📦 Unboxing".',
              '• After the title, list 2-4 concise bullet points using the "• " glyph. Keep each bullet under ~18 words.',
              '• Cover the whole timeline: include at least one section for the opening, mid-point, and final portion of the video.',
              '• Add timestamps in [mm:ss] (or [hh:mm:ss]) for every bullet when possible, including the concluding segment.',
              '• Mention any missing transcript portions or uncertainties inside the relevant section.',
              '• The final section title must be "👉 Takeaway" and contain 2-3 bullets that capture the overall verdict. Do not add questions or calls-to-action afterwards.',
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

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (error) {
    throw new Error(`Gemini response parsing failed: ${error.message}`);
  }
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
