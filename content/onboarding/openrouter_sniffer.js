(() => {
  const KEY_REGEX = /(sk-or-[a-z0-9-]{8,})/i;
  let sent = false;
  let currentUrl = window.location.href;

  console.log('[YAIVS Sniffer] OpenRouter key sniffer loaded on:', currentUrl);

  // Add ping response handler for cross-platform debugging
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'YAIVS_PING') {
      console.log('[YAIVS Sniffer] Received ping, responding');
      sendResponse({ alive: true, script: 'openrouter_sniffer', url: window.location.href });
      return true;
    }
  });

  function isAPIPage() {
    const url = window.location.href;
    const path = window.location.pathname;
    
    // Enhanced detection for settings/keys page
    const isSettingsKeys = url.includes('/settings/keys') || path.includes('/settings/keys');
    const isKeysPage = url.includes('/keys') || path.includes('/keys');
    const hasAPIElements = document.querySelector('[data-testid="api-keys"], [aria-label*="API"], [role="tabpanel"][data-value="api"]');
    const hasKeyCreationElements = document.querySelector('button, a').textContent?.toLowerCase().includes('create key') ||
                                  document.querySelector('button, a').textContent?.toLowerCase().includes('new key');
    
    const isAPI = isSettingsKeys || isKeysPage || url.includes('/api') || path.includes('/api') || hasAPIElements || hasKeyCreationElements;
    
    console.log('[YAIVS Sniffer] API page detection:', {
      url, path, isSettingsKeys, isKeysPage, hasAPIElements, hasKeyCreationElements, isAPI
    });
    
    return isAPI;
  }

  function reinitializeForAPIPage() {
    console.log('[YAIVS Sniffer] Reinitializing for API page - enhanced detection active');
    
    // More aggressive scanning for API pages, especially settings/keys
    const enhancedInterval = setInterval(() => {
      if (sent) {
        clearInterval(enhancedInterval);
        return;
      }
      
      // Look for newly created elements that might contain keys (settings page specific)
      const keySelectors = [
        '[data-testid*="key"]',
        '[data-cy*="key"]', 
        '.api-key',
        '[class*="api-key"]',
        '[class*="token"]',
        '[class*="secret"]',
        'code',
        'pre',
        '.copy-text',
        '[data-clipboard-text]'
      ];
      
      const newElements = document.querySelectorAll(keySelectors.join(', '));
      for (const element of newElements) {
        const text = element.textContent || element.innerText || element.getAttribute('data-clipboard-text') || '';
        if (KEY_REGEX.test(text)) {
          const candidate = text.match(KEY_REGEX)?.[1];
          if (candidate) {
            console.log('[YAIVS Sniffer] Found key in enhanced element:', {
              element: element.tagName,
              className: element.className,
              id: element.id,
              candidatePrefix: candidate.substring(0, 10) + '...'
            });
            sent = true;
            chrome.runtime.sendMessage({ type: 'saveOpenRouterKey', key: candidate }, (res) => {
              console.log('[YAIVS Sniffer] Save response:', res);
            });
            clearInterval(enhancedInterval);
            return;
          }
        }
      }
      
      // Also check for clipboard buttons that might reveal keys on click
      const copyButtons = document.querySelectorAll('[data-clipboard-text], button[class*="copy"], button[aria-label*="copy"]');
      for (const button of copyButtons) {
        const clipboardText = button.getAttribute('data-clipboard-text') || '';
        if (KEY_REGEX.test(clipboardText)) {
          const candidate = clipboardText.match(KEY_REGEX)?.[1];
          if (candidate) {
            console.log('[YAIVS Sniffer] Found key in clipboard button:', candidate.substring(0, 10) + '...');
            sent = true;
            chrome.runtime.sendMessage({ type: 'saveOpenRouterKey', key: candidate }, (res) => {
              console.log('[YAIVS Sniffer] Save response:', res);
            });
            clearInterval(enhancedInterval);
            return;
          }
        }
      }
    }, 500); // More frequent checking on API pages
    
    // Stop enhanced scanning after 5 minutes
    setTimeout(() => {
      clearInterval(enhancedInterval);
      console.log('[YAIVS Sniffer] Enhanced API scanning timeout');
    }, 300000);
  }

  function scanOnce() {
    if (sent) return;
    
    const url = window.location.href;
    if (url !== currentUrl) {
      console.log('[YAIVS Sniffer] Navigation detected:', currentUrl, '→', url);
      currentUrl = url;
      
      if (isAPIPage()) {
        console.log('[YAIVS Sniffer] Now on API page, enhanced scanning active');
        reinitializeForAPIPage();
      }
    }
    
    try {
      const rootText = document.body ? document.body.innerText || '' : '';
      const html = document.body ? document.body.innerHTML || '' : '';
      
      // Enhanced input detection for API key creation pages
      const inputs = document.querySelectorAll('input[type="password"], input[type="text"], textarea, [contenteditable="true"]');
      
      let candidate = '';
      
      // Check all input fields and their attributes
      for (const input of inputs) {
        const value = input.value || input.textContent || input.innerText || input.getAttribute('data-value') || '';
        if (typeof value === 'string' && KEY_REGEX.test(value)) {
          candidate = value.match(KEY_REGEX)?.[1] || '';
          console.log('[YAIVS Sniffer] Found key in input field:', {
            tagName: input.tagName,
            type: input.type,
            className: input.className,
            candidatePrefix: candidate.substring(0, 10) + '...'
          });
          break;
        }
      }
      
      // Check for keys in code blocks, pre elements, and similar containers
      if (!candidate) {
        const codeElements = document.querySelectorAll('code, pre, .code, [class*="code"], .token, [class*="token"]');
        for (const element of codeElements) {
          const text = element.textContent || element.innerText || '';
          if (KEY_REGEX.test(text)) {
            candidate = text.match(KEY_REGEX)?.[1] || '';
            console.log('[YAIVS Sniffer] Found key in code element:', {
              tagName: element.tagName,
              className: element.className,
              candidatePrefix: candidate.substring(0, 10) + '...'
            });
            break;
          }
        }
      }
      
      // Check visible text content
      if (!candidate && KEY_REGEX.test(rootText)) {
        candidate = rootText.match(KEY_REGEX)?.[1] || '';
        console.log('[YAIVS Sniffer] Found key in page text');
      }
      
      // Check HTML content as fallback
      if (!candidate && KEY_REGEX.test(html)) {
        candidate = html.match(KEY_REGEX)?.[1] || '';
        console.log('[YAIVS Sniffer] Found key in page HTML');
      }
      
      if (candidate) {
        console.log('[YAIVS Sniffer] Detected OpenRouter key, saving...');
        sent = true;
        chrome.runtime.sendMessage({ type: 'saveOpenRouterKey', key: candidate }, (res) => {
          console.log('[YAIVS Sniffer] Save response:', res);
        });
      }
    } catch (error) {
      console.error('[YAIVS Sniffer] Error during scan:', error);
    }
  }

  // Add navigation listeners for SPA detection
  function addNavigationListeners() {
    // Listen for history API changes (pushState, replaceState)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      console.log('[YAIVS Sniffer] pushState detected');
      setTimeout(scanOnce, 100); // Small delay for DOM updates
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      console.log('[YAIVS Sniffer] replaceState detected');
      setTimeout(scanOnce, 100);
    };
    
    // Listen for popstate events (back/forward navigation)
    window.addEventListener('popstate', () => {
      console.log('[YAIVS Sniffer] popstate detected');
      setTimeout(scanOnce, 100);
    });
    
    // Listen for hash changes
    window.addEventListener('hashchange', () => {
      console.log('[YAIVS Sniffer] hashchange detected');
      setTimeout(scanOnce, 100);
    });
  }

  // Observe DOM for changes
  const observer = new MutationObserver(() => scanOnce());
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    console.log('[YAIVS Sniffer] DOM observer started');
  } catch (error) {
    console.error('[YAIVS Sniffer] Failed to start DOM observer:', error);
  }

  // Listen for messages from guide script
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'YAIVS_API_PAGE_DETECTED' && event.data?.source === 'guide') {
      console.log('[YAIVS Sniffer] Received API page signal from guide:', event.data.context);
      if (!sent) {
        console.log('[YAIVS Sniffer] Activating enhanced scanning due to guide signal');
        // Trigger immediate enhanced scanning
        reinitializeForAPIPage();
        // Also do an immediate scan
        setTimeout(scanOnce, 100);
      }
    }
  });
  
  // Enhanced login/auth state change detection
  function addLoginStateDetection() {
    // Listen for common auth-related events
    window.addEventListener('storage', (e) => {
      if (e.key && (e.key.includes('auth') || e.key.includes('token') || e.key.includes('session'))) {
        console.log('[YAIVS Sniffer] Auth storage change detected, triggering scan');
        setTimeout(scanOnce, 1000); // Delay to allow UI to update
      }
    });
    
    // Monitor URL changes more aggressively for auth flows
    let lastAuthCheck = window.location.href;
    setInterval(() => {
      const currentHref = window.location.href;
      if (currentHref !== lastAuthCheck) {
        lastAuthCheck = currentHref;
        console.log('[YAIVS Sniffer] URL change detected during auth flow:', currentHref);
        
        // If we're now on settings/keys after navigation, do enhanced scan
        if (currentHref.includes('/settings/keys') && !sent) {
          console.log('[YAIVS Sniffer] Detected navigation to settings/keys, starting enhanced scan');
          setTimeout(() => {
            scanOnce();
            reinitializeForAPIPage();
          }, 500);
        }
      }
    }, 1000);
  }

  // Add SPA navigation listeners
  addNavigationListeners();
  
  // Add enhanced login state detection
  addLoginStateDetection();
  
  // Persistent polling - no timeout limit, runs until key found or tab closed
  const id = setInterval(() => {
    if (!sent) {
      scanOnce();
    } else {
      console.log('[YAIVS Sniffer] Key found, stopping scanner');
      clearInterval(id);
      observer.disconnect();
    }
  }, 2000); // Check every 2 seconds instead of 1 second to be less aggressive
  
  // Initial scan
  scanOnce();
  
  console.log('[YAIVS Sniffer] Persistent scanner started, will run until key found or tab closed');
  
  // Add message listener for ping/alive checks from onboarding
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'YAIVS_PING') {
      console.log('[YAIVS Sniffer] Received ping, responding with alive status');
      sendResponse({ alive: true, sent, url: window.location.href });
      return true; // Keep message channel open for async response
    }
  });
})();

