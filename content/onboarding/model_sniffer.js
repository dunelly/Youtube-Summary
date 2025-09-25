(() => {
  try {
    const m = location.pathname.match(/^\/models\/([^/?#]+)/);
    if (!m) return;
    const slug = decodeURIComponent(m[1]);
    if (!slug || !slug.includes('/')) return;
    const labelEl = document.querySelector('h1, h2');
    const label = (labelEl?.textContent || slug).trim();
    // Save into freeModelOptions for the onboarding dropdown
    chrome.storage.sync.get(['freeModelOptions']).then(({ freeModelOptions }) => {
      const list = Array.isArray(freeModelOptions) ? freeModelOptions : [];
      if (!list.find(x => x.slug === slug)) list.push({ slug, label });
      chrome.storage.sync.set({ freeModelOptions: list }).catch(() => {});
    }).catch(() => {});
  } catch {}
})();

