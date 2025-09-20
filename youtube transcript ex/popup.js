document.addEventListener('DOMContentLoaded', function() {
  const copyButton = document.getElementById('copyButton');
  const downloadButton = document.getElementById('downloadButton');
  const statusElement = document.getElementById('status');
  const statusMessage = statusElement.querySelector('.status-message');
  const retryButton = document.getElementById('retryButton');
  const formatButton = document.getElementById('formatButton');
  const formatDropdown = document.getElementById('formatDropdown');
  const showTimestampsCheckbox = document.getElementById('showTimestamps');
  const showTitleCheckbox = document.getElementById('showTitle');
  const showUrlCheckbox = document.getElementById('showUrl');
  const addSpacingCheckbox = document.getElementById('addSpacing');
  const paragraphStyleCheckbox = document.getElementById('paragraphStyle');
  const showDownloadButtonCheckbox = document.getElementById('showDownloadButton');
  const addPromptCheckbox = document.getElementById('addPrompt');
  const editPromptButton = document.getElementById('editPrompt');
  const promptSection = document.getElementById('promptSection');
  const customPrompt = document.getElementById('customPrompt');
  const resetPrompt = document.getElementById('resetPrompt');
  const settingsSaved = document.getElementById('settingsSaved');
  const feedbackLink = document.getElementById('feedbackLink');
  const feedbackOverlay = document.getElementById('feedbackOverlay');
  const feedbackText = document.getElementById('feedbackText');
  const cancelFeedback = document.getElementById('cancelFeedback');
  const sendFeedback = document.getElementById('sendFeedback');
  const previewSection = document.getElementById('previewSection');
  const previewArea = document.getElementById('previewArea');

  let lastAction = null;
  let lastError = null;
  let currentTranscriptData = null;

  const defaultPrompt = "Summarize the following transcript in a clear and concise way. Capture all the key insights, arguments, and takeaways while removing filler. Break the summary into well-structured bullet points or sections by theme/topic. The goal is to help me understand everything important without reading the whole transcript. Think like a researcher or note-taker summarizing for someone smart but busy. Keep the summary accurate, complete, and easy to scan.";

  // Load saved format preferences
  chrome.storage.sync.get(['formatSettings', 'uiSettings', 'promptSettings'], function(result) {
    const formatSettings = result.formatSettings || {
      showTimestamps: true,
      showTitle: true,
      showUrl: false,
      addSpacing: true,
      paragraphStyle: false,
      addPrompt: false
    };
    const uiSettings = result.uiSettings || {
      showDownloadButton: false
    };
    const promptSettings = result.promptSettings || {
      prompt: defaultPrompt
    };

    showTimestampsCheckbox.checked = formatSettings.showTimestamps;
    showTitleCheckbox.checked = formatSettings.showTitle;
    showUrlCheckbox.checked = formatSettings.showUrl;
    addSpacingCheckbox.checked = formatSettings.addSpacing;
    paragraphStyleCheckbox.checked = formatSettings.paragraphStyle;
    addPromptCheckbox.checked = formatSettings.addPrompt;
    showDownloadButtonCheckbox.checked = uiSettings.showDownloadButton;
    customPrompt.value = promptSettings.prompt;
    
    downloadButton.classList.toggle('show', uiSettings.showDownloadButton);
    editPromptButton.style.display = formatSettings.addPrompt ? 'inline' : 'none';
    promptSection.classList.remove('show'); // Always start with prompt section hidden
  });

  // Save format preferences when changed
  function saveFormatSettings() {
    const formatSettings = {
      showTimestamps: showTimestampsCheckbox.checked,
      showTitle: showTitleCheckbox.checked,
      showUrl: showUrlCheckbox.checked,
      addSpacing: addSpacingCheckbox.checked,
      paragraphStyle: paragraphStyleCheckbox.checked,
      addPrompt: addPromptCheckbox.checked
    };
    
    const uiSettings = {
      showDownloadButton: showDownloadButtonCheckbox.checked
    };

    const promptSettings = {
      prompt: customPrompt.value
    };

    formatButton.classList.add('loading');
    chrome.storage.sync.set({ 
      formatSettings,
      uiSettings,
      promptSettings
    }, function() {
      showSettingsSaved();
      // Update UI immediately
      downloadButton.classList.toggle('show', uiSettings.showDownloadButton);
      editPromptButton.style.display = formatSettings.addPrompt ? 'inline' : 'none';
      setTimeout(() => {
        formatButton.classList.remove('loading');
      }, 500);
    });
  }

  function showSettingsSaved() {
    settingsSaved.classList.add('show');
    setTimeout(() => {
      settingsSaved.classList.remove('show');
    }, 2000);
  }

  function showStatus(message, type = 'info', showRetry = false) {
    statusElement.className = 'status';
    if (type === 'success') {
      statusElement.classList.add('success');
    } else if (type === 'error') {
      statusElement.classList.add('error');
    }
    statusElement.classList.add('show');
    statusMessage.textContent = message;
    retryButton.style.display = showRetry ? 'block' : 'none';
  }

  // Toggle dropdown
  formatButton.addEventListener('click', (e) => {
    e.stopPropagation();
    formatDropdown.classList.toggle('show');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    formatDropdown.classList.remove('show');
    promptSection.classList.remove('show');
  });

  // Prevent dropdown from closing when clicking inside it
  formatDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Handle checkbox clicks (excluding mutually exclusive ones)
  [showTitleCheckbox, showUrlCheckbox, showDownloadButtonCheckbox].forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      saveFormatSettings();
      updatePreview();
    });
  });

  // Handle Show Timestamps checkbox (mutually exclusive with Paragraph Style)
  showTimestampsCheckbox.addEventListener('change', () => {
      if (showTimestampsCheckbox.checked) {
          paragraphStyleCheckbox.checked = false;
      }
      saveFormatSettings();
      updatePreview();
  });

  // Handle Add Spacing checkbox (mutually exclusive with Paragraph Style)
  addSpacingCheckbox.addEventListener('change', () => {
    if (addSpacingCheckbox.checked) {
      paragraphStyleCheckbox.checked = false;
    }
    saveFormatSettings();
    updatePreview();
  });

  // Handle Paragraph Style checkbox (mutually exclusive with Timestamps and Spacing)
  paragraphStyleCheckbox.addEventListener('change', () => {
      if (paragraphStyleCheckbox.checked) {
          addSpacingCheckbox.checked = false;
          showTimestampsCheckbox.checked = false;
      }
      saveFormatSettings();
      updatePreview();
  });

  // Special handling for addPrompt checkbox
  addPromptCheckbox.addEventListener('change', () => {
    const isChecked = addPromptCheckbox.checked;
    editPromptButton.style.display = isChecked ? 'inline' : 'none';
    if (!isChecked) {
      promptSection.classList.remove('show');
    }
    saveFormatSettings();
    updatePreview();
  });

  // Toggle prompt section visibility temporarily
  editPromptButton.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent the document click handler from immediately closing it
    promptSection.classList.toggle('show');
  });

  // Add click handler for closing the prompt section when clicking outside
  document.addEventListener('click', (e) => {
    if (!promptSection.contains(e.target) && 
        !editPromptButton.contains(e.target) && 
        promptSection.classList.contains('show')) {
      promptSection.classList.remove('show');
    }
  });

  // Close prompt section when format dropdown is closed
  formatDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Reset prompt to default
  resetPrompt.addEventListener('click', () => {
    customPrompt.value = defaultPrompt;
    saveFormatSettings();
  });

  // Save prompt when changed
  customPrompt.addEventListener('input', () => {
    saveFormatSettings();
    updatePreview();
  });

  async function getTranscript() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('youtube.com')) {
      showStatus('Please open a YouTube video', 'error');
      return null;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'copyTranscript' });
      if (response.status === 'success') {
        const lines = response.transcript.split('\n');
        let title = response.title;
        let transcriptLines = lines;

        // If the first line is a title, remove it from transcript and use it
        if (lines[0].startsWith('Title: ')) {
          title = lines[0].replace('Title: ', '').trim();
          transcriptLines = lines.slice(1);
        }

        return {
          transcript: transcriptLines.map(line => {
            const match = line.match(/\(([^)]+)\)\s*(.+)/);
            if (match) {
              return {
                timestamp: match[1],
                text: match[2]
              };
            }
            return {
              timestamp: '',
              text: line
            };
          }).filter(line => line.text.trim() !== ''),
          title: title,
          url: tab.url
        };
      } else {
        showStatus(response.message, 'error', true);
        return null;
      }
    } catch (error) {
      if (error.message.includes('Receiving end does not exist')) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          await new Promise(resolve => setTimeout(resolve, 100));
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'copyTranscript' });
          if (response.status === 'success') {
            const lines = response.transcript.split('\n');
            let title = response.title;
            let transcriptLines = lines;

            // If the first line is a title, remove it from transcript and use it
            if (lines[0].startsWith('Title: ')) {
              title = lines[0].replace('Title: ', '').trim();
              transcriptLines = lines.slice(1);
            }

            return {
              transcript: transcriptLines.map(line => {
                const match = line.match(/\(([^)]+)\)\s*(.+)/);
                if (match) {
                  return {
                    timestamp: match[1],
                    text: match[2]
                  };
                }
                return {
                  timestamp: '',
                  text: line
                };
              }).filter(line => line.text.trim() !== ''),
              title: title,
              url: tab.url
            };
          }
        } catch (retryError) {
          console.error('Retry failed:', retryError);
        }
      }
      showStatus('Error: Could not get transcript. Please refresh the page.', 'error', true);
      return null;
    }
  }

  function formatTranscript(transcript, title, url, settings) {
    let formattedTranscript = '';
    
    // Use settings passed as argument, not global state
    const { addPrompt, showTitle, showUrl, showTimestamps, addSpacing, isParagraphStyle, prompt } = settings;

    // Add prompt if enabled
    if (addPrompt) {
      formattedTranscript = prompt + '\n\n';
    }

    // Build and add a header with title and/or URL
    const headerLines = [];
    if (showTitle && title) {
      headerLines.push(`Title: ${title}`);
    }
    if (showUrl && url) {
      headerLines.push(`URL: ${url}`);
    }
    if (headerLines.length > 0) {
      formattedTranscript += headerLines.join('\n') + '\n\n';
    }

    if (isParagraphStyle) {
      // Join all text segments with a single space
      const transcriptText = transcript.map(line => line.text.trim()).join(' ');
      formattedTranscript += transcriptText;
    } else {
      // Original line-by-line formatting
      const lines = transcript.map(line => {
        const timestamp = line.timestamp;
        const text = line.text;
        if (showTimestamps && timestamp) {
          return `(${timestamp}) ${text}`;
        } else {
          return text;
        }
      });

      const lineSeparator = addSpacing ? '\n\n' : '\n';
      formattedTranscript += lines.join(lineSeparator);
    }

    return formattedTranscript.trim();
  }

  async function downloadTranscript(transcript, title, url, settings) {
    if (!transcript) return;
    
    const formattedTranscript = formatTranscript(transcript, title, url, settings);
    
    // Sanitize the title to make it a valid filename
    const sanitizedTitle = title
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase()
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    const blob = new Blob([formattedTranscript], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${sanitizedTitle}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }

  function updatePreview() {
    if (!currentTranscriptData) {
      return;
    }
    
    // Capture current settings for the preview
    const currentSettings = {
      showTimestamps: showTimestampsCheckbox.checked,
      showTitle: showTitleCheckbox.checked,
      showUrl: showUrlCheckbox.checked,
      addSpacing: addSpacingCheckbox.checked,
      isParagraphStyle: paragraphStyleCheckbox.checked,
      addPrompt: addPromptCheckbox.checked,
      prompt: customPrompt.value
    };

    // Use a slice of the transcript for performance
    const previewTranscript = currentTranscriptData.transcript.slice(0, 10);
    const formattedPreview = formatTranscript(
      previewTranscript, 
      currentTranscriptData.title, 
      currentTranscriptData.url,
      currentSettings // Pass settings object
    );
    previewArea.value = formattedPreview;
  }

  async function performAction(action) {
    lastAction = action;
    const button = action === 'copy' ? copyButton : downloadButton;
    
    // **THE FIX**: Capture settings BEFORE any async operation
    const formatSettings = {
      showTimestamps: showTimestampsCheckbox.checked,
      showTitle: showTitleCheckbox.checked,
      showUrl: showUrlCheckbox.checked,
      addSpacing: addSpacingCheckbox.checked,
      isParagraphStyle: paragraphStyleCheckbox.checked,
      addPrompt: addPromptCheckbox.checked,
      prompt: customPrompt.value
    };

    button.classList.add('loading');
    showStatus(action === 'copy' ? 'Copying transcript...' : 'Preparing download...');

    try {
      const result = await getTranscript();
      if (result) {
        currentTranscriptData = result;
        previewSection.classList.add('show');
        updatePreview();

        if (action === 'copy') {
          const formattedTranscript = formatTranscript(result.transcript, result.title, result.url, formatSettings);
          await navigator.clipboard.writeText(formattedTranscript);
          showStatus('Transcript copied!', 'success');
        } else {
          await downloadTranscript(result.transcript, result.title, result.url, formatSettings);
          showStatus('Download started!', 'success');
        }
      }
    } catch (error) {
      lastError = error;
      showStatus('Error: Could not ' + action + ' transcript. Please try again.', 'error', true);
    } finally {
      button.classList.remove('loading');
    }
  }

  copyButton.addEventListener('click', () => performAction('copy'));
  downloadButton.addEventListener('click', () => performAction('download'));
  
  retryButton.addEventListener('click', () => {
    if (lastAction) {
      performAction(lastAction);
    }
  });

  // --- Feedback Logic ---

  feedbackLink.addEventListener('click', () => {
    feedbackOverlay.classList.add('show');
  });

  cancelFeedback.addEventListener('click', () => {
    feedbackOverlay.classList.remove('show');
  });

  sendFeedback.addEventListener('click', async () => {
    const feedbackBody = feedbackText.value;
    if (feedbackBody.trim() === '') {
      return; // Don't send empty feedback
    }

    const recipient = 'hamzaw31@gmail.com';
    const subject = 'Feedback: Copy YouTube Transcript Extension';
    
    // Get debug info
    const version = chrome.runtime.getManifest().version;
    let debugInfo = `\n\n--- Debug Info ---\nExtension Version: ${version}`;
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url.includes('youtube.com')) {
          debugInfo += `\nVideo URL: ${tab.url}`;
      }
    } catch (e) {
      console.error("Could not get tab URL for feedback:", e);
    }

    const body = encodeURIComponent(feedbackBody + debugInfo);
    const mailtoUrl = `mailto:${recipient}?subject=${subject}&body=${body}`;

    chrome.tabs.create({ url: mailtoUrl });

    feedbackText.value = ''; // Clear the textarea
    feedbackOverlay.classList.remove('show');
    showStatus('Feedback sent. Thank you!', 'success');
  });
}); 