const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_PROVIDER = 'gemini';

// ---------------------------------------------------------------------------
// Dynamic toolbar icon (colored Y)
// ---------------------------------------------------------------------------
async function setColoredYIcon() {
  try {
    const sizes = [16, 32, 48, 128];
    const images = {};
    for (const size of sizes) {
      images[size] = await generateIconImageData(size, '#E62117', '#FFFFFF', 'Y');
    }
    await chrome.action.setIcon({ imageData: images });
  } catch (e) {
    // Non-fatal; ignore if OffscreenCanvas unsupported
    console.debug('[YAIVS] setColoredYIcon failed:', e?.message || String(e));
  }
}

async function generateIconImageData(size, bgColor, fgColor, letter) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  // BG: rounded rect (slight radius)
  const r = Math.round(size * 0.18);
  roundRect(ctx, 0, 0, size, size, r);
  ctx.fillStyle = bgColor;
  ctx.fill();

  // Tiny stars (gold) around the Y
  try {
    const gold = '#FFD54D';
    const s = size;
    const base = Math.max(1, Math.round(s * 0.06)); // outer radius
    const inner = Math.max(1, Math.round(base * 0.48));
    // positions relative to size
    const stars = [
      { x: Math.round(s * 0.24), y: Math.round(s * 0.22), scale: 1.0, rot: -0.3 },
      { x: Math.round(s * 0.76), y: Math.round(s * 0.26), scale: 0.9, rot: 0.4 },
      { x: Math.round(s * 0.78), y: Math.round(s * 0.78), scale: 0.85, rot: 0.0 }
    ];
    for (const star of stars) {
      drawStar(
        ctx,
        star.x,
        star.y,
        5,
        Math.max(1, Math.round(base * star.scale)),
        Math.max(1, Math.round(inner * star.scale)),
        gold,
        star.rot
      );
    }
  } catch {}

  // Letter Y
  ctx.fillStyle = fgColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(size * 0.68)}px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
  ctx.fillText(letter, size / 2, Math.round(size * 0.56));

  return ctx.getImageData(0, 0, size, size);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.floor(Math.min(w, h) / 2)));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius, color, rotation = 0) {
  let rot = Math.PI / 2 * 3 + rotation;
  let x = cx;
  let y = cy;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = Math.max(0, Math.round(outerRadius * 0.5));
  ctx.fill();
  // reset shadow
  ctx.shadowBlur = 0;
}

chrome.runtime.onInstalled.addListener(() => {
  setColoredYIcon();
});

chrome.runtime.onStartup?.addListener?.(() => {
  setColoredYIcon();
});

async function summarizeVideo({ provider = DEFAULT_PROVIDER, transcript, durationSeconds = 0, summaryMode, customPrompt, includeTimestamps }) {
  const settings = await chrome.storage.sync.get(['geminiKey', 'openaiKey', 'claudeKey', 'openrouterKey', 'openrouterModel', 'ollamaUrl', 'ollamaModel', 'summaryMode', 'customPrompt', 'includeTimestamps']);
  const selectedMode = typeof summaryMode === 'string' ? summaryMode : settings.summaryMode;
  const storedCustom = typeof customPrompt === 'string' ? customPrompt : settings.customPrompt;
  const mode = ['simple', 'bullets', 'detailed', 'chapters', 'proscons', 'recipe', 'outline', 'custom'].includes(selectedMode) ? selectedMode : 'simple';
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
    case 'openrouter':
      return summarizeWithOpenRouter(userText, settings.openrouterKey, settings.openrouterModel);
    case 'ollama':
      return summarizeWithOllama(userText, settings.ollamaUrl, settings.ollamaModel);
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

  if (mode === 'chapters') {
    const lines = [
      ...sharedGeneral,
      'Summarize by chapters. For each chapter: use the chapter title as a heading with an emoji, then 2–4 bullets with timestamps for key points. If chapters are missing, approximate with sensible time ranges. Keep it concise.',
      includeTimestamps ? timeHints : ''
    ];
    return lines.filter(Boolean).join('\n');
  }

  if (mode === 'proscons') {
    const lines = [
      ...sharedGeneral,
      'Organize as two sections: "👍 Pros" and "👎 Cons". Under each, provide 3–6 concise bullets with timestamps where relevant. End with an "👉 Takeaway".',
      includeTimestamps ? timeHints : ''
    ];
    return lines.filter(Boolean).join('\n');
  }

  if (mode === 'recipe') {
    const lines = [
      ...sharedGeneral,
      'Format as a recipe: Title, Ingredients (bulleted list), then Steps (numbered with concise instructions). Include timestamps for each step if applicable. Keep it factual and concise.',
      includeTimestamps ? timeHints : ''
    ];
    return lines.filter(Boolean).join('\n');
  }

  if (mode === 'outline') {
    const lines = [
      ...sharedGeneral,
      'Produce a structured outline: I., II., III. with nested bullets (A., 1.) where helpful. Include timestamps for key segments. Keep items under ~18 words.',
      includeTimestamps ? timeHints : ''
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

  if (mode === 'bullets') {
    // Same as simple mode
    const lines = [
      ...sharedGeneral,
      includeTimestamps ? 'Include timestamps in [mm:ss] or [hh:mm:ss] when possible.' : 'Do not include timestamps.',
      'Use 5–7 thematic sections relevant to the transcript. Each heading must begin with an expressive emoji, a space, and a short label.',
      'Do not invent or include irrelevant categories. Never add empty or "N/A" sections.',
      'Under each heading produce 2–4 factual bullets. Each bullet must start with a single tab character followed by "• " (example: "\\t• Brighter 3,000-nit display.").',
      'Keep bullets under ~18 words.',
      'Finish with an "👉 Takeaway" section summarizing the key conclusion.',
      'Call out uncertainties or missing transcript portions inside the affected section/bullet.',
      includeTimestamps ? timeHints : '',
      'Do not append questions or calls-to-action after the "👉 Takeaway" section.'
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
  const settings = await chrome.storage.sync.get(['geminiKey', 'openaiKey', 'claudeKey', 'openrouterKey', 'openrouterModel', 'ollamaUrl', 'ollamaModel']);
  const prompt = buildQuestionPrompt(question, durationSeconds, includeTimestamps !== false);
  const userText = [prompt, '', 'Transcript:', transcript].join('\n');

  switch (provider) {
    case 'gpt':
      return summarizeWithOpenAI(userText, settings.openaiKey);
    case 'claude':
      return summarizeWithAnthropic(userText, settings.claudeKey);
    case 'openrouter':
      return summarizeWithOpenRouter(userText, settings.openrouterKey, settings.openrouterModel);
    case 'ollama':
      return summarizeWithOllama(userText, settings.ollamaUrl, settings.ollamaModel);
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

async function summarizeWithOpenRouter(prompt, key, model) {
  if (!key) {
    throw new Error('OpenRouter API key is missing.');
  }
  const chosenModel = (model && String(model)) || 'google/gemma-2-9b-it:free';
  const body = {
    model: chosenModel,
    messages: [
      { role: 'system', content: 'You are a helpful assistant that summarizes YouTube transcripts.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3
  };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    // Optional but recommended by OpenRouter for attribution/rate-limits friendliness
    'HTTP-Referer': chrome.runtime.getURL('popup.html'),
    'X-Title': 'YouTube AI Video Summarizer'
  };

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  const summary = data?.choices?.[0]?.message?.content || '';
  if (!summary.trim()) throw new Error('OpenRouter response was empty.');
  return summary;
}

async function summarizeWithOllama(prompt, url, model) {
  if (!url) {
    throw new Error('Ollama server URL is missing.');
  }
  
  const ollamaUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  const endpoint = `${ollamaUrl}/api/generate`;
  
  const requestBody = {
    model: model || 'llama3.2',
    prompt: prompt,
    stream: false,
    options: {
      temperature: 0.3,
      top_p: 0.9
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  
  const data = await response.json();
  const summary = data?.response || '';
  if (!summary.trim()) throw new Error('Ollama response was empty.');
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
