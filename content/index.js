(() => {
  const PANEL_ID = 'yaivs-summary-panel';
  const STYLE_ID = 'yaivs-summary-styles';
  const YOUTUBE_TRANSCRIPT_ENDPOINT = 'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false';

  // ---------- utility helpers ----------
  const DECODER = document.createElement('textarea');
  const AUTH_PATTERNS = [
    'sign in',
    'log in',
    'to continue',
    "verify it's you",
    'switch account',
    'privacy policy',
    'terms of service',
    'try youtube premium',
    'youtube music premium',
    'confirm you are not a robot'
  ];

  function waitForElement(selector, timeout = 8000) {
    const existing = document.querySelector(selector);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.documentElement, { childList: true, subtree: true });

      if (timeout) {
        setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Timed out waiting for selector: ${selector}`));
        }, timeout);
      }
    });
  }

  async function getMetadataContainer() {
    const selectors = [
      '#primary-inner ytd-watch-metadata',
      'ytd-watch-metadata',
      '#info-contents',
      '#primary-inner',
      'ytd-watch-flexy'
    ];

    const combinedSelector = selectors.join(', ');
    await waitForElement(combinedSelector, 10000).catch(() => null);

    for (const selector of selectors) {
      const match = document.querySelector(selector);
      if (match) {
        return match;
      }
    }

    return null;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function decodeHtmlEntities(text) {
    if (!text) return '';
    DECODER.innerHTML = text;
    return DECODER.value;
  }

  function normalizeWhitespace(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : '';
  }

  function containsAuthMessage(text) {
    if (!text) return false;
    const clean = text.toLowerCase();
    const hit = AUTH_PATTERNS.some(pattern => clean.includes(pattern));
    if (!hit) return false;
    const wordCount = clean.split(/\s+/).filter(Boolean).length;
    return wordCount < 70 || clean.length < 350;
  }

  function getVideoIdFromUrl(urlString) {
    try {
      const url = new URL(urlString);
      return url.searchParams.get('v');
    } catch (_err) {
      return null;
    }
  }

  function extractJsonFromHtml(html, key) {
    const regexes = [
      new RegExp(`window\\["${key}"\\]\\s*=\\s*({[\\s\\S]+?})\\s*;`),
      new RegExp(`var ${key}\\s*=\\s*({[\\s\\S]+?})\\s*;`),
      new RegExp(`${key}\\s*=\\s*({[\\s\\S]+?})\\s*;`)
    ];

    for (const regex of regexes) {
      const match = html.match(regex);
      if (match && match[1]) {
        try {
          return JSON.parse(match[1]);
        } catch (error) {
          console.warn(`⚠️ Failed to parse ${key}:`, error.message);
        }
      }
    }
    return null;
  }

  async function fetchHtml(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error(`Failed to fetch YouTube page (${res.status})`);
    }
    return res.text();
  }

  // ---------- transcript helpers ----------
  async function fetchTranscriptLines(videoUrl) {
    const transcriptData = await getTranscriptDict(videoUrl);
    if (!transcriptData?.transcript || transcriptData.transcript.length === 0) {
      return [];
    }
    const lines = transcriptData.transcript
      .map(([, text]) => normalizeWhitespace(text))
      .filter(Boolean);
    console.debug('[YAIVS] transcript lines preview', lines.slice(0, 5));
    return lines;
  }

  async function getTranscriptDict(videoUrl) {
    const isShorts = /youtube\.com\/shorts\//.test(videoUrl);
    const videoId = isShorts
      ? videoUrl.split('/shorts/')[1]?.split(/[/?#&]/)[0]
      : new URL(videoUrl).searchParams.get('v');

    if (!videoId) {
      throw new Error('Unable to determine video id');
    }

    if (isShorts) {
      const transformedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const html = await fetchHtml(transformedUrl);
      const { title, ytData, dataKey, resolvedType } = await resolveYouTubeDataFromHtml(html);
      const segments = await getTranscriptItems(ytData, dataKey);
      const transcript = createTranscriptArray(segments, resolvedType);
      return { title, transcript };
    }

    const { title, ytData, dataKey, resolvedType } = await resolveYouTubeData(videoUrl);
    const segments = await getTranscriptItems(ytData, dataKey);
    const transcript = createTranscriptArray(segments, resolvedType);
    return { title, transcript };
  }

  async function resolveYouTubeData(videoUrl) {
    const html = await fetchHtml(videoUrl);
    const dataKey = 'ytInitialData';
    let ytData = extractJsonFromHtml(html, dataKey);

    let title =
      ytData?.videoDetails?.title ||
      ytData?.playerOverlays?.playerOverlayRenderer?.videoDetails?.playerOverlayVideoDetailsRenderer?.title?.simpleText ||
      '';

    const panels = ytData?.engagementPanels || [];
    const hasTranscriptPanel = panels.some(panel =>
      panel.engagementPanelSectionListRenderer?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint
    );

    if (!hasTranscriptPanel) {
      const fallbackData = extractJsonFromHtml(html, 'ytInitialPlayerResponse');
      return {
        title: title || fallbackData?.videoDetails?.title || '',
        ytData: fallbackData,
        dataKey: 'ytInitialPlayerResponse',
        resolvedType: 'shorts'
      };
    }

    return {
      title,
      ytData,
      dataKey,
      resolvedType: 'regular'
    };
  }

  async function resolveYouTubeDataFromHtml(html) {
    try {
      const ytData = extractJsonFromHtml(html, 'ytInitialData');
      if (ytData) {
        const title =
          ytData?.videoDetails?.title ||
          ytData?.playerOverlays?.playerOverlayRenderer?.videoDetails?.playerOverlayVideoDetailsRenderer?.title?.simpleText ||
          '';

        const panels = ytData?.engagementPanels || [];
        const hasTranscriptPanel = panels.some(panel =>
          panel.engagementPanelSectionListRenderer?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint
        );

        if (hasTranscriptPanel) {
          return {
            title,
            ytData,
            dataKey: 'ytInitialData',
            resolvedType: 'regular'
          };
        }
      }
    } catch (error) {
      console.warn('Failed to extract ytInitialData from HTML:', error);
    }

    const playerData = extractJsonFromHtml(html, 'ytInitialPlayerResponse');
    const fallbackTitle =
      playerData?.videoDetails?.title ||
      playerData?.microformat?.playerMicroformatRenderer?.title?.simpleText ||
      '';
    return {
      title: fallbackTitle,
      ytData: playerData,
      dataKey: 'ytInitialPlayerResponse',
      resolvedType: 'shorts'
    };
  }

  async function getTranscriptItems(ytData, dataKey) {
    if (dataKey === 'ytInitialPlayerResponse') {
      const baseUrl = ytData?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0]?.baseUrl;
      if (!baseUrl) {
        throw new Error('Transcript not available for this video.');
      }
      const captionUrl = baseUrl + '&fmt=json3';
      const json = await fetch(captionUrl).then(res => {
        if (!res.ok) {
          throw new Error(`Transcript request failed (${res.status})`);
        }
        return res.json();
      });
      return json.events || [];
    }

    const continuationParams = ytData.engagementPanels?.find(panel =>
      panel.engagementPanelSectionListRenderer?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint
    )?.engagementPanelSectionListRenderer?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint?.params;

    if (!continuationParams) {
      throw new Error('Transcript not available for this video');
    }

    const hl =
      ytData.topbar?.desktopTopbarRenderer?.searchbox?.fusionSearchboxRenderer?.config?.webSearchboxConfig?.requestLanguage ||
      'en';
    const clientData = ytData.responseContext?.serviceTrackingParams?.[0]?.params;
    const visitorData = ytData.responseContext?.webResponseContextExtensionData?.ytConfigData?.visitorData;

    const body = {
      context: {
        client: {
          hl,
          visitorData,
          clientName: clientData?.[0]?.value,
          clientVersion: clientData?.[1]?.value
        },
        request: { useSsl: true }
      },
      params: continuationParams
    };

    const res = await fetch(YOUTUBE_TRANSCRIPT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const snippet = await res.text().catch(() => '');
      console.debug('[YAIVS] youtubei transcript error', res.status, snippet.slice(0, 300));
      throw new Error(`Transcript request failed (${res.status})`);
    }

    const json = await res.json();
    return (
      json.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments || []
    );
  }

  function createTranscriptArray(items, type) {
    return type === 'regular'
      ? items.map(item => getSegmentData(item))
      : items.filter(event => event.segs).map(event => getShortsSegmentData(event));
  }

  function getSegmentData(item) {
    const seg = item?.transcriptSegmentRenderer;
    if (!seg) {
      return ['', ''];
    }
    const text = seg.snippet?.runs?.map(run => decodeHtmlEntities(run.text)).join(' ') || '';
    return [seg.startTimeText?.simpleText || '', text];
  }

  function getShortsSegmentData(event) {
    const timestamp = msToTimestamp(event.tStartMs);
    const text = (event.segs || []).map(seg => decodeHtmlEntities(seg.utf8 || '')).join(' ');
    return [timestamp, text.replace(/\n/g, ' ')];
  }

  function msToTimestamp(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // ---------- transcript collector ----------
  class TranscriptCollector {
    constructor() {
      this.cache = new Map();
    }

    getVideoId() {
      return getVideoIdFromUrl(window.location.href);
    }

    async collect() {
      const videoId = this.getVideoId();
      if (!videoId) {
        throw new Error('Not on a YouTube watch page.');
      }

      if (this.cache.has(videoId)) {
        return this.cache.get(videoId);
      }

      const lines = await fetchTranscriptLines(window.location.href);
      if (!lines || lines.length === 0) {
        throw new Error('No transcript available for this video.');
      }

      const text = normalizeWhitespace(lines.join(' '));
      if (!text) {
        throw new Error('No transcript available for this video.');
      }

      if (containsAuthMessage(text)) {
        throw new Error('Transcript requires you to sign in to YouTube.');
      }

      this.cache.set(videoId, text);
      return text;
    }
  }

  // ---------- Gemini key manager ----------
  async function ensureGeminiKey() {
    const { geminiKey } = await chrome.storage.sync.get(['geminiKey']);
    if (geminiKey) {
      return geminiKey;
    }

    const entered = window.prompt('Enter your Gemini 1.5 Flash API key (stored locally in Chrome Sync):');
    if (!entered) {
      throw new Error('Gemini API key is required to summarize.');
    }

    const trimmed = entered.trim();
    if (!trimmed) {
      throw new Error('Gemini API key cannot be empty.');
    }

    const response = await chrome.runtime.sendMessage({
      type: 'saveGeminiKey',
      key: trimmed
    });

    if (!response || response.status !== 'ok') {
      throw new Error(response?.message || 'Failed to save Gemini API key.');
    }

    return trimmed;
  }

  // ---------- summary panel ----------
  class SummaryPanel {
    constructor(collector) {
      this.collector = collector;
      this.generateHandler = null;
      this.panel = null;
      this.summaryEl = null;
      this.statusEl = null;
      this.generateBtn = null;
      this.observeNavigation();
      this.setup();
    }

    observeNavigation() {
      window.addEventListener('yt-navigate-start', () => this.resetState());
      window.addEventListener('yt-navigate-finish', () => this.setup());
    }

    async setup() {
      injectStyles();

      const container = await getMetadataContainer();
      if (!container) {
        console.warn('[YAIVS] Unable to locate a mount point for the summary panel.');
        return;
      }

      let panel = document.getElementById(PANEL_ID);
      if (!panel) {
        panel = this.createPanel();
        const description = container.querySelector?.('#description');
        if (description?.parentElement) {
          description.parentElement.insertBefore(panel, description);
        } else if (container.firstChild) {
          container.insertBefore(panel, container.firstChild);
        } else {
          container.appendChild(panel);
        }
      }

      this.bindElements(panel);
      this.resetState();
    }

    createPanel() {
      const container = document.createElement('section');
      container.id = PANEL_ID;
      container.className = 'yaivs-panel';
      container.innerHTML = `
        <header class="yaivs-panel__header">
          <h2 class="yaivs-panel__title">AI Summary</h2>
          <button class="yaivs-button" type="button" id="yaivs-generate">Summarize with Gemini</button>
        </header>
        <p class="yaivs-status yaivs-status--info" id="yaivs-status">Click to summarize the current video.</p>
        <pre class="yaivs-summary" id="yaivs-summary" hidden></pre>
      `;
      return container;
    }

    bindElements(panel) {
      this.panel = panel;
      this.summaryEl = panel.querySelector('#yaivs-summary');
      this.statusEl = panel.querySelector('#yaivs-status');
      this.generateBtn = panel.querySelector('#yaivs-generate');

      if (this.generateHandler) {
        this.generateBtn.removeEventListener('click', this.generateHandler);
      }

      this.generateHandler = () => this.handleSummarize();
      this.generateBtn.addEventListener('click', this.generateHandler);
    }

    resetState() {
      if (!this.panel) return;

      if (this.summaryEl) {
        this.summaryEl.textContent = '';
        this.summaryEl.hidden = true;
      }

      if (this.statusEl) {
        this.statusEl.textContent = 'Click to summarize the current video.';
        this.statusEl.className = 'yaivs-status yaivs-status--info';
      }

      if (this.generateBtn) {
        this.generateBtn.disabled = false;
        this.generateBtn.textContent = 'Summarize with Gemini';
      }
    }

    async handleSummarize() {
      if (!this.generateBtn || this.generateBtn.disabled) {
        return;
      }

      this.setLoading(true, 'Fetching transcript...');

      try {
        await ensureGeminiKey();
        const transcript = await this.collector.collect();
        this.setLoading(true, 'Summarizing with Gemini 1.5 Flash...');

        const response = await chrome.runtime.sendMessage({
          type: 'summarizeWithGemini',
          transcript
        });

        if (!response) {
          throw new Error('No response from background service.');
        }

        if (response.status === 'error') {
          throw new Error(response.message);
        }

        this.renderSummary(response.summary);
        this.updateStatus('Summary ready.', 'success');
      } catch (error) {
        console.error('Summary generation failed', error);
        this.renderSummary('');
        this.updateStatus(error.message || 'Failed to generate summary.', 'error');
        chrome.runtime.sendMessage({ type: 'logError', message: error.message || String(error) }).catch(() => {});
      } finally {
        this.setLoading(false);
      }
    }

    renderSummary(summary) {
      if (!this.summaryEl) return;

      const text = summary ? summary.toString().trim() : '';
      if (!text) {
        this.summaryEl.hidden = true;
        this.summaryEl.textContent = '';
        return;
      }

      this.summaryEl.textContent = text;
      this.summaryEl.hidden = false;
    }

    updateStatus(message, variant) {
      if (!this.statusEl) return;
      this.statusEl.textContent = message;
      this.statusEl.className = `yaivs-status yaivs-status--${variant}`;
    }

    setLoading(isLoading, message) {
      if (!this.generateBtn) return;
      this.generateBtn.disabled = isLoading;
      this.generateBtn.textContent = isLoading ? 'Summarizing…' : 'Summarize with Gemini';
      if (message) {
        this.updateStatus(message, 'loading');
      }
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        padding: 16px;
        margin-top: 16px;
        border-radius: 12px;
        border: 1px solid rgba(0, 0, 0, 0.08);
        background: rgba(248, 249, 251, 0.85);
        backdrop-filter: blur(8px);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .yaivs-panel__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }

      .yaivs-panel__title {
        margin: 0;
        font-size: 18px;
        color: #0f172a;
      }

      .yaivs-button {
        padding: 8px 14px;
        border-radius: 8px;
        border: none;
        font-size: 14px;
        font-weight: 600;
        background: #1a73e8;
        color: #fff;
        cursor: pointer;
        transition: background 0.2s ease;
      }

      .yaivs-button:hover:enabled {
        background: #1558b0;
      }

      .yaivs-button:disabled {
        background: #a1c2f7;
        cursor: not-allowed;
      }

      .yaivs-status {
        margin: 0;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid transparent;
        font-size: 13px;
        text-align: left;
      }

      .yaivs-status--info {
        background: rgba(26, 115, 232, 0.1);
        color: #0b3c70;
        border-color: rgba(26, 115, 232, 0.2);
      }

      .yaivs-status--loading {
        background: rgba(26, 115, 232, 0.08);
        color: #0b3c70;
        border-color: rgba(26, 115, 232, 0.24);
      }

      .yaivs-status--success {
        background: rgba(15, 157, 88, 0.12);
        color: #0f5132;
        border-color: rgba(15, 157, 88, 0.24);
      }

      .yaivs-status--error {
        background: rgba(217, 48, 37, 0.12);
        color: #7f1d1d;
        border-color: rgba(217, 48, 37, 0.24);
      }

      .yaivs-summary {
        margin: 0;
        padding: 12px;
        border-radius: 8px;
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.1);
        font-family: inherit;
        font-size: 14px;
        line-height: 1.5;
        white-space: pre-wrap;
        max-height: 320px;
        overflow-y: auto;
      }
    `;

    document.head.appendChild(style);
  }

  // ---------- bootstrap ----------
  const collector = new TranscriptCollector();
  new SummaryPanel(collector);
})();
