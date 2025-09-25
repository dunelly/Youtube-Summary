(() => {
  console.log('[YAIVS Guide] OpenRouter guide script loaded');
  
  const STYLE = `
    .yaivs-guide { position: fixed; right: 16px; bottom: 16px; max-width: 360px; z-index: 999999; background: rgba(20,20,20,0.92); color: #eaeaea; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); padding: 12px 14px; font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
    .yaivs-guide h3 { margin: 0 0 6px; font-size: 15px; }
    .yaivs-guide p { margin: 4px 0; color: #d0d0d0; }
    .yaivs-guide .row { display: flex; gap: 8px; margin-top: 10px; }
    .yaivs-guide button { border: none; border-radius: 999px; padding: 8px 12px; font: 600 13px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; cursor: pointer; color: #111; background: #3ea6ff; }
    .yaivs-guide button.ghost { background: transparent; color: #eaeaea; border: 1px solid rgba(255,255,255,0.18); }
  `;

  const guide = document.createElement('div');
  guide.className = 'yaivs-guide';
  guide.innerHTML = '<h3>Enable free API key</h3><p>Follow these quick steps. This box will update as you go.</p>';
  console.log('[YAIVS Guide] Guide element created');

  function ensureStyle() {
    if (document.getElementById('yaivs-guide-style')) {
      console.log('[YAIVS Guide] Style already exists');
      return;
    }
    console.log('[YAIVS Guide] Injecting guide styles');
    const s = document.createElement('style');
    s.id = 'yaivs-guide-style';
    s.textContent = STYLE;
    document.documentElement.appendChild(s);
    console.log('[YAIVS Guide] Styles injected successfully');
  }

  function set(html) {
    console.log('[YAIVS Guide] Updating guide content:', html.substring(0, 50) + '...');
    guide.innerHTML = html;
  }

  function mount() {
    console.log('[YAIVS Guide] Mounting guide to DOM');
    try {
      ensureStyle();
      if (!guide.isConnected) {
        document.documentElement.appendChild(guide);
        console.log('[YAIVS Guide] Guide mounted successfully, should be visible');
      } else {
        console.log('[YAIVS Guide] Guide already mounted');
      }
    } catch (error) {
      console.error('[YAIVS Guide] Failed to mount guide:', error);
    }
  }

  function elContainsText(selector, text) {
    const els = Array.from(document.querySelectorAll(selector));
    const t = (text || '').toLowerCase();
    return els.find((el) => (el.textContent || '').toLowerCase().includes(t));
  }

  async function hasSavedKey() {
    try {
      console.log('[YAIVS Guide] Checking for saved key');
      const { openrouterKey } = await chrome.storage.sync.get(['openrouterKey']);
      const hasKey = !!(openrouterKey && /^sk-or-/i.test(openrouterKey));
      console.log('[YAIVS Guide] Has saved key:', hasKey);
      return hasKey;
    } catch (error) {
      console.error('[YAIVS Guide] Error checking saved key:', error);
      return false;
    }
  }

  function clickCreateKeyIfVisible() {
    const btn = elContainsText('button, a', 'create key') || elContainsText('button, a', 'new key');
    if (btn) {
      console.log('[YAIVS Guide] Scrolling create key button into view');
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function update() {
    try {
      console.log('[YAIVS Guide] Running update, current URL:', window.location.href);
      mount();
      
      if (await hasSavedKey()) {
        console.log('[YAIVS Guide] Key already saved, showing completion message');
        set('<h3>All set ✓</h3><p>Your OpenRouter key has been saved. You can close this tab and return to YouTube.</p><div class="row"><button class="ghost" id="yaivs-close">Close</button></div>');
        guide.querySelector('#yaivs-close')?.addEventListener('click', () => window.close());
        return;
      }

      // Check current URL to provide context-aware guidance
      const currentUrl = window.location.href;
      const isModelPage = currentUrl.includes('/models/');
      const isKeysPage = currentUrl.includes('/keys');
      const isHomePage = currentUrl === 'https://openrouter.ai/' || currentUrl === 'https://openrouter.ai';
      
      console.log('[YAIVS Guide] Page context:', { isModelPage, isKeysPage, isHomePage });

      // If we see a Google sign-in prompt/button, guide the user to sign in.
      const googleBtn = elContainsText('button, a', 'continue with google') || 
                       elContainsText('button, a', 'sign in with google') ||
                       elContainsText('button, a', 'sign up') ||
                       elContainsText('button, a', 'get started');
      if (googleBtn) {
        console.log('[YAIVS Guide] Detected Google sign-in button');
        set('<h3>Step 1: Sign in</h3><p>Click <b>Continue with Google</b> or <b>Sign up</b> to create a free OpenRouter account.</p>');
        return;
      }

      // If we're on a model page, guide user to navigate to API keys
      if (isModelPage) {
        const profileBtn = elContainsText('button, a, [role="button"]', 'profile') || 
                          elContainsText('button, a, [role="button"]', 'account') ||
                          elContainsText('button, a, [role="button"]', 'settings') ||
                          document.querySelector('[data-testid="account-menu"], [aria-label*="account"], [aria-label*="profile"]');
        
        if (profileBtn) {
          console.log('[YAIVS Guide] On model page, detected profile menu');
          set('<h3>Step 1: Go to API Keys</h3><p>Click your <b>profile/account menu</b>, then select <b>API Keys</b> or go to <a href="/keys" style="color:#3ea6ff">openrouter.ai/keys</a>.</p>');
        } else {
          console.log('[YAIVS Guide] On model page, showing navigation guidance');
          set('<h3>Step 1: Navigate to API Keys</h3><p>To create an API key, go to <a href="/keys" style="color:#3ea6ff" onclick="window.location.href=\'/keys\'">API Keys section</a> or look for your account menu.</p>');
        }
        return;
      }

      // If we see an "API" tab that is not selected, guide the user to click it.
      const apiTab = elContainsText('button, a', 'api') || elContainsText('nav a', 'api');
      if (apiTab && apiTab.getAttribute('aria-selected') !== 'true') {
        console.log('[YAIVS Guide] Detected unselected API tab');
        set('<h3>Step 2: Go to API section</h3><p>Click the <b>API</b> tab to find the "Create Key" button.</p>');
        return;
      }

      // If we are on a Keys page (look for Create Key)
      const createBtn = elContainsText('button, a', 'create key') || 
                        elContainsText('button, a', 'new key') ||
                        elContainsText('button, a', 'add key') ||
                        elContainsText('button', 'create');
      if (createBtn) {
        console.log('[YAIVS Guide] Detected Create Key button');
        set('<h3>Step 3: Create a key</h3><p>Click <b>Create Key</b>. You can name it anything you like (e.g., "YouTube AI Summary").</p>');
        clickCreateKeyIfVisible();
        return;
      }

      // If we're on the keys page but no create button, show general guidance
      if (isKeysPage) {
        console.log('[YAIVS Guide] On keys page but no create button found');
        set('<h3>Create Your API Key</h3><p>Look for a <b>Create Key</b> or <b>New Key</b> button on this page. If you don\'t see one, try refreshing the page.</p>');
        return;
      }

      // Default hint with more specific guidance
      console.log('[YAIVS Guide] No specific elements detected, showing default message');
      set('<h3>Getting started</h3><p>Please sign in to OpenRouter, then navigate to the API Keys section. If you\'re having trouble, try the <b>Manual Setup</b> option.</p>');
    } catch (error) {
      console.error('[YAIVS Guide] Error in update function:', error);
      set('<h3>Guide Error</h3><p>Something went wrong. Please refresh the page or try manual setup.</p>');
    }
  }

  // Set up observers and initial update
  console.log('[YAIVS Guide] Setting up DOM observer and interval');
  const obs = new MutationObserver(() => {
    console.log('[YAIVS Guide] DOM changed, triggering update');
    update();
  });
  
  try { 
    obs.observe(document.documentElement, { childList: true, subtree: true });
    console.log('[YAIVS Guide] DOM observer started successfully');
  } catch (error) {
    console.error('[YAIVS Guide] Failed to start DOM observer:', error);
  } 
  
  setInterval(() => {
    console.log('[YAIVS Guide] Interval update triggered');
    update();
  }, 1500);
  
  console.log('[YAIVS Guide] Running initial update');
  update();
})();

