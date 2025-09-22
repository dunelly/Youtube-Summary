// Loader that chooses v1 (current) or v2 (experimental) content script.
// Default: v1. Enable v2 by setting chrome.storage.local.useExperimentalRefactor = true
// or localStorage.YAIVS_USE_V2 = '1' for quick dev override.

async function shouldUseV2() {
  try {
    const override = localStorage.getItem('YAIVS_USE_V2');
    if (override === '1' || override === 'true') return true;
    if (override === '0' || override === 'false') return false;
  } catch {}
  try {
    const { useExperimentalRefactor } = await chrome.storage.local.get(['useExperimentalRefactor']);
    return Boolean(useExperimentalRefactor);
  } catch {
    return false;
  }
}

(async () => {
  // Avoid double-injection if something already mounted.
  const ROOT = document.documentElement;
  if (ROOT && ROOT.hasAttribute('data-yaivs-active')) {
    console.debug('[YAIVS] Already active; skipping loader.');
    return;
  }
  let useV2 = false;
  try {
    useV2 = await shouldUseV2();
  } catch (e) {
    useV2 = false;
  }
  if (useV2) {
    try {
      await import('./v2/app.js');
      return;
    } catch (e) {
      console.warn('[YAIVS] v2 failed to load, falling back to v1:', e?.message || e);
    }
  }
  try {
    await import('./v1/app.js');
  } catch (e) {
    console.error('[YAIVS] Failed to load v1 app:', e?.message || e);
  }
})();

