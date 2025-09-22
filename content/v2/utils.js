// Pure helper utilities copied from v1 (unchanged behavior).
// Kept self-contained for safe refactor work in v2.

const DECODER = (() => {
  try {
    return document.createElement('textarea');
  } catch {
    return { innerHTML: '', value: '' };
  }
})();

const AUTH_PATTERNS = [
  'sign in',
  'log in',
  'to continue',
  "verify it's you",
  'switch account',
  'privacy policy',
  'terms of service',
  'try youtube premium',
  'youtube music premium',
  'confirm you are not a robot'
];

export function waitForElement(selector, timeout = 8000) {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    if (timeout) {
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for selector: ${selector}`));
      }, timeout);
    }
  });
}

export function findDescriptionElement(root = document) {
  const candidates = [
    '#description-inline-expander',
    '#description',
    'ytd-watch-metadata #description-inline-expander',
    'ytd-watch-metadata #description'
  ];
  for (const sel of candidates) {
    const el = root.querySelector?.(sel);
    if (el) return el;
  }
  return null;
}

export function decodeHtml(text) {
  if (!text) return '';
  DECODER.innerHTML = text;
  return DECODER.value;
}

export function cleanWhitespace(text) {
  return text ? text.replace(/\s+/g, ' ').trim() : '';
}

export function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatSummaryHtml(summary, linkify = true) {
  if (!summary) return '';
  const escaped = escapeHtml(summary);
  const tsPattern = /\[((\d{1,3}):(\d{2})(?::(\d{2}))?)(?:\s*[–-]\s*((\d{1,3}):(\d{2})(?::(\d{2}))?))?\]/g;

  if (!linkify) {
    return escaped.replace(tsPattern, '').replace(/\n/g, '<br>');
  }

  const withLinks = escaped.replace(
    tsPattern,
    (
      match,
      fullA,
      a1,
      a2,
      a3,
      fullB,
      b1,
      b2,
      b3
    ) => {
      const toSeconds = (hOrM, m, s) => {
        const H = Number(hOrM);
        const M = Number(m);
        const S = typeof s !== 'undefined' ? Number(s) : null;
        if ([H, M].some(Number.isNaN)) return null;
        if (S !== null && Number.isNaN(S)) return null;
        return S === null ? H * 60 + M : H * 3600 + M * 60 + S;
      };

      const secA = toSeconds(a1, a2, a3);
      if (secA === null) return match;
      const anchorA = `<a href="#" class="yaivs-timestamp" data-seconds="${secA}">${fullA}</a>`;

      if (!fullB) {
        return `[${anchorA}]`;
      }

      const secB = toSeconds(b1, b2, b3);
      if (secB === null) return `[${anchorA}]`;
      const dash = match.includes('–') ? '–' : '-';
      const anchorB = `<a href="#" class="yaivs-timestamp" data-seconds="${secB}">${fullB}</a>`;
      return `[${anchorA} ${dash} ${anchorB}]`;
    }
  );

  return withLinks.replace(/\n/g, '<br>');
}

export async function parseJsonResponse(response, label) {
  const text = await response.text();
  if (!text) {
    console.debug('[YAIVS] empty response body', label);
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.debug('[YAIVS] failed to parse JSON', label, error.message);
    return null;
  }
}

export async function fetchHtml(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to fetch YouTube page (${response.status})`);
  }
  return response.text();
}

export function containsAuthMessage(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (!AUTH_PATTERNS.some(pattern => lower.includes(pattern))) return false;
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  return wordCount < 70 || lower.length < 350;
}

export function parseTimestamp(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split(':').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const numbers = parts.map(Number);
  if (numbers.some(Number.isNaN)) return null;
  if (numbers.length === 3) return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  if (numbers.length === 2) return numbers[0] * 60 + numbers[1];
  if (numbers.length === 1) return numbers[0];
  return null;
}

export function secondsToLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `[${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
  }
  return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}

export function extractJsonFromHtml(html, key) {
  const patterns = [
    new RegExp(`window\\["${key}"\\]\\s*=\\s*({[\\s\\S]+?})\\s*;`),
    new RegExp(`var ${key}\\s*=\\s*({[\\s\\S]+?})\\s*;`),
    new RegExp(`${key}\\s*=\\s*({[\\s\\S]+?})\\s*;`)
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (error) {
        console.warn(`⚠️ Failed to parse ${key}:`, error.message);
      }
    }
  }
  return null;
}

export function getVideoIdFromUrl(urlString) {
  try {
    return new URL(urlString).searchParams.get('v');
  } catch {
    return null;
  }
}

