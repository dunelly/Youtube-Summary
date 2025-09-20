const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

async function saveGeminiKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid Gemini API key.');
  }
  await chrome.storage.sync.set({ geminiKey: key.trim() });
}

function formatTimestamp(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00';
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

function buildPromptInstructions(mode, durationSeconds) {
  const lines = [
    'Summarize the video in a polished ChatGPT recap style.',
    'Return only plain text (no markdown tables). Follow these rules:',
    '',
    '• Use 5-7 sections total.',
    '• Start every section title with an expressive emoji and a short label (e.g. "📦 Unboxing").',
    '• After each title, list 2-4 concise bullet points using the "• " glyph. Keep each bullet under ~18 words.',
    '• Mention any missing transcript portions or uncertainties inside the section they affect.'
  ];

  const totalSeconds = Number(durationSeconds) || 0;
  if (totalSeconds > 0) {
    const firstEnd = Math.max(Math.floor(totalSeconds / 3), Math.min(totalSeconds, 300));
    let secondEnd = Math.floor((2 * totalSeconds) / 3);
    if (secondEnd <= firstEnd) {
      secondEnd = Math.min(totalSeconds - 60, firstEnd + 300);
    }
    if (secondEnd < firstEnd) {
      secondEnd = firstEnd;
    }
    const openingRange = `[00:00–${formatTimestamp(firstEnd)}]`;
    const midpointRange = `[${formatTimestamp(firstEnd)}–${formatTimestamp(secondEnd)}]`;
    const finalRange = `[${formatTimestamp(secondEnd)}–${formatTimestamp(totalSeconds)}]`;

    lines.push(
      `• Include a section covering the opening ${openingRange} (setup, guest intro, initial themes).`,
      `• Include a section covering the midpoint ${midpointRange} (major developments or turning points).`,
      `• Include a section covering the final stretch ${finalRange} (closing arguments, conclusions, or calls to action).`
    );
  }

  lines.push(
    '• Add timestamps in [mm:ss] (or [hh:mm:ss]) for every bullet when possible, including the concluding segment.',
    '• The final section title must be "👉 Takeaway" and contain 2-3 bullets that capture the overall verdict. Do not add questions or calls-to-action afterwards.'
  );

  return lines.join('\n');
}

async function summarizeWithGemini(transcript, durationSeconds = 0) {
  const { geminiKey } = await chrome.storage.sync.get(['geminiKey']);
  if (!geminiKey) {
    throw new Error('Gemini API key not found. Click summarize again and enter your key.');
  }

  const instructions = buildPromptInstructions('simple', durationSeconds);

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [instructions, '', 'Transcript:', transcript].join('\n')
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
    summarizeWithGemini(request.transcript, request.durationSeconds)
      .then(summary => sendResponse({ status: 'ok', summary }))
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true;
  }

  if (request?.type === 'logError') {
    console.error('Content script error:', request.message);
  }

  return undefined;
});
