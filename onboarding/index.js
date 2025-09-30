(() => {
  const qs = (sel) => document.querySelector(sel);
  const statusEl = qs('#status');
  const manualStatusEl = qs('#manual-status');
  const startBtn = qs('#start-setup');
  const manualBtn = qs('#manual-setup');
  const backToGuidedBtn = qs('#back-to-guided');
  const saveManualKeyBtn = qs('#save-manual-key');
  const manualKeyInput = qs('#manual-key');
  const finishBtn = qs('#finish');
  const finishStep = qs('#finish-step');
  const manualStep = qs('#manual-step');
  
  // Track the onboarding tab for re-injection after OAuth
  let onboardingTabId = null;
  let tabMonitoringActive = false;

  function setStatus(msg, cls = '') {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = cls || '';
  }

  function setManualStatus(msg, cls = '') {
    if (!manualStatusEl) return;
    manualStatusEl.textContent = msg || '';
    manualStatusEl.className = cls || '';
  }

  function showManualSetup() {
    qs('.step').hidden = true;
    manualStep.hidden = false;
    setManualStatus('');
  }

  function showGuidedSetup() {
    manualStep.hidden = true;
    qs('.step').hidden = false;
    setStatus('');
  }

  async function startSetup() {
    try {
      console.log('[YAIVS Onboarding] Starting setup...');
      setStatus('Setting up...');
      
      // Set default model
      await chrome.storage.sync.set({ provider: 'openrouter', openrouterModel: 'x-ai/grok-4-fast:free' });

      const url = 'https://openrouter.ai/settings/keys';
      const origin = 'https://openrouter.ai/*';

      console.log('[YAIVS Onboarding] Checking permissions for:', origin);
      const has = await chrome.permissions.contains({ origins: [origin] });
      console.log('[YAIVS Onboarding] Permission already granted:', has);
      
      if (!has) {
        console.log('[YAIVS Onboarding] Requesting permission...');
        setStatus('Requesting permission for OpenRouter.ai...');
        
        // Add delay before permission request for Windows compatibility
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const ok = await chrome.permissions.request({ origins: [origin] });
        console.log('[YAIVS Onboarding] Permission granted:', ok);
        if (!ok) {
          setStatus('Permission denied. Please allow the extension to access OpenRouter.', 'err');
          console.log('[YAIVS Onboarding] Permission denied by user');
          return;
        }
        
        // Additional delay after permission grant (Windows often needs this)
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setStatus('Opening OpenRouter page...');
      console.log('[YAIVS Onboarding] Creating tab for:', url);
      
      // Windows Chrome sometimes has issues with immediate tab creation after permission
      let tab;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (!tab && attempts < maxAttempts) {
        try {
          attempts++;
          console.log(`[YAIVS Onboarding] Tab creation attempt ${attempts}/${maxAttempts}`);
          
          // Prefer tabs.create first
          try {
            tab = await chrome.tabs.create({ url, active: true });
            console.log('[YAIVS Onboarding] Tab created successfully:', tab?.id);
          } catch (tabErr) {
            console.warn('[YAIVS Onboarding] tabs.create failed, trying windows.create:', tabErr?.message || tabErr);
            // Fallback: windows.create is often more reliable on Windows
            try {
              const win = await chrome.windows.create({ url, focused: true, state: 'normal' });
              tab = (win?.tabs && win.tabs[0]) ? win.tabs[0] : null;
              if (tab?.id) {
                console.log('[YAIVS Onboarding] Window created, using tab:', tab.id);
              } else {
                throw new Error('windows.create returned no tab');
              }
            } catch (winErr) {
              console.error('[YAIVS Onboarding] windows.create also failed:', winErr?.message || winErr);
              throw winErr;
            }
          }
          
        } catch (tabError) {
          console.error(`[YAIVS Onboarding] Tab creation attempt ${attempts} failed:`, tabError);
          
          if (attempts < maxAttempts) {
            console.log('[YAIVS Onboarding] Retrying tab creation in 1 second...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            throw new Error(`Failed to create tab after ${maxAttempts} attempts: ${tabError.message}`);
          }
        }
      }
      
      if (tab?.id) {
        onboardingTabId = tab.id;
        
        // Store debugging info
        await chrome.storage.local.set({
          onboardingDebug: {
            tabId: tab.id,
            url: tab.url,
            permissionGranted: true,
            platform: navigator.platform || 'Unknown',
            userAgent: navigator.userAgent,
            setupStartTime: Date.now()
          }
        });
        
        // Start monitoring this tab for OAuth return (both local and background)
        startTabMonitoring(tab.id);
        
        // Also register with background script for enhanced tracking
        try {
          await chrome.runtime.sendMessage({
            type: 'startOnboardingSession',
            sessionInfo: { url, startTime: Date.now(), platform: navigator.platform }
          });
          console.log('[YAIVS Onboarding] Registered session with background script');
        } catch (error) {
          console.log('[YAIVS Onboarding] Failed to register with background:', error);
        }
        
        setStatus('Waiting for page to load...');
        
        // Wait for tab to finish loading before injecting scripts
        await waitForTabLoading(tab.id);
        
        console.log('[YAIVS Onboarding] Injecting content scripts...');
        setStatus('Loading helper scripts...');
        
        const injectionSuccess = await injectOnboardingScripts(tab.id);
        
        if (injectionSuccess) {
          setStatus('Scripts loaded. Follow the guide to sign in and create your API key.');
        } else {
          // If injection fails, still provide useful guidance
          setStatus('Guide loading failed, but you can still manually create your API key. Look for the "Create new key" button.', 'warning');
        }
      } else {
        throw new Error('Failed to create tab after multiple attempts');
      }
    } catch (e) {
      console.error('[YAIVS Onboarding] Setup failed:', e);
      
      // Store error info for debugging
      try {
        await chrome.storage.local.set({
          onboardingError: {
            message: e.message,
            stack: e.stack,
            timestamp: Date.now(),
            platform: navigator.platform || 'Unknown'
          }
        });
      } catch (storageError) {
        console.error('[YAIVS Onboarding] Failed to store error info:', storageError);
      }
      
      setStatus(`Setup failed: ${e.message}. Try using manual setup instead.`, 'err');
    }
  }

  async function waitForTabLoading(tabId, maxWaitTime = 10000) {
    const startTime = Date.now();
    return new Promise((resolve) => {
      const checkTab = async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.status === 'complete') {
            console.log('[YAIVS Onboarding] Tab finished loading');
            resolve();
            return;
          }
          
          if (Date.now() - startTime > maxWaitTime) {
            console.log('[YAIVS Onboarding] Tab loading timeout, proceeding anyway');
            resolve();
            return;
          }
          
          setTimeout(checkTab, 500);
        } catch (error) {
          console.error('[YAIVS Onboarding] Error checking tab status:', error);
          resolve(); // Proceed even if we can't check tab status
        }
      };
      checkTab();
    });
  }

  async function saveManualKey() {
    try {
      const key = manualKeyInput.value.trim();
      if (!key) {
        setManualStatus('Please enter your API key.', 'err');
        return;
      }

      if (!/^sk-or-/i.test(key)) {
        setManualStatus('Invalid key format. Keys should start with "sk-or-".', 'err');
        return;
      }

      console.log('[YAIVS Onboarding] Saving manual key...');
      setManualStatus('Saving key...', '');

      const response = await chrome.runtime.sendMessage({ type: 'saveOpenRouterKey', key });
      
      if (response?.status === 'ok') {
        console.log('[YAIVS Onboarding] Manual key saved successfully');
        setManualStatus('Key saved successfully!', 'ok');
        setTimeout(() => {
          manualStep.hidden = true;
          finishStep.hidden = false;
        }, 1000);
      } else {
        console.error('[YAIVS Onboarding] Failed to save manual key:', response?.message);
        setManualStatus(`Failed to save key: ${response?.message || 'Unknown error'}`, 'err');
      }
    } catch (error) {
      console.error('[YAIVS Onboarding] Error saving manual key:', error);
      setManualStatus(`Error: ${error.message}`, 'err');
    }
  }

  async function injectOnboardingScripts(tabId) {
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`[YAIVS Onboarding] Script injection attempt ${attempts}/${maxAttempts} for tab:`, tabId);
        
        // Check if tab is still valid
        try {
          const tab = await chrome.tabs.get(tabId);
          if (!tab || tab.url.includes('chrome://') || tab.url.includes('chrome-extension://')) {
            throw new Error('Cannot inject into system pages');
          }
        } catch (tabError) {
          throw new Error(`Tab validation failed: ${tabError.message}`);
        }
        
        // Wait a bit more for the page to be ready (especially important on Windows)
        if (attempts > 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [
            'content/onboarding/openrouter_sniffer.js',
            'content/onboarding/openrouter_guide.js',
          ]
        });
        
        console.log('[YAIVS Onboarding] Scripts injected successfully for tab:', tabId);
        
        // Verify scripts are working by trying to send a test message
        try {
          await new Promise(resolve => setTimeout(resolve, 500)); // Let scripts initialize
          const response = await chrome.tabs.sendMessage(tabId, { type: 'YAIVS_PING' });
          if (response?.alive) {
            console.log('[YAIVS Onboarding] Scripts are responding');
            return true;
          } else {
            console.log('[YAIVS Onboarding] Scripts injected but not responding, retrying...');
            if (attempts < maxAttempts) continue;
          }
        } catch (pingError) {
          console.log('[YAIVS Onboarding] Scripts not responding to ping:', pingError.message);
          if (attempts < maxAttempts) continue;
        }
        
        return true;
        
      } catch (injectionError) {
        console.error(`[YAIVS Onboarding] Script injection attempt ${attempts} failed:`, injectionError);
        
        if (attempts < maxAttempts) {
          console.log('[YAIVS Onboarding] Retrying script injection...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.error('[YAIVS Onboarding] All injection attempts failed');
          
          // Store injection failure info for debugging
          try {
            await chrome.storage.local.set({
              injectionError: {
                message: injectionError.message,
                attempts: maxAttempts,
                tabId: tabId,
                timestamp: Date.now(),
                platform: navigator.platform || 'Unknown'
              }
            });
          } catch (storageError) {
            console.error('[YAIVS Onboarding] Failed to store injection error:', storageError);
          }
          
          return false;
        }
      }
    }
    
    return false;
  }
  
  function startTabMonitoring(tabId) {
    if (tabMonitoringActive) {
      console.log('[YAIVS Onboarding] Tab monitoring already active');
      return;
    }
    
    tabMonitoringActive = true;
    console.log('[YAIVS Onboarding] Starting tab monitoring for OAuth return detection');
    
    const tabUpdateListener = async (tabIdUpdate, changeInfo, tab) => {
      // Only monitor our onboarding tab
      if (tabIdUpdate !== tabId) return;
      
      // Look for navigation to settings/keys after OAuth
      if (changeInfo.url || changeInfo.status === 'complete') {
        const currentUrl = tab.url || changeInfo.url || '';
        console.log('[YAIVS Onboarding] Tab update detected:', {
          tabId: tabIdUpdate,
          status: changeInfo.status,
          url: currentUrl,
          title: tab.title
        });
        
        // Check if we're back on settings/keys page (post-OAuth)
        if (currentUrl.includes('/settings/keys') && changeInfo.status === 'complete') {
          console.log('[YAIVS Onboarding] Detected return to settings/keys page, checking if scripts need re-injection');
          
          // Wait a bit for page to settle after OAuth redirect
          setTimeout(async () => {
            try {
              // Try to communicate with existing scripts first
              const response = await chrome.tabs.sendMessage(tabId, { type: 'YAIVS_PING' });
              if (response?.alive) {
                console.log('[YAIVS Onboarding] Scripts are still active, no re-injection needed');
                return;
              }
            } catch (error) {
              console.log('[YAIVS Onboarding] Scripts not responding, re-injecting:', error.message);
            }
            
            // Re-inject scripts
            console.log('[YAIVS Onboarding] Re-injecting scripts after OAuth return');
            const success = await injectOnboardingScripts(tabId);
            if (success) {
              setStatus('Reconnected after sign-in. Continue following the guide.');
            }
          }, 1500); // Give OAuth redirect time to settle
        }
      }
    };
    
    // Add the listener
    chrome.tabs.onUpdated.addListener(tabUpdateListener);
    
    // Cleanup when tab is closed or onboarding completes
    const tabRemovedListener = (removedTabId) => {
      if (removedTabId === tabId) {
        console.log('[YAIVS Onboarding] Onboarding tab closed, cleaning up monitors');
        chrome.tabs.onUpdated.removeListener(tabUpdateListener);
        chrome.tabs.onRemoved.removeListener(tabRemovedListener);
        tabMonitoringActive = false;
      }
    };
    
    chrome.tabs.onRemoved.addListener(tabRemovedListener);
    
    // Auto-cleanup after 10 minutes to prevent memory leaks
    setTimeout(() => {
      if (tabMonitoringActive) {
        console.log('[YAIVS Onboarding] Auto-cleanup: Removing tab monitors after timeout');
        chrome.tabs.onUpdated.removeListener(tabUpdateListener);
        chrome.tabs.onRemoved.removeListener(tabRemovedListener);
        tabMonitoringActive = false;
      }
    }, 600000); // 10 minutes
  }
  
  async function finish() {
    // Cleanup monitoring when finishing
    if (tabMonitoringActive && onboardingTabId) {
      console.log('[YAIVS Onboarding] Finishing onboarding, cleaning up tab monitoring');
      tabMonitoringActive = false;
    }
    
    try {
      chrome.tabs.create({ url: 'https://www.youtube.com' }).catch(() => {});
      window.close();
    } catch {
      window.close();
    }
  }

  // React to key saved by sniffer while this page is open
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync') return;
    if (changes.openrouterKey?.newValue) {
      console.log('[YAIVS Onboarding] Key saved detected, showing completion step');
      qs('.step').hidden = true;
      manualStep.hidden = true;
      finishStep.hidden = false;
      
      // Cleanup tab monitoring since onboarding is complete
      if (tabMonitoringActive && onboardingTabId) {
        console.log('[YAIVS Onboarding] Key saved, cleaning up tab monitoring');
        tabMonitoringActive = false;
        
        // Also cleanup background tracking
        try {
          await chrome.runtime.sendMessage({ type: 'stopOnboardingSession' });
          console.log('[YAIVS Onboarding] Cleaned up background session tracking');
        } catch (error) {
          console.log('[YAIVS Onboarding] Failed to cleanup background session:', error);
        }
      }
    }
  });

  // Event listeners
  startBtn?.addEventListener('click', startSetup);
  manualBtn?.addEventListener('click', showManualSetup);
  backToGuidedBtn?.addEventListener('click', showGuidedSetup);
  saveManualKeyBtn?.addEventListener('click', saveManualKey);
  finishBtn?.addEventListener('click', finish);

  // Allow Enter key to save manual key
  manualKeyInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveManualKey();
    }
  });

  // Add debugging function for troubleshooting
  window.debugOnboarding = async function() {
    console.log('[YAIVS Debug] Starting onboarding debug...');
    
    try {
      const debugInfo = {
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        location: window.location.href
      };

      // Get stored debug data
      const stored = await chrome.storage.local.get(['onboardingDebug', 'onboardingError', 'injectionError']);
      debugInfo.storedData = stored;

      // Check permissions
      try {
        const hasPermission = await chrome.permissions.contains({ origins: ['https://openrouter.ai/*'] });
        debugInfo.permissions = { openrouter: hasPermission };
      } catch (permError) {
        debugInfo.permissions = { error: permError.message };
      }

      console.log('[YAIVS Debug] Debug information:', debugInfo);
      
      // Show debug info to user
      const debugElement = document.createElement('div');
      debugElement.style.cssText = `
        position: fixed; top: 10px; left: 10px; right: 10px; 
        background: #f0f0f0; border: 2px solid #ccc; padding: 15px; 
        border-radius: 8px; z-index: 10000; font-family: monospace; 
        font-size: 12px; max-height: 300px; overflow-y: auto;
      `;
      debugElement.innerHTML = `
        <h3>Onboarding Debug Info</h3>
        <button onclick="this.parentElement.remove()" style="float: right;">Close</button>
        <pre>${JSON.stringify(debugInfo, null, 2)}</pre>
        <button onclick="navigator.clipboard.writeText('${JSON.stringify(debugInfo).replace(/'/g, "\\'")}')">Copy to Clipboard</button>
      `;
      document.body.appendChild(debugElement);
      
      return debugInfo;
    } catch (error) {
      console.error('[YAIVS Debug] Debug function failed:', error);
      alert(`Debug failed: ${error.message}`);
    }
  };

  // Show debug button if there are issues or on Windows
  if (navigator.platform.includes('Win') || localStorage.getItem('yaivs-debug-mode')) {
    const debugButton = document.createElement('button');
    debugButton.textContent = 'Debug Info';
    debugButton.style.cssText = `
      position: fixed; bottom: 10px; left: 10px; 
      background: #666; color: white; border: none; 
      padding: 8px 12px; border-radius: 4px; cursor: pointer;
      font-size: 12px; z-index: 9999;
    `;
    debugButton.onclick = () => window.debugOnboarding();
    document.body.appendChild(debugButton);
    
    console.log('[YAIVS Onboarding] Debug mode enabled for Windows or debug flag');
  }
})();
