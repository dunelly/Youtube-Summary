(() => {
  console.log('[YAIVS Guide] OpenRouter guide script loaded');
  
  // Add ping response handler for cross-platform debugging
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'YAIVS_PING') {
      console.log('[YAIVS Guide] Received ping, responding');
      sendResponse({ alive: true, script: 'openrouter_guide', url: window.location.href });
      return true;
    }
  });
  
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

  function detectLoginState() {
    // Check for login required indicators
    const loginRequired = elContainsText('h1, h2, p, div', 'sign in') ||
                         elContainsText('h1, h2, p, div', 'log in') ||
                         elContainsText('h1, h2, p, div', 'please log in') ||
                         elContainsText('button, a', 'continue with google') ||
                         elContainsText('button, a', 'sign in with google') ||
                         document.querySelector('form[action*="login"], form[action*="signin"], form[action*="auth"]');
    
    // Check for authenticated indicators (settings page specific)
    const authenticated = document.querySelector('[data-testid*="key"], [data-cy*="key"], .api-key, [class*="api-key"]') ||
                         elContainsText('button, a', 'create key') ||
                         elContainsText('button, a', 'new key') ||
                         elContainsText('h1, h2', 'api keys') ||
                         document.querySelector('table, .table, [role="table"]'); // Key listing tables
    
    console.log('[YAIVS Guide] Login state detection:', { loginRequired: !!loginRequired, authenticated: !!authenticated });
    
    if (loginRequired && !authenticated) return 'login_required';
    if (authenticated) return 'authenticated';
    return 'unknown';
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
      const isKeysPage = currentUrl.includes('/keys') || currentUrl.includes('/settings/keys');
      const isSettingsKeysPage = currentUrl.includes('/settings/keys');
      const isHomePage = currentUrl === 'https://openrouter.ai/' || currentUrl === 'https://openrouter.ai';
      
      // Detect current login/authentication state
      const loginState = detectLoginState();
      
      console.log('[YAIVS Guide] Page context:', { isModelPage, isKeysPage, isSettingsKeysPage, isHomePage, loginState });

      // Handle login state first - this takes priority over everything else
      if (loginState === 'login_required') {
        console.log('[YAIVS Guide] Login required, showing sign-in guidance');
        const googleBtn = elContainsText('button, a', 'continue with google') || 
                         elContainsText('button, a', 'sign in with google') ||
                         elContainsText('button, a', 'sign up') ||
                         elContainsText('button, a', 'get started');
        
        if (googleBtn) {
          set('<h3>Step 1: Sign in Required</h3><p>You need to sign in to access API keys. Click <b>Continue with Google</b> or <b>Sign up</b> to continue.</p>');
        } else {
          set('<h3>Sign in Required</h3><p>Please sign in to OpenRouter to access the API keys section. Look for a sign-in or login button.</p>');
        }
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

      // If we are on the settings/keys page and authenticated
      if (isSettingsKeysPage && loginState === 'authenticated') {
        const createBtn = elContainsText('button, a', 'create key') || 
                          elContainsText('button, a', 'new key') ||
                          elContainsText('button, a', 'add key') ||
                          elContainsText('button', 'create');
        
        if (createBtn) {
          console.log('[YAIVS Guide] Detected Create Key button on settings page');
          set('<h3>Create Your API Key</h3><p>Click <b>Create Key</b> to generate your free API key. You can name it "YouTube AI Summary" or anything you prefer.</p>');
          clickCreateKeyIfVisible();
          
          // Signal sniffer that we're on key creation page
          try {
            window.postMessage({ 
              type: 'YAIVS_API_PAGE_DETECTED', 
              source: 'guide',
              context: 'settings_keys_page_authenticated'
            }, '*');
            console.log('[YAIVS Guide] Signaled sniffer about authenticated settings page');
          } catch (error) {
            console.error('[YAIVS Guide] Failed to signal sniffer:', error);
          }
          return;
        } else {
          console.log('[YAIVS Guide] On settings/keys page but no create button visible');
          set('<h3>Create Your API Key</h3><p>Look for a <b>Create Key</b> or <b>New Key</b> button on this page. If you don\'t see one, try refreshing the page or check if you have the right permissions.</p>');
          return;
        }
      }
      
      // If we are on any keys page (look for Create Key)
      const createBtn = elContainsText('button, a', 'create key') || 
                        elContainsText('button, a', 'new key') ||
                        elContainsText('button, a', 'add key') ||
                        elContainsText('button', 'create');
      if (createBtn && loginState === 'authenticated') {
        console.log('[YAIVS Guide] Detected Create Key button');
        set('<h3>Create Your API Key</h3><p>Click <b>Create Key</b>. You can name it anything you like (e.g., "YouTube AI Summary").</p>');
        clickCreateKeyIfVisible();
        
        // Signal sniffer that we're on key creation page
        try {
          window.postMessage({ 
            type: 'YAIVS_API_PAGE_DETECTED', 
            source: 'guide',
            context: 'create_key_button_found'
          }, '*');
          console.log('[YAIVS Guide] Signaled sniffer about API page');
        } catch (error) {
          console.error('[YAIVS Guide] Failed to signal sniffer:', error);
        }
        return;
      }

      // If we're on the keys page but no create button, show general guidance
      if (isKeysPage) {
        console.log('[YAIVS Guide] On keys page but no create button found');
        set('<h3>Create Your API Key</h3><p>Look for a <b>Create Key</b> or <b>New Key</b> button on this page. If you don\'t see one, try refreshing the page.</p>');
        return;
      }

      // Default guidance based on login state
      console.log('[YAIVS Guide] No specific elements detected, showing default message for state:', loginState);
      
      if (loginState === 'authenticated') {
        set('<h3>Navigate to API Keys</h3><p>You\'re signed in! Now navigate to the API Keys section to create your key. If you\'re having trouble, try the <b>Manual Setup</b> option.</p>');
      } else {
        set('<h3>Getting Started</h3><p>Please sign in to OpenRouter first, then this guide will help you create your API key. If you\'re having trouble, try the <b>Manual Setup</b> option.</p>');
      }
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
  
  // Add message listener for ping/alive checks from onboarding
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'YAIVS_PING') {
      console.log('[YAIVS Guide] Received ping, responding with alive status');
      sendResponse({ alive: true, url: window.location.href });
      return true; // Keep message channel open for async response
    }
  });
})();

