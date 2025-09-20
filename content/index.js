(() => {
  const PANEL_ID = 'yaivs-summary-panel';
  const STYLE_ID = 'yaivs-summary-styles';
  const YOUTUBE_TRANSCRIPT_ENDPOINT = 'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false';
  const DEFAULT_SETTINGS = {
    autoSummarize: false
  };

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

  async function getPanelMountPoint() {
    const selectors = [
      '#primary ytd-watch-metadata',
      'ytd-watch-metadata',
      '#info-contents',
      '#primary-inner',
      'ytd-watch-flexy'
    ];

    const combinedSelector = selectors.join(', ');
    await waitForElement(combinedSelector, 10000).catch(() => null);

    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (!container) {
        continue;
      }

      const description = container.querySelector?.('#description');
      if (description?.parentElement) {
        return { parent: description.parentElement, anchor: description };
      }

      return {
        parent: container,
        anchor: container.firstElementChild || null
      };
    }

    return null;
  }

  function decodeHtmlEntities(text) {
    if (!text) return '';
    DECODER.innerHTML = text;
    return DECODER.value;
  }

  function normalizeWhitespace(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : '';
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatSummaryHtml(summary) {
    if (!summary) return '';

    const escaped = escapeHtml(summary);
    const withLinks = escaped.replace(/\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]/g, (match, part1, part2, part3) => {
      const first = Number(part1);
      const second = Number(part2);
      const third = typeof part3 !== 'undefined' ? Number(part3) : null;
      let seconds = first * 60 + second;

      if (third !== null) {
        seconds = first * 3600 + second * 60 + third;
      }

      if (!Number.isFinite(seconds)) {
        return match;
      }

      return `<a href="#" class="yaivs-timestamp" data-seconds="${seconds}">${match}</a>`;
    });

    return withLinks.replace(/\n/g, '<br>');
  }

  async function parseJsonResponse(response, contextLabel) {
    const text = await response.text();
    if (!text) {
      console.debug('[YAIVS] empty response body', contextLabel);
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      console.debug('[YAIVS] failed to parse JSON', contextLabel, error.message);
      return null;
    }
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
  function parseTimestampToSeconds(raw) {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const parts = raw.split(':').map(part => part.trim()).filter(Boolean);
    if (parts.length === 0) {
      return null;
    }
    const numbers = parts.map(Number);
    if (numbers.some(Number.isNaN)) {
      return null;
    }
    if (numbers.length === 3) {
      return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
    }
    if (numbers.length === 2) {
      return numbers[0] * 60 + numbers[1];
    }
    if (numbers.length === 1) {
      return numbers[0];
    }
    return null;
  }

  function formatSecondsToLabel(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return '';
    }

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `[${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    }

    const totalMins = Math.floor(seconds / 60);
    return `[${totalMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
  }

  function selectCaptionTrack(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return null;
    }
    return tracks.find(track => track.kind !== 'asr') || tracks[0];
  }

  function ensureJson3(url) {
    if (!url) return null;
    return url.includes('fmt=json3') ? url : `${url}&fmt=json3`;
  }

  async function fetchCaptionEvents(baseUrl) {
    const url = ensureJson3(baseUrl);
    if (!url) return [];
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Transcript request failed (${res.status})`);
    }
    const json = await parseJsonResponse(res, 'caption-track');
    return json?.events || [];
  }

  async function fetchTranscriptSegments(videoUrl) {
    const transcriptData = await getTranscriptDict(videoUrl);
    if (!transcriptData?.transcript || transcriptData.transcript.length === 0) {
      return [];
    }

    const segments = transcriptData.transcript
      .map(([timestamp, text]) => {
        const clean = normalizeWhitespace(text);
        if (!clean) {
          return null;
        }
        const seconds = parseTimestampToSeconds(timestamp);
        const label = seconds !== null ? formatSecondsToLabel(seconds) : '';
        return { seconds, label, text: clean };
      })
      .filter(Boolean);

    console.debug('[YAIVS] transcript segments preview', segments.slice(0, 3));
    return segments;
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
      const { title, ytData, dataKey, resolvedType, captionTracks } = await resolveYouTubeDataFromHtml(html);
      const segments = await getTranscriptItems({ ytData, dataKey, captionTracks });
      const transcript = createTranscriptArray(segments, resolvedType);
      return { title, transcript };
    }

    const { title, ytData, dataKey, resolvedType, captionTracks } = await resolveYouTubeData(videoUrl);
    const segments = await getTranscriptItems({ ytData, dataKey, captionTracks });
    const transcript = createTranscriptArray(segments, resolvedType);
    return { title, transcript };
  }

  async function resolveYouTubeData(videoUrl) {
    const html = await fetchHtml(videoUrl);
    const dataKey = 'ytInitialData';
    let ytData = extractJsonFromHtml(html, dataKey);
    const playerData = extractJsonFromHtml(html, 'ytInitialPlayerResponse');
    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    let title =
      ytData?.videoDetails?.title ||
      ytData?.playerOverlays?.playerOverlayRenderer?.videoDetails?.playerOverlayVideoDetailsRenderer?.title?.simpleText ||
      playerData?.videoDetails?.title ||
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
        resolvedType: 'shorts',
        captionTracks
      };
    }

    return {
      title,
      ytData,
      dataKey,
      resolvedType: 'regular',
      captionTracks
    };
  }

  async function resolveYouTubeDataFromHtml(html) {
    try {
      const ytData = extractJsonFromHtml(html, 'ytInitialData');
      const playerData = extractJsonFromHtml(html, 'ytInitialPlayerResponse');
      const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
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
            resolvedType: 'regular',
            captionTracks
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
      resolvedType: 'shorts',
      captionTracks: playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []
    };
  }

  async function getTranscriptItems({ ytData, dataKey, captionTracks }) {
    const preferredTrack = selectCaptionTrack(captionTracks);
    if (preferredTrack?.baseUrl) {
      const events = await fetchCaptionEvents(preferredTrack.baseUrl);
      if (events.length) {
        return events;
      }
    }

    if (dataKey === 'ytInitialPlayerResponse') {
      const fallbackTracks = ytData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const track = selectCaptionTrack(fallbackTracks);
      if (!track?.baseUrl) {
        throw new Error('Transcript not available for this video.');
      }
      return fetchCaptionEvents(track.baseUrl);
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

    const context = {
      context: {
        client: {
          hl,
          visitorData,
          clientName: clientData?.[0]?.value,
          clientVersion: clientData?.[1]?.value
        },
        request: { useSsl: true }
      }
    };

    const body = {
      ...context,
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

    const json = await parseJsonResponse(res, 'transcript-initial');
    if (!json) {
      return [];
    }

    let segments =
      json.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments || [];

    const initialContinuations =
      json.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.continuations || [];

    const queue = [...initialContinuations];
    while (queue.length) {
      const next = queue.shift();
      const token =
        next?.continuationCommand?.token ||
        next?.nextContinuationData?.continuation ||
        next?.reloadContinuationData?.continuation ||
        null;

      if (!token) {
        continue;
      }

      const continuationRes = await fetch(YOUTUBE_TRANSCRIPT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...context, continuation: token })
      });

      if (!continuationRes.ok) {
        console.debug('[YAIVS] transcript continuation failed', continuationRes.status);
        continue;
      }

      const continuationJson = await parseJsonResponse(continuationRes, 'transcript-continuation');
      if (!continuationJson) {
        continue;
      }
      const continuationSegments =
        continuationJson.actions?.[0]?.appendContinuationItemsAction?.continuationItems ||
        continuationJson.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.continuationItems ||
        continuationJson.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems ||
        [];

      const newSegments = continuationSegments.filter(item => item?.transcriptSegmentRenderer);

      if (newSegments.length) {
        segments = segments.concat(newSegments);
      }

      const nextContinuations =
        continuationJson.actions?.[0]?.appendContinuationItemsAction?.continuations ||
        continuationJson.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.continuations ||
        continuationJson.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuations ||
        [];

      if (nextContinuations.length) {
        queue.push(...nextContinuations);
      }
    }

    return segments;
  }

  function createTranscriptArray(items, type) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    if (items[0]?.transcriptSegmentRenderer) {
      type = 'regular';
    } else if (items[0]?.segs || typeof items[0]?.tStartMs === 'number') {
      type = 'captions';
    }

    if (type === 'regular') {
      return items.map(item => getSegmentData(item));
    }

    return items.filter(event => event.segs).map(event => getShortsSegmentData(event));
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

      const segments = await fetchTranscriptSegments(window.location.href);
      if (!segments || segments.length === 0) {
        throw new Error('No transcript available for this video.');
      }

      const text = segments
        .map(segment => (segment.label ? `${segment.label} ${segment.text}` : segment.text))
        .join('\n')
        .trim();

      if (!text) {
        throw new Error('No transcript available for this video.');
      }

      if (containsAuthMessage(text)) {
        throw new Error('Transcript requires you to sign in to YouTube.');
      }

      const durationSeconds = segments.reduce((max, segment) => {
        if (typeof segment.seconds === 'number') {
          return Math.max(max, segment.seconds);
        }
        return max;
      }, 0);

      const result = { text, durationSeconds };
      this.cache.set(videoId, result);
      return result;
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
      this.isSummarizing = false;
      this.autoTriggeredVideoId = null;
      this.settings = { ...DEFAULT_SETTINGS };
      this.settingsReady = this.loadSettings();
      this.handleStorageChange = this.handleStorageChange.bind(this);
      chrome.storage.onChanged.addListener(this.handleStorageChange);
      this.observeNavigation();
      this.setup();
    }

    observeNavigation() {
      window.addEventListener('yt-navigate-start', () => {
        this.autoTriggeredVideoId = null;
        this.resetState();
      });
      window.addEventListener('yt-navigate-finish', () => this.setup());
    }

    async setup() {
      injectStyles();

      await this.settingsReady;

      const mountPoint = await getPanelMountPoint();
      if (!mountPoint?.parent) {
        console.warn('[YAIVS] Unable to locate a mount point for the summary panel.');
        return;
      }

      let panel = document.getElementById(PANEL_ID);
      if (!panel) {
        panel = this.createPanel();
      }

      const { parent, anchor } = mountPoint;
      const alreadyMounted = panel.parentElement === parent;

      if (anchor) {
        if (!alreadyMounted || panel.nextElementSibling !== anchor) {
          parent.insertBefore(panel, anchor);
        }
      } else if (!alreadyMounted || parent.firstElementChild !== panel) {
        if (parent.firstChild) {
          parent.insertBefore(panel, parent.firstChild);
        } else {
          parent.appendChild(panel);
        }
      }

      this.bindElements(panel);
      this.resetState();
      this.maybeAutoSummarize();
    }

    createPanel() {
      const container = document.createElement('section');
      container.id = PANEL_ID;
      container.className = 'yaivs-panel';
      container.innerHTML = `
        <header class="yaivs-panel__header">
          <h2 class="yaivs-panel__title">AI Summary</h2>
          <button class="yaivs-button" type="button" id="yaivs-generate">Summarize</button>
        </header>
        <p class="yaivs-status yaivs-status--info" id="yaivs-status">Click to summarize the current video.</p>
        <div class="yaivs-summary" id="yaivs-summary" hidden></div>
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

      if (!panel.dataset.timestampsBound) {
        panel.addEventListener('click', event => this.handleTimestampClick(event));
        panel.dataset.timestampsBound = 'true';
      }

      this.updateInfoMessage();
    }

    resetState() {
      if (!this.panel) return;

      if (this.summaryEl) {
        this.summaryEl.innerHTML = '';
        this.summaryEl.hidden = true;
      }

      this.updateInfoMessage();

      if (this.generateBtn) {
        this.generateBtn.disabled = false;
        this.generateBtn.textContent = 'Summarize';
      }
    }

    async handleSummarize() {
      if (!this.generateBtn || this.generateBtn.disabled) {
        return;
      }

      const videoId = this.collector.getVideoId();
      if (videoId) {
        this.autoTriggeredVideoId = videoId;
      }

      this.setLoading(true, 'Fetching transcript…');
      this.isSummarizing = true;

      try {
        await ensureGeminiKey();
        const { text: transcript, durationSeconds } = await this.collector.collect();
        this.setLoading(true, 'Summarizing highlights…');

        const response = await chrome.runtime.sendMessage({
          type: 'summarizeWithGemini',
          transcript,
          durationSeconds
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
        this.isSummarizing = false;
      }
    }

    renderSummary(summary) {
      if (!this.summaryEl) return;

      const text = summary ? summary.toString().trim() : '';
      if (!text) {
        this.summaryEl.hidden = true;
        this.summaryEl.innerHTML = '';
        return;
      }

      this.summaryEl.innerHTML = formatSummaryHtml(text);
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
      this.generateBtn.textContent = isLoading ? 'Summarizing…' : 'Summarize';
      if (message) {
        this.updateStatus(message, 'loading');
      }
    }

    async maybeAutoSummarize() {
      await this.settingsReady;

      if (!this.settings.autoSummarize) {
        return;
      }

      const videoId = this.collector.getVideoId();
      if (!videoId || this.autoTriggeredVideoId === videoId) {
        return;
      }

      if (this.generateBtn?.disabled || this.isSummarizing) {
        return;
      }

      if (!this.summaryEl?.hidden) {
        return;
      }

      this.handleSummarize();
    }

    handleTimestampClick(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!target.classList.contains('yaivs-timestamp')) {
        return;
      }

      event.preventDefault();
      const seconds = Number(target.dataset.seconds || 'NaN');
      if (!Number.isFinite(seconds)) {
        return;
      }

      const video = document.querySelector('video');
      if (!video) {
        return;
      }

      video.currentTime = seconds;
      video.focus?.();
    }

    async loadSettings() {
      try {
        const stored = await chrome.storage.sync.get(['autoSummarize']);
        if (Object.prototype.hasOwnProperty.call(stored, 'autoSummarize')) {
          this.settings.autoSummarize = Boolean(stored.autoSummarize);
        }
      } catch (error) {
        console.warn('[YAIVS] Failed to load settings', error);
      }
      return this.settings;
    }

    handleStorageChange(changes, area) {
      if (area !== 'sync') {
        return;
      }

      let updated = false;
      if (Object.prototype.hasOwnProperty.call(changes, 'autoSummarize')) {
        this.settings.autoSummarize = Boolean(changes.autoSummarize.newValue);
        updated = true;
      }

      if (!updated) {
        return;
      }

      this.settingsReady = Promise.resolve(this.settings);
      if (!this.isSummarizing && this.summaryEl?.hidden) {
        this.updateInfoMessage();
      }

      if (this.settings.autoSummarize) {
        this.autoTriggeredVideoId = null;
        this.maybeAutoSummarize();
      }
    }

    updateInfoMessage() {
      if (!this.statusEl) {
        return;
      }

      if (this.isSummarizing) {
        return;
      }

      if (!this.summaryEl?.hidden) {
        return;
      }

      if (this.settings.autoSummarize) {
        this.statusEl.textContent = 'Preparing summary…';
        this.statusEl.className = 'yaivs-status yaivs-status--loading';
      } else {
        this.statusEl.textContent = 'Click to summarize the current video.';
        this.statusEl.className = 'yaivs-status yaivs-status--info';
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
        margin: 12px 0 20px;
        padding: 12px 0;
        border-top: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.08));
        border-bottom: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.08));
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .yaivs-panel__header {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .yaivs-panel__title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--yt-spec-text-primary, #0f0f0f);
        letter-spacing: 0.3px;
      }

      .yaivs-button {
        padding: 6px 14px;
        border-radius: 16px;
        border: 1px solid var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.1));
        background: var(--yt-spec-general-background-a, rgba(255, 255, 255, 0.08));
        color: var(--yt-spec-text-primary, #0f0f0f);
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        cursor: pointer;
        transition: background 0.2s ease, border 0.2s ease, color 0.2s ease;
        margin-left: auto;
        flex-shrink: 0;
      }

      .yaivs-button:hover:enabled {
        background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.08));
      }

      .yaivs-button:disabled {
        background: var(--yt-spec-button-chip-background-disabled, rgba(0, 0, 0, 0.05));
        border-color: transparent;
        color: var(--yt-spec-text-disabled, rgba(0, 0, 0, 0.4));
        cursor: not-allowed;
      }

      .yaivs-status {
        margin: 0;
        font-size: 13px;
        color: var(--yt-spec-text-secondary, #606060);
      }

      .yaivs-status--loading,
      .yaivs-status--success {
        color: var(--yt-spec-text-primary, #0f0f0f);
      }

      .yaivs-status--error {
        color: var(--yt-spec-brand-danger, #d93025);
      }

      .yaivs-summary {
        margin: 0;
        padding: 0;
        border: none;
        background: transparent;
        font-family: inherit;
        font-size: 14px;
        line-height: 1.6;
        white-space: normal;
        color: var(--yt-spec-text-primary, #0f0f0f);
      }

      .yaivs-summary .yaivs-timestamp {
        color: var(--yt-spec-call-to-action, #3ea6ff);
        text-decoration: none;
        font-weight: 500;
        cursor: pointer;
      }

      .yaivs-summary .yaivs-timestamp:hover {
        text-decoration: underline;
      }
    `;

    document.head.appendChild(style);
  }

  // ---------- bootstrap ----------
  const collector = new TranscriptCollector();
  new SummaryPanel(collector);
})();
