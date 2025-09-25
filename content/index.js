cod(() => {
  // Guard against double-injection when user clicks the extension icon to inject on demand
  const ROOT = document.documentElement;
  if (ROOT && ROOT.hasAttribute('data-yaivs-active')) {
    return;
  }
  if (ROOT) {
    ROOT.setAttribute('data-yaivs-active', 'true');
  }
  const PANEL_ID = 'yaivs-summary-panel';
  const STYLE_ID = 'yaivs-summary-styles';
  const YOUTUBE_TRANSCRIPT_ENDPOINT = 'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false';
  const DEFAULT_SETTINGS = {
    autoSummarize: false,
    provider: 'gemini',
    summaryMode: 'simple',
    customPrompt: '',
    includeTimestamps: true
  };
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

  // ---------------------------------------------------------------------------
  // Generic helpers
  // ---------------------------------------------------------------------------
  function waitForElement(selector, timeout = 8000) {
    const existing = document.querySelector(selector);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
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

  function findDescriptionElement(root = document) {
    const candidates = [
      '#description-inline-expander',
      '#description',
      'ytd-watch-metadata #description-inline-expander',
      'ytd-watch-metadata #description'
    ];
    for (const sel of candidates) {
      const el = root.querySelector?.(sel);
      if (el) return el;
    }
    return null;
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
      if (!container) continue;

      const description = findDescriptionElement(container) || findDescriptionElement(document);
      if (description?.parentElement) {
        return { parent: description.parentElement, anchor: description, container };
      }

      return {
        parent: container,
        anchor: container.firstElementChild || null,
        container
      };
    }

    return null;
  }

  function decodeHtml(text) {
    if (!text) return '';
    DECODER.innerHTML = text;
    return DECODER.value;
  }

  function cleanWhitespace(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : '';
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatSummaryHtml(summary, linkify = true) {
    if (!summary) return '';
    const escaped = escapeHtml(summary);
    const tsPattern = /\[((\d{1,3}):(\d{2})(?::(\d{2}))?)(?:\s*[–-]\s*((\d{1,3}):(\d{2})(?::(\d{2}))?))?\]/g;

    if (!linkify) {
      return escaped.replace(tsPattern, '').replace(/\n/g, '<br>');
    }

    const withLinks = escaped.replace(tsPattern, (
      match,
      fullA,
      a1,
      a2,
      a3,
      fullB,
      b1,
      b2,
      b3
    ) => {
      const toSeconds = (hOrM, m, s) => {
        const H = Number(hOrM);
        const M = Number(m);
        const S = typeof s !== 'undefined' ? Number(s) : null;
        if ([H, M].some(Number.isNaN)) return null;
        if (S !== null && Number.isNaN(S)) return null;
        return S === null ? H * 60 + M : H * 3600 + M * 60 + S;
      };

      const secA = toSeconds(a1, a2, a3);
      if (secA === null) return match;
      const anchorA = `<a href="#" class="yaivs-timestamp" data-seconds="${secA}">${fullA}</a>`;

      if (!fullB) {
        return `[${anchorA}]`;
      }

      const secB = toSeconds(b1, b2, b3);
      if (secB === null) return `[${anchorA}]`;
      const dash = match.includes('–') ? '–' : '-';
      const anchorB = `<a href="#" class="yaivs-timestamp" data-seconds="${secB}">${fullB}</a>`;
      return `[${anchorA} ${dash} ${anchorB}]`;
    });

    return withLinks.replace(/\n/g, '<br>');
  }

  async function parseJsonResponse(response, label) {
    const text = await response.text();
    if (!text) {
      console.debug('[YAIVS] empty response body', label);
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      console.debug('[YAIVS] failed to parse JSON', label, error.message);
      return null;
    }
  }

  async function fetchHtml(url) {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Failed to fetch YouTube page (${response.status})`);
    }
    return response.text();
  }

  function containsAuthMessage(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    if (!AUTH_PATTERNS.some(pattern => lower.includes(pattern))) return false;
    const wordCount = lower.split(/\s+/).filter(Boolean).length;
    return wordCount < 70 || lower.length < 350;
  }

  function parseTimestamp(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const parts = raw.split(':').map(part => part.trim()).filter(Boolean);
    if (!parts.length) return null;
    const numbers = parts.map(Number);
    if (numbers.some(Number.isNaN)) return null;
    if (numbers.length === 3) return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
    if (numbers.length === 2) return numbers[0] * 60 + numbers[1];
    if (numbers.length === 1) return numbers[0];
    return null;
  }

  function secondsToLabel(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `[${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    }
    return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
  }

  function extractJsonFromHtml(html, key) {
    const patterns = [
      new RegExp(`window\\["${key}"\\]\\s*=\\s*({[\\s\\S]+?})\\s*;`),
      new RegExp(`var ${key}\\s*=\\s*({[\\s\\S]+?})\\s*;`),
      new RegExp(`${key}\\s*=\\s*({[\\s\\S]+?})\\s*;`)
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        try {
          return JSON.parse(match[1]);
        } catch (error) {
          console.warn(`⚠️ Failed to parse ${key}:`, error.message);
        }
      }
    }
    return null;
  }

  function getVideoIdFromUrl(urlString) {
    try {
      return new URL(urlString).searchParams.get('v');
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Settings manager
  // ---------------------------------------------------------------------------
  class SettingsManager {
    constructor(defaults) {
      this.defaults = { ...defaults };
      this.values = { ...defaults };
      this.ready = this.load();
      chrome.storage.onChanged.addListener(this.handleStorageChange.bind(this));
    }

    async load() {
      try {
        const stored = await chrome.storage.sync.get([
          'autoSummarize',
          'provider',
          'summaryMode',
          'customPrompt',
          'includeTimestamps'
        ]);
        if (Object.prototype.hasOwnProperty.call(stored, 'autoSummarize')) {
          this.values.autoSummarize = Boolean(stored.autoSummarize);
        }
        this.values.provider = stored.provider || this.defaults.provider || 'gemini';
        this.values.summaryMode = stored.summaryMode || this.defaults.summaryMode || 'simple';
        this.values.customPrompt = stored.customPrompt || this.defaults.customPrompt || '';
        this.values.includeTimestamps = stored.includeTimestamps !== false;
      } catch (error) {
        console.warn('[YAIVS] Failed to load settings', error);
        this.values.provider = this.defaults.provider || 'gemini';
        this.values.summaryMode = this.defaults.summaryMode || 'simple';
        this.values.customPrompt = this.defaults.customPrompt || '';
        this.values.includeTimestamps = true;
      }
      return this.values;
    }

    handleStorageChange(changes, area) {
      if (area !== 'sync') return;
      let patched = false;

      if (Object.prototype.hasOwnProperty.call(changes, 'autoSummarize')) {
        this.values.autoSummarize = Boolean(changes.autoSummarize.newValue);
        patched = true;
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'provider')) {
        this.values.provider = changes.provider.newValue || 'gemini';
        patched = true;
      }

      // chromeOutputLanguage removed

      if (Object.prototype.hasOwnProperty.call(changes, 'summaryMode')) {
        this.values.summaryMode = changes.summaryMode.newValue || 'simple';
        patched = true;
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'customPrompt')) {
        this.values.customPrompt = changes.customPrompt.newValue || '';
        patched = true;
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'includeTimestamps')) {
        this.values.includeTimestamps = Boolean(changes.includeTimestamps.newValue);
        patched = true;
      }

      if (patched && typeof this.onChange === 'function') {
        this.onChange({ ...this.values });
      }
    }

    get(key) {
      return this.values[key];
    }

    subscribe(callback) {
      this.onChange = callback;
    }
  }

  // ---------------------------------------------------------------------------
  // Transcript service
  // ---------------------------------------------------------------------------
  class TranscriptService {
    constructor() {
      this.cache = new Map();
    }

    getVideoId() {
      return getVideoIdFromUrl(window.location.href);
    }

    async collect() {
      const videoId = this.getVideoId();
      if (!videoId) throw new Error('Not on a YouTube watch page.');
      if (this.cache.has(videoId)) return this.cache.get(videoId);

      const segments = await this.fetchSegments(window.location.href);
      if (!segments.length) throw new Error('No transcript available for this video.');

      const text = segments
        .map(segment => (segment.label ? `${segment.label} ${segment.text}` : segment.text))
        .join('\n')
        .trim();

      if (!text) throw new Error('No transcript available for this video.');
      if (containsAuthMessage(text)) throw new Error('Transcript requires you to sign in to YouTube.');

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

    async fetchSegments(videoUrl) {
      const transcriptData = await this.fetchTranscriptData(videoUrl);
      if (!transcriptData?.transcript?.length) return [];

      return transcriptData.transcript
        .map(([timestamp, text]) => {
          const clean = cleanWhitespace(text);
          if (!clean) return null;
          const seconds = parseTimestamp(timestamp);
          const label = seconds !== null ? secondsToLabel(seconds) : '';
          return { seconds, label, text: clean };
        })
        .filter(Boolean);
    }

    async fetchTranscriptData(videoUrl) {
      const isShorts = /youtube\.com\/shorts\//.test(videoUrl);
      const videoId = isShorts
        ? videoUrl.split('/shorts/')[1]?.split(/[/?#&]/)[0]
        : new URL(videoUrl).searchParams.get('v');

      if (!videoId) throw new Error('Unable to determine video id');

      if (isShorts) {
        const html = await fetchHtml(`https://www.youtube.com/watch?v=${videoId}`);
        return this.resolveAndCollect(html);
      }

      const html = await fetchHtml(videoUrl);
      return this.resolveAndCollect(html);
    }

    async resolveAndCollect(html) {
      const ytData = extractJsonFromHtml(html, 'ytInitialData');
      const playerData = extractJsonFromHtml(html, 'ytInitialPlayerResponse');

      const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const hasTranscriptPanel = ytData?.engagementPanels?.some(panel =>
        panel.engagementPanelSectionListRenderer?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint
      );

      const transcriptItems = hasTranscriptPanel
        ? await this.fetchTranscriptItems({ ytData, captionTracks })
        : await this.fetchCaptionEventsFromTrack(playerData);

      const resolvedType = hasTranscriptPanel ? 'regular' : 'shorts';
      const transcript = this.createTranscriptArray(transcriptItems, resolvedType);
      const title =
        ytData?.videoDetails?.title ||
        ytData?.playerOverlays?.playerOverlayRenderer?.videoDetails?.playerOverlayVideoDetailsRenderer?.title?.simpleText ||
        playerData?.videoDetails?.title ||
        '';

      return { title, transcript };
    }

    async fetchCaptionEventsFromTrack(playerData) {
      const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const track = this.selectCaptionTrack(tracks);
      if (!track?.baseUrl) throw new Error('Transcript not available for this video.');
      return this.fetchCaptionEvents(track.baseUrl);
    }

    selectCaptionTrack(tracks) {
      if (!Array.isArray(tracks) || !tracks.length) return null;
      return tracks.find(track => track.kind !== 'asr') || tracks[0];
    }

    ensureJson3(url) {
      if (!url) return null;
      return url.includes('fmt=json3') ? url : `${url}&fmt=json3`;
    }

    async fetchCaptionEvents(baseUrl) {
      const url = this.ensureJson3(baseUrl);
      if (!url) return [];

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Transcript request failed (${response.status})`);

      const json = await parseJsonResponse(response, 'caption-track');
      return json?.events || [];
    }

    async fetchTranscriptItems({ ytData, captionTracks }) {
      const preferredTrack = this.selectCaptionTrack(captionTracks);
      if (preferredTrack?.baseUrl) {
        const events = await this.fetchCaptionEvents(preferredTrack.baseUrl);
        if (events.length) {
          return events;
        }
      }

      const params = ytData?.engagementPanels?.find(panel =>
        panel.engagementPanelSectionListRenderer?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint
      )?.engagementPanelSectionListRenderer?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint?.params;

      if (!params) throw new Error('Transcript not available for this video');

      const context = await this.buildTranscriptRequestContext(ytData);
      return this.fetchTranscriptWithContinuations(params, context);
    }

    async buildTranscriptRequestContext(ytData) {
      const hl =
        ytData.topbar?.desktopTopbarRenderer?.searchbox?.fusionSearchboxRenderer?.config?.webSearchboxConfig?.requestLanguage ||
        'en';
      const clientParams = ytData.responseContext?.serviceTrackingParams?.[0]?.params || [];
      const visitorData = ytData.responseContext?.webResponseContextExtensionData?.ytConfigData?.visitorData;

      return {
        context: {
          client: {
            hl,
            visitorData,
            clientName: clientParams?.[0]?.value,
            clientVersion: clientParams?.[1]?.value
          },
          request: { useSsl: true }
        }
      };
    }

    async fetchTranscriptWithContinuations(params, context) {
      const initialResponse = await fetch(YOUTUBE_TRANSCRIPT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...context, params })
      });

      if (!initialResponse.ok) {
        const snippet = await initialResponse.text().catch(() => '');
        console.debug('[YAIVS] youtubei transcript error', initialResponse.status, snippet.slice(0, 300));
        throw new Error(`Transcript request failed (${initialResponse.status})`);
      }

      const initialJson = await parseJsonResponse(initialResponse, 'transcript-initial');
      if (!initialJson) return [];

      let segments =
        initialJson.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments || [];

      const queue =
        initialJson.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.continuations?.slice() || [];

      while (queue.length) {
        const continuation = queue.shift();
        const token =
          continuation?.continuationCommand?.token ||
          continuation?.nextContinuationData?.continuation ||
          continuation?.reloadContinuationData?.continuation ||
          null;

        if (!token) continue;

        const continuationResponse = await fetch(YOUTUBE_TRANSCRIPT_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ...context, continuation: token })
        });

        if (!continuationResponse.ok) {
          console.debug('[YAIVS] transcript continuation failed', continuationResponse.status);
          continue;
        }

        const continuationJson = await parseJsonResponse(continuationResponse, 'transcript-continuation');
        if (!continuationJson) continue;

        const items =
          continuationJson.actions?.[0]?.appendContinuationItemsAction?.continuationItems ||
          continuationJson.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.continuationItems ||
          continuationJson.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems || [];

        const newSegments = items.filter(item => item?.transcriptSegmentRenderer);
        if (newSegments.length) segments = segments.concat(newSegments);

        const more =
          continuationJson.actions?.[0]?.appendContinuationItemsAction?.continuations ||
          continuationJson.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.continuations ||
          continuationJson.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuations || [];

        if (more.length) queue.push(...more);
      }

      return segments;
    }

    createTranscriptArray(items, type) {
      if (!Array.isArray(items) || !items.length) return [];

      if (items[0]?.transcriptSegmentRenderer) type = 'regular';
      else if (items[0]?.segs || typeof items[0]?.tStartMs === 'number') type = 'captions';

      if (type === 'regular') {
        return items.map(item => this.extractSegment(item));
      }

      return items
        .filter(event => event.segs)
        .map(event => this.extractCaptionSegment(event));
    }

    extractSegment(item) {
      const seg = item?.transcriptSegmentRenderer;
      if (!seg) return ['', ''];
      const text = seg.snippet?.runs?.map(run => decodeHtml(run.text)).join(' ') || '';
      return [seg.startTimeText?.simpleText || '', text];
    }

    extractCaptionSegment(event) {
      const timestamp = this.msToTimestamp(event.tStartMs);
      const text = (event.segs || []).map(seg => decodeHtml(seg.utf8 || '')).join(' ').replace(/\n/g, ' ');
      return [timestamp, text];
    }

    msToTimestamp(ms) {
      const totalSeconds = Math.floor(ms / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  // (Chrome on-device summarizer removed)

  // ---------------------------------------------------------------------------
  // Provider utilities
  // ---------------------------------------------------------------------------
  async function ensureProviderKey(provider) {
    const keyName = provider === 'gpt' ? 'openaiKey' : provider === 'claude' ? 'claudeKey' : provider === 'openrouter' ? 'openrouterKey' : 'geminiKey';
    const stored = await chrome.storage.sync.get([keyName]);
    let value = stored[keyName];

    if (!value && provider === 'gemini') {
      const entered = window.prompt('Enter your Gemini API key (stored locally in Chrome Sync):');
      if (!entered) throw new Error('Gemini API key is required to summarize.');
      const trimmed = entered.trim();
      if (!trimmed) throw new Error('Gemini API key cannot be empty.');
      await chrome.storage.sync.set({ [keyName]: trimmed });
      value = trimmed;
    }

    if (!value) {
    const label = provider === 'gpt' ? 'OpenAI' : provider === 'claude' ? 'Anthropic' : provider === 'openrouter' ? 'OpenRouter' : 'Gemini';
    throw new Error(`${label} API key is required. Add it from the extension popup.`);
  }

    return value;
  }

  // ---------------------------------------------------------------------------
  // Summary panel
  // ---------------------------------------------------------------------------
  class SummaryPanel {
    constructor(settings, transcriptService) {
      this.settings = settings;
      this.transcriptService = transcriptService;
      this.panel = null;
      this.summaryEl = null;
      this.statusEl = null;
      this.generateBtn = null;
      this.isSummarizing = false;
      this.autoTriggeredVideoId = null;
      this.settings.subscribe(values => this.handleSettingsChange(values));
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

      await this.settings.ready;

      const mountPoint = await getPanelMountPoint();
      if (!mountPoint?.parent) {
        console.warn('[YAIVS] Unable to locate a mount point for the summary panel.');
        return;
      }

      let panel = document.getElementById(PANEL_ID);
      if (!panel) panel = this.createPanel();

      const { parent, anchor } = mountPoint;
      const alreadyMounted = panel.parentElement === parent;

      if (anchor) {
        if (!alreadyMounted || panel.nextElementSibling !== anchor) {
          parent.insertBefore(panel, anchor);
        }
      } else if (!alreadyMounted || parent.firstElementChild !== panel) {
        if (parent.firstChild) parent.insertBefore(panel, parent.firstChild);
        else parent.appendChild(panel);
      }

      this.bindElements(panel);
      this.resetState();
      // Ensure the panel is placed immediately above the description once it appears.
      this.ensureAboveDescription(mountPoint.container);
      this.maybeAutoSummarize();
    }

    createPanel() {
      const container = document.createElement('section');
      container.id = PANEL_ID;
      container.className = 'yaivs-panel';
      container.innerHTML = `
        <p class="yaivs-status yaivs-status--info" id="yaivs-status">Click to summarize the current video.</p>
        <div class="yaivs-actions" id="yaivs-actions">
          <button class="yaivs-unified-button" type="button" id="yaivs-unified" aria-label="AI Summarize">
            <span class="yaivs-unified-main" id="yaivs-generate">
              <span class="yaivs-text">SUMMARIZE</span>
            </span>
            <span class="yaivs-unified-dropdown" id="yaivs-menu" aria-label="Style options">
              <span class="yaivs-arrow">▾</span>
            </span>
          </button>
          <div class="yaivs-prompt" id="yaivs-prompt-row">
            <div class="yaivs-input-wrap">
              <input class="yaivs-input" id="yaivs-prompt-input" type="text" placeholder="Ask about this video… (or leave blank to summarize)" aria-label="Ask about this video" hidden />
              <button class="yaivs-send" id="yaivs-send" aria-label="Send" hidden>↑</button>
            </div>
          </div>
          <div class="yaivs-style-menu" id="yaivs-style-menu" hidden>
            <button type="button" data-style="simple">Bullets</button>
            <button type="button" data-style="detailed">Detailed</button>
            <button type="button" data-style="chapters">Chapters</button>
            <button type="button" data-style="proscons">Pros / Cons</button>
            <button type="button" data-style="recipe">Recipe</button>
            <button type="button" data-style="outline">Outline</button>
          </div>
        </div>
        <div class="yaivs-tools" id="yaivs-tools" hidden>
          <button type="button" id="yaivs-copy" class="yaivs-tool">Copy</button>
        </div>
        <div class="yaivs-summary" id="yaivs-summary" hidden></div>
      `;
      return container;
    }

    bindElements(panel) {
      this.panel = panel;
      this.summaryEl = panel.querySelector('#yaivs-summary');
      this.statusEl = panel.querySelector('#yaivs-status');
      this.unifiedBtn = panel.querySelector('#yaivs-unified');
      this.generateBtn = panel.querySelector('#yaivs-generate');
      this.promptInput = panel.querySelector('#yaivs-prompt-input');
      this.sendBtn = panel.querySelector('#yaivs-send');
      this.askBtn = null;
      this.styleBtn = panel.querySelector('#yaivs-menu');
      this.styleMenu = panel.querySelector('#yaivs-style-menu');
      this.clearBtn = null;
      this.toolsRow = panel.querySelector('#yaivs-tools');
      this.copyBtn = panel.querySelector('#yaivs-copy');
      this.toggleBtn = null;

      if (this.generateHandler) {
        this.generateBtn.removeEventListener('click', this.generateHandler);
      }
      this.generateHandler = (event) => {
        event.stopPropagation();
        this.handleSummarize();
      };
      this.generateBtn.addEventListener('click', this.generateHandler);

      // Ask button removed; Enter in input submits.
      if (this.promptInput) {
        this.promptInput.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handlePromptSubmit();
          }
        });
        this.promptInput.addEventListener('input', () => this.updateSendVisibility());
      }

      if (!panel.dataset.listenersBound) {
        panel.addEventListener('click', event => this.handleTimestampClick(event));
        panel.dataset.listenersBound = 'true';
      }

      if (this.styleBtn && this.styleMenu && !this.styleBtn.dataset.bound) {
        this.styleBtn.dataset.bound = 'true';
        this.styleBtn.addEventListener('click', e => {
          e.stopPropagation();
          this.toggleStyleMenu();
        });
        document.addEventListener('click', () => this.hideStyleMenu());
        this.styleMenu.addEventListener('click', e => this.handleStyleMenuClick(e));
      }

      // send within input
      if (this.sendBtn) {
        this.sendBtn.addEventListener('click', () => this.handlePromptSubmit());
      }

      if (this.copyBtn) {
        this.copyBtn.addEventListener('click', () => this.copySummary());
      }
      // no expand/collapse button

      this.updateInfoMessage();
      // no provider chip
    }

    ensureAboveDescription(container) {
      try {
        const moveAbove = () => {
          if (!this.panel) return;
          const description = findDescriptionElement(container) || findDescriptionElement(document);
          if (!description || !description.parentElement) return;
          const parent = description.parentElement;
          const alreadyCorrect = this.panel.parentElement === parent && this.panel.nextElementSibling === description;
          if (!alreadyCorrect) {
            parent.insertBefore(this.panel, description);
          }
        };

        // Try immediately
        moveAbove();

        // Observe for late-loaded description
        const target = container || document;
        const observer = new MutationObserver(() => {
          const desc = findDescriptionElement(container) || findDescriptionElement(document);
          if (desc) {
            moveAbove();
            observer.disconnect();
          }
        });
        observer.observe(target, { childList: true, subtree: true });
      } catch (err) {
        console.debug('[YAIVS] ensureAboveDescription failed:', err?.message || String(err));
      }
    }

    resetState() {
      if (!this.panel) return;
      if (this.summaryEl) {
        this.summaryEl.innerHTML = '';
        this.summaryEl.hidden = true;
      }
      if (this.promptInput) {
        this.promptInput.value = '';
        this.promptInput.setAttribute('hidden', '');
      }
      this.updateInfoMessage();
      if (this.unifiedBtn) {
        this.unifiedBtn.disabled = false;
        const textSpan = this.unifiedBtn.querySelector('.yaivs-text');
        if (textSpan) textSpan.textContent = 'SUMMARIZE';
      }
      // no separate ask button
      if (this.promptInput) this.promptInput.disabled = false;
      if (this.sendBtn) this.sendBtn.hidden = true;
      if (this.toolsRow) this.toolsRow.hidden = true;
      this.lastRawSummary = '';
    }

    async handleSummarize(overrides) {
      if (!this.unifiedBtn || this.unifiedBtn.disabled) return;

      // Combined behavior: if there's a question typed, treat as Ask.
      const q = (this.promptInput?.value || '').trim();
      // Reveal the Ask input the first time user clicks Summarize
      if (this.promptInput && this.promptInput.hasAttribute('hidden')) {
        this.promptInput.removeAttribute('hidden');
        this.updateSendVisibility();
        this.promptInput.focus();
      }
      if (q) {
        this.handlePromptSubmit();
        return;
      }

      const videoId = this.transcriptService.getVideoId();
      if (videoId) this.autoTriggeredVideoId = videoId;

      this.setLoading(true, 'Fetching transcript…');
      this.isSummarizing = true;

      try {
        await this.settings.ready;
        const provider = this.settings.get('provider') || 'gemini';
        const selectedMode = (overrides && overrides.summaryMode) || (this.settings.get('summaryMode') || 'simple');
        const modeLabel = this.getModeLabel(selectedMode);
        const { text: transcript, durationSeconds } = await this.transcriptService.collect();
        let activeProvider = provider;
        let summary;

        this.setLoading(true, `Summarizing (${modeLabel}) with ${this.getProviderLabel(provider)}…`);

        summary = await this.summarizeUsingProvider(provider, transcript, durationSeconds, overrides);

        this.renderSummary(summary);
        this.updateStatus(`Summary ready (${this.getProviderLabel(activeProvider)} — ${modeLabel}).`, 'success');
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
      this.lastRawSummary = text;
      const linkify = this.settings.get('includeTimestamps') !== false;
      this.summaryEl.innerHTML = formatSummaryHtml(text, linkify);
      this.summaryEl.hidden = false;
      if (this.toolsRow) this.toolsRow.hidden = false;
    }

    updateStatus(message, variant) {
      if (!this.statusEl) return;
      this.statusEl.textContent = message;
      this.statusEl.className = `yaivs-status yaivs-status--${variant}`;
    }

    setLoading(isLoading, message) {
      if (!this.unifiedBtn) return;
      this.unifiedBtn.disabled = isLoading;
      const textSpan = this.unifiedBtn.querySelector('.yaivs-text');
      if (textSpan) textSpan.textContent = isLoading ? 'WORKING…' : 'SUMMARIZE';
      if (this.promptInput) this.promptInput.disabled = isLoading;
      if (this.sendBtn) this.sendBtn.disabled = isLoading;
      if (message) {
        this.updateStatus(message, 'loading');
      }
    }

    async maybeAutoSummarize() {
      await this.settings.ready;
      if (!this.settings.get('autoSummarize')) return;

      const videoId = this.transcriptService.getVideoId();
      if (!videoId || this.autoTriggeredVideoId === videoId) return;
      if (this.unifiedBtn?.disabled || this.isSummarizing) return;
      if (!this.summaryEl?.hidden) return;

      this.handleSummarize();
    }

    async summarizeUsingProvider(provider, transcript, durationSeconds, overrides) {
      await ensureProviderKey(provider);
      const response = await chrome.runtime.sendMessage({
        type: 'summarizeVideo',
        provider,
        transcript,
        durationSeconds,
        summaryMode: (overrides && overrides.summaryMode) || (this.settings.get('summaryMode') || 'simple'),
        customPrompt: (overrides && overrides.customPrompt) || (this.settings.get('customPrompt') || '').trim(),
        includeTimestamps: this.settings.get('includeTimestamps') !== false
      });

      if (!response) throw new Error('No response from background service.');
      if (response.status === 'error') throw new Error(response.message);
      return response.summary;
    }

    handleTimestampClick(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains('yaivs-timestamp')) return;
      event.preventDefault();
      const seconds = Number(target.dataset.seconds || 'NaN');
      if (!Number.isFinite(seconds)) return;
      const video = document.querySelector('video');
      if (!video) return;
      video.currentTime = seconds;
      video.focus?.();
    }

    updateInfoMessage() {
      if (!this.statusEl || this.isSummarizing || !this.summaryEl?.hidden) {
        return;
      }

      const providerLabel = this.getProviderLabel(this.settings.get('provider') || 'gemini');
      const modeLabel = this.getModeLabel(this.settings.get('summaryMode') || 'simple');
      if (this.settings.get('autoSummarize')) {
        this.statusEl.textContent = `Preparing summary (${modeLabel}) with ${providerLabel}…`;
        this.statusEl.className = 'yaivs-status yaivs-status--loading';
      } else {
        this.statusEl.textContent = `Click to summarize with ${providerLabel} — ${modeLabel}.`;
        this.statusEl.className = 'yaivs-status yaivs-status--info';
      }
    }

    handleSettingsChange(_values) {
      this.updateInfoMessage();
    }

    getProviderLabel(provider) {
      switch (provider) {
        case 'gpt':
          return 'GPT';
        case 'claude':
          return 'Claude';
        case 'openrouter':
          return 'OpenRouter';
        default:
          return 'Gemini';
      }
    }

    toggleStyleMenu() {
      if (!this.styleMenu) return;
      const isHidden = this.styleMenu.hasAttribute('hidden');
      if (isHidden) {
        this.styleMenu.removeAttribute('hidden');
        // Position under the arrow portion of the split button
        this.positionStyleMenu();
      } else {
        this.styleMenu.setAttribute('hidden', '');
      }
    }

    hideStyleMenu() {
      if (this.styleMenu) this.styleMenu.setAttribute('hidden', '');
    }

    positionStyleMenu() {
      if (!this.styleMenu || !this.styleBtn || !this.panel) return;
      const actions = this.panel.querySelector('#yaivs-actions');
      if (!actions) return;
      const actionsRect = actions.getBoundingClientRect();
      const arrowRect = this.styleBtn.getBoundingClientRect();

      // Ensure we can measure menu width
      const prevLeft = this.styleMenu.style.left;
      this.styleMenu.style.left = '0px';
      const menuRect = this.styleMenu.getBoundingClientRect();

      const desiredLeft = Math.round(arrowRect.right - actionsRect.left - menuRect.width);
      const minLeft = 0;
      const maxLeft = Math.max(0, Math.round(actionsRect.width - menuRect.width));
      const clampedLeft = Math.min(maxLeft, Math.max(minLeft, desiredLeft));
      this.styleMenu.style.left = `${clampedLeft}px`;
    }

    handleStyleMenuClick(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.tagName !== 'BUTTON') return;
      const style = target.dataset.style;
      const preset = this.getPreset(style);
      if (!preset) return;
      this.hideStyleMenu();
      this.handleSummarize(preset);
    }

    copySummary() {
      const text = this.lastRawSummary || this.summaryEl?.textContent || '';
      if (!text) return;
      navigator.clipboard?.writeText(text).then(() => {
        this.updateStatus('Copied to clipboard.', 'success');
      }).catch(() => {
        this.updateStatus('Copy failed.', 'error');
      });
    }

    // expand/collapse removed

    getPreset(style) {
      switch (style) {
        case 'simple':
          return { summaryMode: 'simple', customPrompt: '' };
        case 'detailed':
          return { summaryMode: 'detailed', customPrompt: '' };
        case 'chapters':
          return {
            summaryMode: 'custom',
            customPrompt:
              'Summarize by chapters. For each chapter: use the chapter title as a heading with an emoji, then 2–4 bullets with timestamps for key points. If chapters are missing, approximate with sensible time ranges. Keep it concise.'
          };
        case 'proscons':
          return {
            summaryMode: 'custom',
            customPrompt:
              'Organize as two sections: "👍 Pros" and "👎 Cons". Under each, provide 3–6 concise bullets with timestamps where relevant. End with an "👉 Takeaway".'
          };
        case 'recipe':
          return {
            summaryMode: 'custom',
            customPrompt:
              'Format as a recipe: Title, Ingredients (bulleted list), then Steps (numbered with concise instructions). Include timestamps for each step if applicable. Keep it factual and concise.'
          };
        case 'outline':
          return {
            summaryMode: 'custom',
            customPrompt:
              'Produce a structured outline: I., II., III. with nested bullets (A., 1.) where helpful. Include timestamps for key segments. Keep items under ~18 words.'
          };
          default:
            return null;
      }
    }

    updateSendVisibility() {
      if (!this.promptInput || !this.sendBtn) return;
      const hasText = (this.promptInput.value || '').trim().length > 0;
      if (this.promptInput.hasAttribute('hidden')) {
        this.sendBtn.hidden = true;
      } else {
        this.sendBtn.hidden = !hasText;
      }
    }

    async handlePromptSubmit() {
      if (this.unifiedBtn?.disabled) return;
      const value = (this.promptInput?.value || '').trim();
      if (!value) return;

      this.setLoading(true, 'Fetching transcript…');
      try {
        await this.settings.ready;
        const provider = this.settings.get('provider') || 'gemini';
        const { text: transcript, durationSeconds } = await this.transcriptService.collect();
        this.setLoading(true, `Answering with ${this.getProviderLabel(provider)}…`);
        const answer = await this.askUsingProvider(provider, transcript, durationSeconds, value);
        this.renderSummary(answer);
        this.updateStatus(`Answer ready (${this.getProviderLabel(provider)}).`, 'success');
      } catch (error) {
        console.error('Prompt failed', error);
        this.renderSummary('');
        this.updateStatus(error.message || 'Failed to answer prompt.', 'error');
        chrome.runtime.sendMessage({ type: 'logError', message: error.message || String(error) }).catch(() => {});
      } finally {
        this.setLoading(false);
      }
    }

    async askUsingProvider(provider, transcript, durationSeconds, question) {
      await ensureProviderKey(provider);
      const response = await chrome.runtime.sendMessage({
        type: 'askVideo',
        provider,
        transcript,
        durationSeconds,
        question,
        includeTimestamps: this.settings.get('includeTimestamps') !== false
      });
      if (!response) throw new Error('No response from background service.');
      if (response.status === 'error') throw new Error(response.message);
      return response.summary;
    }

    getModeLabel(mode) {
      switch (mode) {
        case 'bullets':
          return 'Bullets';
        case 'detailed':
          return 'Detailed';
        case 'chapters':
          return 'Chapters';
        case 'proscons':
          return 'Pros & Cons';
        case 'recipe':
          return 'Recipe';
        case 'outline':
          return 'Outline';
        case 'custom':
          return 'Custom';
        default:
          return 'Simple';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Style injection
  // ---------------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

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
        gap: 8px;
        position: relative;
      }

      .yaivs-panel__header {
        display: none; /* header no longer used for layout */
      }

      .yaivs-panel__title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--yt-spec-text-primary, #0f0f0f);
        letter-spacing: 0.3px;
      }

      .yaivs-button {
        padding: 8px 16px;
        border-radius: 20px;
        border: 1px solid var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.1));
        background: var(--yt-spec-general-background-a, rgba(255, 255, 255, 0.08));
        color: var(--yt-spec-text-primary, #0f0f0f);
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.3px;
        text-transform: none;
        cursor: pointer;
        transition: background 0.2s ease, border 0.2s ease, color 0.2s ease;
        flex-shrink: 0;
      }

      /* Unified Button Design */
      .yaivs-unified-button {
        display: flex;
        align-items: center;
        padding: 0;
        border-radius: 20px;
        border: 1px solid rgba(255,255,255,0.14);
        background: #0f0f0f;
        color: #ffffff;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.2s ease;
        overflow: hidden;
        flex-shrink: 0; /* keep size; let input shrink */
      }

      .yaivs-unified-main {
        display: flex;
        align-items: center;
        padding: 8px 16px;
        flex: 1;
        transition: background 0.2s ease;
      }

      .yaivs-unified-dropdown {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px 8px;
        border-left: 1px solid rgba(255,255,255,0.2);
        transition: background 0.2s ease;
        min-width: 24px;
        position: relative;
      }

      .yaivs-text {
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.3px;
      }

      .yaivs-arrow {
        font-size: 12px;
        line-height: 1;
        opacity: 0.8;
      }

      .yaivs-unified-main:hover {
        background: rgba(255,255,255,0.1);
      }

      .yaivs-unified-dropdown:hover {
        background: rgba(255,255,255,0.1);
      }

      .yaivs-unified-button:disabled .yaivs-unified-main {
        background: rgba(0,0,0,0.1);
        color: rgba(255,255,255,0.5);
        cursor: not-allowed;
      }

      .yaivs-unified-button:disabled .yaivs-unified-dropdown {
        background: rgba(0,0,0,0.1);
        color: rgba(255,255,255,0.5);
        cursor: not-allowed;
      }

      .yaivs-unified-button:focus {
        outline: 2px solid rgba(62, 166, 255, 0.5);
        outline-offset: 2px;
      }

      .yaivs-unified-button:focus:not(:focus-visible) {
        outline: none;
      }

      .yaivs-actions {
        display: flex;
        align-items: center;
        position: relative;
        gap: 8px;
        width: 100%;
        overflow: visible; /* allow dropdown to escape the row */
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

      /* hint/provider chips removed */

      .yaivs-prompt {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 0;
        flex: 1;
        justify-content: flex-start;
        min-width: 0; /* allow shrinking inside flex row */
      }

      .yaivs-input-wrap { position: relative; flex: 1; min-width: 0; overflow: hidden; }

      .yaivs-input {
        width: 100%;
        min-width: 220px;
        max-width: 100%;
        padding: 10px 42px 10px 14px; /* right padding for send button */
        border-radius: 20px;
        border: 1px solid var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.1));
        background: var(--yt-spec-brand-background-primary, rgba(255, 255, 255, 0.06));
        color: var(--yt-spec-text-primary, #0f0f0f);
        font: inherit;
        box-sizing: border-box; /* ensure padding/border stay within width */
      }

      .yaivs-send {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: #ffffff;
        color: #111;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(0,0,0,0.2);
      }

      /* clear/hint removed */

      .yaivs-style-menu {
        position: absolute;
        left: 0; /* positioned via JS to align under arrow */
        right: auto;
        top: calc(100% + 8px);
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px;
        border: 1px solid var(--yt-spec-badge-chip-background, rgba(255,255,255,0.12));
        background: var(--yt-spec-general-background-b, rgba(32,32,32,0.98));
        color: #eaeaea;
        border-radius: 8px;
        z-index: 9999;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        min-width: 120px;
        width: max-content;
      }

      .yaivs-style-menu > button {
        border: none;
        background: transparent;
        text-align: left;
        font: inherit;
        font-size: 13px;
        padding: 6px 8px;
        border-radius: 6px;
        cursor: pointer;
        color: #eaeaea;
      }

      .yaivs-style-menu > button:hover { background: rgba(255,255,255,0.08); }

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

      .yaivs-summary.collapsed {
        max-height: 360px;
        overflow: hidden;
      }

      .yaivs-tools {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .yaivs-tool {
        border: none;
        background: transparent;
        color: var(--yt-spec-text-secondary, #606060);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }

      /* .yaivs-divider removed */

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

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  const settingsManager = new SettingsManager(DEFAULT_SETTINGS);
  const transcriptService = new TranscriptService();
  new SummaryPanel(settingsManager, transcriptService);
})();
