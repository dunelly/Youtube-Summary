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
      await chrome.storage.sync.set({ provider: 'openrouter', openrouterModel: 'google/gemma-2-9b-it:free' });

      const url = 'https://openrouter.ai/models/google/gemma-2-9b-it:free';
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
        // Wait for tab to finish loading before injecting scripts
        await waitForTabLoading(tab.id);
        
        console.log('[YAIVS Onboarding] Injecting content scripts...');
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [
              'content/onboarding/openrouter_sniffer.js',
              'content/onboarding/openrouter_guide.js',
            ]
          });
          console.log('[YAIVS Onboarding] Scripts injected successfully');
          setStatus('Scripts loaded. Please sign in to OpenRouter and create a key.');
        } catch (injectionError) {
          console.error('[YAIVS Onboarding] Script injection failed:', injectionError);
          setStatus(`Script injection failed: ${injectionError.message}. Try refreshing the OpenRouter page.`, 'err');
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

  async function finish() {
    try {
      chrome.tabs.create({ url: 'https://www.youtube.com' }).catch(() => {});
      window.close();
    } catch {
      window.close();
    }
  }

  // React to key saved by sniffer while this page is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.openrouterKey?.newValue) {
      qs('.step').hidden = true;
      manualStep.hidden = true;
      finishStep.hidden = false;
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
