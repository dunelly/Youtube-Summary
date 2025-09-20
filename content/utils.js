export function waitForElement(selector, timeout = 8000) {
  const existing = document.querySelector(selector);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
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

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const DECODER = document.createElement('textarea');

export function decodeHtmlEntities(text) {
  if (!text) return '';
  DECODER.innerHTML = text;
  return DECODER.value;
}

export function normalizeWhitespace(text) {
  return text ? text.replace(/\s+/g, ' ').trim() : '';
}

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

export function containsAuthMessage(text) {
  if (!text) return false;
  const clean = text.toLowerCase();
  const hit = AUTH_PATTERNS.some(pattern => clean.includes(pattern));
  if (!hit) return false;
  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  return wordCount < 70 || clean.length < 350;
}

export function getVideoIdFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.searchParams.get('v');
  } catch (_err) {
    return null;
  }
}
