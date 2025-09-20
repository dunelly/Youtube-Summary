const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const DEFAULT_PROVIDER = 'gemini';

async function summarizeVideo({ provider = DEFAULT_PROVIDER, transcript, durationSeconds = 0 }) {
  const settings = await chrome.storage.sync.get(['geminiKey', 'openaiKey', 'claudeKey']);
  const prompt = buildPromptInstructions(durationSeconds);
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

function buildPromptInstructions(durationSeconds) {
  const lines = [
    'Summarize the video in a polished ChatGPT recap style.',
    'Return only plain text (no markdown tables). Follow these rules:',
    '',
    '• Use 5-7 sections total.',
    '• Start every section title with an expressive emoji and a short label (e.g. "📦 Unboxing").',
    '• After each title, list 2-4 concise bullet points using the "• " glyph. Keep each bullet under ~18 words.',
    '• Mention any missing transcript portions or uncertainties inside the section they affect.'
  ];

  const total = Number(durationSeconds) || 0;
  if (total > 0) {
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
    summarizeVideo(request)
      .then(summary => sendResponse({ status: 'ok', summary }))
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true;
  }

  if (request?.type === 'logError') {
    console.error('Content script error:', request.message);
  }

  return undefined;
});
