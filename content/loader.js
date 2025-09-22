(async () => {
  try {
    // Prevent duplicate mounts
    const ROOT = document.documentElement;
    if (ROOT && ROOT.hasAttribute('data-yaivs-active')) return;
    const url = chrome.runtime.getURL('content/v2/app.js');
    await import(url);
  } catch (e) {
    console.warn('[YAIVS] Loader failed to import v2 app:', e?.message || e);
  }
})();

