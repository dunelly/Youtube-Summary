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
      
      // Set default model
      await chrome.storage.sync.set({ provider: 'openrouter', openrouterModel: 'x-ai/grok-4-fast:free' });

      const url = 'https://openrouter.ai/settings/keys';
      const origin = 'https://openrouter.ai/*';

      console.log('[YAIVS Onboarding] Checking permissions for:', origin);
      const has = await chrome.permissions.contains({ origins: [origin] });
      console.log('[YAIVS Onboarding] Permission already granted:', has);
      
      if (!has) {
        console.log('[YAIVS Onboarding] Requesting permission...');
        const ok = await chrome.permissions.request({ origins: [origin] });
        console.log('[YAIVS Onboarding] Permission granted:', ok);
        if (!ok) {
          setStatus('Permission denied. Please allow the extension to access OpenRouter.', 'err');
          return;
        }
      }

      console.log('[YAIVS Onboarding] Creating tab for:', url);
      const tab = await chrome.tabs.create({ url, active: true });
      console.log('[YAIVS Onboarding] Tab created:', tab?.id);
      
      if (tab?.id) {
        onboardingTabId = tab.id;
        
        // Start monitoring this tab for OAuth return (both local and background)
        startTabMonitoring(tab.id);
        
        // Also register with background script for enhanced tracking
        try {
          await chrome.runtime.sendMessage({
            type: 'startOnboardingSession',
            sessionInfo: { url, startTime: Date.now() }
          });
          console.log('[YAIVS Onboarding] Registered session with background script');
        } catch (error) {
          console.log('[YAIVS Onboarding] Failed to register with background:', error);
        }
        
        // Wait for tab to finish loading before injecting scripts
        await waitForTabLoading(tab.id);
        
        console.log('[YAIVS Onboarding] Injecting content scripts...');
        const injectionSuccess = await injectOnboardingScripts(tab.id);
        
        if (injectionSuccess) {
          setStatus('Scripts loaded. Follow the guide to sign in and create your API key.');
        }
      } else {
        throw new Error('Failed to create tab');
      }
    } catch (e) {
      console.error('[YAIVS Onboarding] Setup failed:', e);
      setStatus(`Setup failed: ${e.message}. Please try again.`, 'err');
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
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          'content/onboarding/openrouter_sniffer.js',
          'content/onboarding/openrouter_guide.js',
        ]
      });
      console.log('[YAIVS Onboarding] Scripts injected successfully for tab:', tabId);
      return true;
    } catch (injectionError) {
      console.error('[YAIVS Onboarding] Script injection failed:', injectionError);
      setStatus(`Script injection failed: ${injectionError.message}. Try refreshing the OpenRouter page.`, 'err');
      return false;
    }
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
})();
