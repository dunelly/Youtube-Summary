// Experimental refactor entrypoint (v2).
// For now, this is a no-op placeholder that just marks the page as active.
(() => {
  try {
    const ROOT = document.documentElement;
    if (ROOT && !ROOT.hasAttribute('data-yaivs-active')) {
      ROOT.setAttribute('data-yaivs-active', 'true');
    }
    console.info('[YAIVS] Experimental v2 loaded (placeholder).');
  } catch (e) {
    console.warn('[YAIVS] v2 init failed:', e?.message || e);
  }
})();

