const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const DEFAULT_PROVIDER = 'gemini';

async function summarizeVideo({ provider = DEFAULT_PROVIDER, transcript, durationSeconds = 0, summaryMode, customPrompt, includeTimestamps }) {
  const settings = await chrome.storage.sync.get(['geminiKey', 'openaiKey', 'claudeKey', 'summaryMode', 'customPrompt', 'includeTimestamps']);
  const selectedMode = typeof summaryMode === 'string' ? summaryMode : settings.summaryMode;
  const storedCustom = typeof customPrompt === 'string' ? customPrompt : settings.customPrompt;
  const mode = ['simple', 'detailed', 'custom'].includes(selectedMode) ? selectedMode : 'simple';
  const custom = (storedCustom || '').toString().trim();
  const effectiveMode = mode === 'custom' && !custom ? 'simple' : mode;
  const useTimestamps = includeTimestamps !== false && settings.includeTimestamps !== false;
  const prompt = buildPromptInstructions(effectiveMode, durationSeconds, custom, useTimestamps);
  const userText = [prompt, '', 'Transcript:', transcript].join('\n');

  switch (provider) {
    case 'gpt':
      return summarizeWithOpenAI(userText, settings.openaiKey);
    case 'claude':
      return summarizeWithAnthropic(userText, settings.claudeKey);
    default:
      return summarizeWithGemini(userText, settings.geminiKey);
  }
}

function buildPromptInstructions(mode, durationSeconds, customPrompt, includeTimestamps = true) {
  const total = Number(durationSeconds) || 0;
  const timeHints = buildTimeHints(total);
  const sharedGeneral = [
    'Summarize this YouTube video for a time-pressed viewer. Return plain text only (no tables).',
    'Be factual and neutral; do not mention the presenter or say "the reviewer".'
  ];

  if (mode === 'detailed') {
    const lines = [
      ...sharedGeneral,
      'Write 4–6 concise paragraphs grouped by theme. Prefer clear prose over bullets.',
      'Do not include timestamps.',
      'Do not include thumbnails or images.',
      'Cover design/build, display/audio, cameras, performance & thermals, battery/charging, and end with a clear takeaway.',
      'Note uncertainties or missing transcript details inline where relevant.'
    ];
    return lines.filter(Boolean).join('\n');
  }

  if (mode === 'custom' && customPrompt) {
    const lines = [
      `User instructions (apply first): ${customPrompt}`,
      ...sharedGeneral,
      includeTimestamps ? 'Include timestamps in [mm:ss] or [hh:mm:ss] when possible (unless the user specifies otherwise).' : 'Do not include timestamps.',
      'If the user instructions conflict with formatting guidance, follow the user. Emoji/bullet style is optional unless requested.',
      'Keep writing tight, avoid fluff. If structure is unspecified, 5–7 short sections are acceptable.',
      includeTimestamps ? timeHints : ''
    ];
    return lines.filter(Boolean).join('\n');
  }

  // simple (default)
  const lines = [
    ...sharedGeneral,
    includeTimestamps ? 'Include timestamps in [mm:ss] or [hh:mm:ss] when possible.' : 'Do not include timestamps.',
    'Use 5–7 thematic sections relevant to the transcript. Each heading must begin with an expressive emoji, a space, and a short label.',
    'Do not invent or include irrelevant categories. Never add empty or "N/A" sections.',
    'Under each heading produce 2–4 factual bullets. Each bullet must start with a single tab character followed by "• " (example: "\t• Brighter 3,000-nit display.").',
    'Keep bullets under ~18 words.',
    'Finish with an "👉 Takeaway" section summarizing the key conclusion.',
    'Call out uncertainties or missing transcript portions inside the affected section/bullet.',
    includeTimestamps ? timeHints : '',
    'Do not append questions or calls-to-action after the "👉 Takeaway" section.'
  ];
  return lines.filter(Boolean).join('\n');
}

function buildTimeHints(total) {
  if (total <= 0) return '';
  const firstEnd = Math.max(Math.floor(total / 3), Math.min(total, 300));
  let secondEnd = Math.floor((2 * total) / 3);
  if (secondEnd <= firstEnd) {
    secondEnd = Math.min(total - 60, firstEnd + 300);
  }
  if (secondEnd < firstEnd) {
    secondEnd = firstEnd;
  }
  const openingRange = `[00:00–${formatTimestamp(firstEnd)}]`;
  const midpointRange = `[${formatTimestamp(firstEnd)}–${formatTimestamp(secondEnd)}]`;
  const finalRange = `[${formatTimestamp(secondEnd)}–${formatTimestamp(total)}]`;
  return [
    `• Include a section covering the opening ${openingRange} (setup, guest intro, initial themes).`,
    `• Include a section covering the midpoint ${midpointRange} (major developments or turning points).`,
    `• Include a section covering the final stretch ${finalRange} (closing arguments, conclusions, or calls to action).`
  ].join('\n');
}

async function askVideo({ provider = DEFAULT_PROVIDER, transcript, durationSeconds = 0, question, includeTimestamps }) {
  const settings = await chrome.storage.sync.get(['geminiKey', 'openaiKey', 'claudeKey']);
  const prompt = buildQuestionPrompt(question, durationSeconds, includeTimestamps !== false);
  const userText = [prompt, '', 'Transcript:', transcript].join('\n');

  switch (provider) {
    case 'gpt':
      return summarizeWithOpenAI(userText, settings.openaiKey);
    case 'claude':
      return summarizeWithAnthropic(userText, settings.claudeKey);
    default:
      return summarizeWithGemini(userText, settings.geminiKey);
  }
}

function buildQuestionPrompt(question, durationSeconds, includeTimestamps = true) {
  const q = (question || '').toString().trim();
  const total = Number(durationSeconds) || 0;
  const timeHint = includeTimestamps && total > 0 ? 'Include timestamps in [mm:ss] or [hh:mm:ss] when citing specific moments.' : 'Do not include timestamps when answering.';
  const lines = [
    'You are answering a user question using ONLY the YouTube video transcript provided below.',
    `Question: ${q}`,
    'Give a clear, concise answer grounded in the transcript. If not answerable, say "Not found in transcript."',
    timeHint
  ];
  return lines.filter(Boolean).join('\n');
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

async function summarizeWithGemini(prompt, key) {
  if (!key) {
    throw new Error('Gemini API key is missing.');
  }

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ]
  };

  const response = await fetch(`${GEMINI_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function summarizeWithOpenAI(prompt, key) {
  if (!key) {
    throw new Error('OpenAI API key is missing.');
  }

  const body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a helpful assistant that summarizes YouTube transcripts.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3
  };

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const summary = data?.choices?.[0]?.message?.content || '';
  if (!summary.trim()) {
    throw new Error('OpenAI response was empty.');
  }
  return summary;
}

async function summarizeWithAnthropic(prompt, key) {
  if (!key) {
    throw new Error('Anthropic API key is missing.');
  }

  const body = {
    model: 'claude-3-sonnet-20240229',
    max_output_tokens: 1200,
    temperature: 0.3,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }]
      }
    ]
  };

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const summary = data?.content?.[0]?.text || '';
  if (!summary.trim()) {
    throw new Error('Anthropic response was empty.');
  }
  return summary;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === 'saveGeminiKey') {
    const key = request.key?.trim();
    if (!key) {
      sendResponse({ status: 'error', message: 'Gemini key cannot be empty.' });
      return true;
    }
    chrome.storage.sync
      .set({ geminiKey: key })
      .then(() => sendResponse({ status: 'ok' }))
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true;
  }

  if (request?.type === 'summarizeVideo') {
    if (request.provider === 'chrome') {
      sendResponse({ status: 'error', message: 'Chrome summarizer is handled in the content script.' });
      return true;
    }
    summarizeVideo(request)
      .then(summary => sendResponse({ status: 'ok', summary }))
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true;
  }

  if (request?.type === 'askVideo') {
    askVideo(request)
      .then(summary => sendResponse({ status: 'ok', summary }))
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true;
  }

  if (request?.type === 'logError') {
    console.error('Content script error:', request.message);
  }

  return undefined;
});
