(() => {
  const KEY_REGEX = /(sk-or-[a-z0-9-]{8,})/i;
  let sent = false;

  function scanOnce() {
    if (sent) return;
    try {
      const rootText = document.body ? document.body.innerText || '' : '';
      const html = document.body ? document.body.innerHTML || '' : '';
      const input = document.querySelector('input[type="password"], input[type="text"], textarea');

      let candidate = '';
      if (input && typeof input.value === 'string' && KEY_REGEX.test(input.value)) {
        candidate = input.value.match(KEY_REGEX)?.[1] || '';
      }
      if (!candidate && KEY_REGEX.test(rootText)) {
        candidate = rootText.match(KEY_REGEX)?.[1] || '';
      }
      if (!candidate && KEY_REGEX.test(html)) {
        candidate = html.match(KEY_REGEX)?.[1] || '';
      }
      if (candidate) {
        sent = true;
        chrome.runtime.sendMessage({ type: 'saveOpenRouterKey', key: candidate }, (res) => {
          // no-op
        });
      }
    } catch {}
  }

  // Observe DOM for changes, scan a few times
  const observer = new MutationObserver(() => scanOnce());
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch {}
  // Also poll a few times for safety
  let tries = 0;
  const id = setInterval(() => {
    scanOnce();
    tries += 1;
    if (sent || tries > 60) {
      clearInterval(id);
      observer.disconnect();
    }
  }, 1000);
})();

