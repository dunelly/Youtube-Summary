(() => {
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
    provider: 'chrome',
    chromeOutputLanguage: 'en',
    summaryMode: 'simple',
    customPrompt: ''
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

  function formatSummaryHtml(summary) {
    if (!summary) return '';
    const escaped = escapeHtml(summary);

    // Linkify [mm:ss], [hh:mm:ss], and ranges like [mm:ss–mm:ss] or [hh:mm:ss - hh:mm:ss]
    const withLinks = escaped.replace(/\[((\d{1,3}):(\d{2})(?::(\d{2}))?)(?:\s*[–-]\s*((\d{1,3}):(\d{2})(?::(\d{2}))?))?\]/g, (
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
          'chromeOutputLanguage',
          'summaryMode',
          'customPrompt'
        ]);
        if (Object.prototype.hasOwnProperty.call(stored, 'autoSummarize')) {
          this.values.autoSummarize = Boolean(stored.autoSummarize);
        }
        this.values.provider = stored.provider || this.defaults.provider || 'gemini';
        this.values.chromeOutputLanguage = stored.chromeOutputLanguage || this.defaults.chromeOutputLanguage || 'en';
        this.values.summaryMode = stored.summaryMode || this.defaults.summaryMode || 'simple';
        this.values.customPrompt = stored.customPrompt || this.defaults.customPrompt || '';
      } catch (error) {
        console.warn('[YAIVS] Failed to load settings', error);
        this.values.provider = this.defaults.provider || 'gemini';
        this.values.chromeOutputLanguage = this.defaults.chromeOutputLanguage || 'en';
        this.values.summaryMode = this.defaults.summaryMode || 'simple';
        this.values.customPrompt = this.defaults.customPrompt || '';
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

      if (Object.prototype.hasOwnProperty.call(changes, 'chromeOutputLanguage')) {
        this.values.chromeOutputLanguage = changes.chromeOutputLanguage.newValue || 'en';
        patched = true;
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'summaryMode')) {
        this.values.summaryMode = changes.summaryMode.newValue || 'simple';
        patched = true;
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'customPrompt')) {
        this.values.customPrompt = changes.customPrompt.newValue || '';
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

  // ---------------------------------------------------------------------------
  // Chrome Summarizer client
  // ---------------------------------------------------------------------------
  class ChromeSummarizer {
    constructor() {
      this.instancePromise = null;
      this.currentLanguage = null;
    }

    async summarize(transcript, durationSeconds, outputLanguage, summaryMode, customPrompt, onProgress) {
      const language = outputLanguage || 'en';
      const summarizer = await this.ensureInstance(durationSeconds, language, onProgress);
      const mode = ['simple', 'detailed', 'custom'].includes(summaryMode) ? summaryMode : 'simple';
      const promptText = typeof customPrompt === 'string' ? customPrompt.trim() : '';
      const effectiveMode = mode === 'custom' && !promptText ? 'simple' : mode;
      return this.summarizeWithInstance(summarizer, transcript, durationSeconds, language, effectiveMode, promptText);
    }

    async ensureInstance(durationSeconds, outputLanguage, onProgress) {
      if (typeof Summarizer === 'undefined') {
        throw new Error('Chrome AI summarizer is not supported on this device.');
      }

      const availability = await Summarizer.availability();
      if (availability === 'unavailable') {
        throw new Error('Chrome AI summarizer is unavailable.');
      }

      if (this.currentLanguage && this.currentLanguage !== outputLanguage) {
        await this.disposeCurrentInstance();
      }

      if (!this.instancePromise) {
        const length = durationSeconds > 2700 ? 'long' : 'medium';
        const options = {
          type: 'key-points',
          format: 'markdown',
          length,
          outputLanguage,
          output_language: outputLanguage,
          language: outputLanguage,
          output: { language: outputLanguage },
          monitor: monitor => {
            if (typeof monitor?.addEventListener === 'function') {
              monitor.addEventListener('downloadprogress', event => {
                if (typeof onProgress === 'function') {
                  const value = typeof event.loaded === 'number' ? event.loaded : 0;
                  onProgress(Math.min(1, Math.max(0, value)));
                }
              });
            }
          }
        };

        console.debug('[YAIVS] Creating Chrome summarizer with options:', options);

        if (typeof onProgress === 'function' && (availability === 'downloadable' || availability === 'downloading')) {
          onProgress(0);
        }

        this.instancePromise = Summarizer.create(options)
          .then(instance => {
            this.currentLanguage = outputLanguage;
            return instance;
          })
          .catch(error => {
            this.instancePromise = null;
            if (this.currentLanguage === outputLanguage) {
              this.currentLanguage = null;
            }
            throw error;
          });
      }

      const instance = await this.instancePromise;
      if (typeof onProgress === 'function') {
        onProgress(1);
      }
      return instance;
    }

    async disposeCurrentInstance() {
      if (!this.instancePromise) {
        this.currentLanguage = null;
        return;
      }

      try {
        const instance = await this.instancePromise.catch(() => null);
        if (instance?.destroy) {
          try {
            instance.destroy();
          } catch (destroyError) {
            console.warn('[YAIVS] Failed to destroy Chrome summarizer instance', destroyError);
          }
        }
      } finally {
        this.instancePromise = null;
        this.currentLanguage = null;
      }
    }

    reset() {
      this.disposeCurrentInstance();
    }

    async summarizeWithInstance(instance, transcript, durationSeconds, outputLanguage, summaryMode, customPrompt) {
      const minutes = Math.max(1, Math.round(durationSeconds / 60));
      const baseContext = this.buildBaseContext(minutes, durationSeconds, summaryMode, customPrompt);
      const chunkSize = 9000;

      if (transcript.length <= chunkSize) {
        const requestOptions = this.buildSummarizeOptions(baseContext, outputLanguage);
        console.debug('[YAIVS] Summarize request (single chunk):', requestOptions);
        return instance.summarize(transcript, requestOptions);
      }

      const chunks = this.chunkTranscript(transcript, chunkSize);
      const partialSummaries = [];

      for (let index = 0; index < chunks.length; index += 1) {
        const segmentContext = `${baseContext}\nThis is segment ${index + 1} of ${chunks.length}; include only new or noteworthy facts from this portion while keeping the same formatting/style.`;
        const requestOptions = this.buildSummarizeOptions(segmentContext, outputLanguage);
        console.debug('[YAIVS] Summarize request (chunk segment):', index + 1, 'of', chunks.length, requestOptions);
        const partial = await instance.summarize(chunks[index], requestOptions);
        partialSummaries.push(partial.trim());
      }

      const combined = partialSummaries.join('\n\n');
      const mergeContext = this.buildMergeContext(summaryMode);
      const mergeOptions = this.buildSummarizeOptions(mergeContext, outputLanguage);
      console.debug('[YAIVS] Summarize request (merge):', mergeOptions);
      return instance.summarize(combined, mergeOptions);
    }

    chunkTranscript(text, size) {
      const chunks = [];
      let start = 0;
      while (start < text.length) {
        let end = Math.min(text.length, start + size);
        if (end < text.length) {
          const boundary = text.lastIndexOf('\n', end);
          if (boundary > start + size * 0.4) {
            end = boundary;
          }
        }
        chunks.push(text.slice(start, end));
        start = end;
      }
      return chunks;
    }

    buildSummarizeOptions(context, outputLanguage) {
      return {
        context,
        outputLanguage,
        output_language: outputLanguage,
        language: outputLanguage,
        output: { language: outputLanguage }
      };
    }

    buildBaseContext(minutes, durationSeconds, mode, customPrompt) {
      const timeHints = this.buildTimeHints(durationSeconds);
      const sharedGeneral = [
        `Summarize this YouTube transcript for a time-pressed viewer (≈${minutes} minutes long).`,
        'Be factual, neutral, and do not mention the presenter or say "the reviewer".'
      ];

      if (mode === 'detailed') {
        return [
          ...sharedGeneral,
          'Write 4–6 concise paragraphs grouped by theme. Prefer readable prose over bullets.',
          'Do not include timestamps.',
          'Do not include thumbnails or images.',
          'Call out design/build, display/audio, cameras, performance & thermals, battery/charging, and conclude with a clear takeaway.',
          'Note uncertainties or missing transcript portions inline where relevant.'
        ].filter(Boolean).join(' ');
      }

      if (mode === 'custom' && customPrompt) {
        return [
          `User instructions (apply first): ${customPrompt}`,
          ...sharedGeneral,
          'Include timestamps in [mm:ss] or [hh:mm:ss] where possible (unless user specifies otherwise).',
          'If user instructions conflict with formatting guidance, follow the user. Emoji headings/bullets are optional unless requested.',
          'Keep writing tight and remove fluff. If structure is unspecified, 5–7 short sections are acceptable.',
          timeHints
        ].filter(Boolean).join(' ');
      }

      // simple (default)
      return [
        ...sharedGeneral,
        'Include timestamps in [mm:ss] or [hh:mm:ss] where possible.',
        'Use 5–7 thematic sections relevant to the transcript. Each heading must begin with an expressive emoji, a space, and a short label.',
        'Do not invent or include irrelevant categories. Never add empty or "N/A" sections.',
        'Under each heading add 2–4 bullets. Each bullet must start with a single tab character then "• " (example: "\t• Battery lasts longer.").',
        'Keep bullets under ~18 words, concise and factual.',
        'Finish with an "👉 Takeaway" section that states the main conclusion.',
        'Call out uncertainties or missing transcript details inside the affected section/bullet.',
        timeHints
      ].filter(Boolean).join(' ');
    }

    buildTimeHints(totalSeconds) {
      const total = Number(totalSeconds) || 0;
      if (total <= 0) return '';
      const firstEnd = Math.max(Math.floor(total / 3), Math.min(total, 300));
      let secondEnd = Math.floor((2 * total) / 3);
      if (secondEnd <= firstEnd) {
        secondEnd = Math.min(total - 60, firstEnd + 300);
      }
      if (secondEnd < firstEnd) {
        secondEnd = firstEnd;
      }
      const openingRange = `[00:00–${this.formatTimestamp(firstEnd)}]`;
      const midpointRange = `[${this.formatTimestamp(firstEnd)}–${this.formatTimestamp(secondEnd)}]`;
      const finalRange = `[${this.formatTimestamp(secondEnd)}–${this.formatTimestamp(total)}]`;
      return [
        `Cover the opening ${openingRange} (setup/intro), the midpoint ${midpointRange} (developments/turning points), and the final stretch ${finalRange} (conclusions/calls to action).`
      ].join(' ');
    }

    formatTimestamp(totalSeconds) {
      if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00';
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = Math.floor(totalSeconds % 60);
      const mm = minutes.toString().padStart(2, '0');
      const ss = seconds.toString().padStart(2, '0');
      return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    buildMergeContext(mode) {
      if (mode === 'detailed') {
        return 'Merge these partial summaries into one cohesive multi-paragraph recap. Prefer short paragraphs, avoid bullets, remove duplicates, keep the writing tight. Do not include timestamps or thumbnails/images.';
      }
      if (mode === 'custom') {
        return 'Merge these partial summaries while honoring the user instructions. Keep consistent style, remove duplicates, and maintain concise, clear writing.';
      }
      // simple
      return 'Merge these partial summaries into one cohesive recap. Preserve the emoji section headings and tab-indented "• " bullets, remove duplicates, and keep the writing tight.';
    }
  }

  // ---------------------------------------------------------------------------
  // Provider utilities
  // ---------------------------------------------------------------------------
  async function ensureProviderKey(provider) {
    const keyName = provider === 'gpt' ? 'openaiKey' : provider === 'claude' ? 'claudeKey' : 'geminiKey';
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
      const label = provider === 'gpt' ? 'OpenAI' : provider === 'claude' ? 'Anthropic' : 'Gemini';
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
      this.chromeSummarizer = new ChromeSummarizer();
      this.lastKnownChromeLanguage = null;
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

      if (this.lastKnownChromeLanguage === null) {
        this.lastKnownChromeLanguage = this.settings.get('chromeOutputLanguage') || 'en';
      }

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

      if (!panel.dataset.listenersBound) {
        panel.addEventListener('click', event => this.handleTimestampClick(event));
        panel.dataset.listenersBound = 'true';
      }

      this.updateInfoMessage();
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
      this.updateInfoMessage();
      if (this.generateBtn) {
        this.generateBtn.disabled = false;
        this.generateBtn.textContent = 'Summarize';
      }
    }

    async handleSummarize() {
      if (!this.generateBtn || this.generateBtn.disabled) return;

      const videoId = this.transcriptService.getVideoId();
      if (videoId) this.autoTriggeredVideoId = videoId;

      this.setLoading(true, 'Fetching transcript…');
      this.isSummarizing = true;

      try {
        await this.settings.ready;
        const provider = this.settings.get('provider') || 'gemini';
        const modeLabel = this.getModeLabel(this.settings.get('summaryMode') || 'simple');
        const { text: transcript, durationSeconds } = await this.transcriptService.collect();
        let activeProvider = provider;
        let summary;

        this.setLoading(true, `Summarizing (${modeLabel}) with ${this.getProviderLabel(provider)}…`);

        try {
          summary = await this.summarizeUsingProvider(provider, transcript, durationSeconds);
        } catch (error) {
          if (provider === 'chrome') {
            console.warn('[YAIVS] Chrome summarizer failed, falling back to Gemini.', error);
            activeProvider = 'gemini';
            this.updateStatus('Chrome AI unavailable, falling back to Gemini…', 'loading');
            this.setLoading(true, `Summarizing (${modeLabel}) with ${this.getProviderLabel(activeProvider)}…`);
            summary = await this.summarizeUsingProvider(activeProvider, transcript, durationSeconds);
          } else {
            throw error;
          }
        }

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
      await this.settings.ready;
      if (!this.settings.get('autoSummarize')) return;

      const videoId = this.transcriptService.getVideoId();
      if (!videoId || this.autoTriggeredVideoId === videoId) return;
      if (this.generateBtn?.disabled || this.isSummarizing) return;
      if (!this.summaryEl?.hidden) return;

      this.handleSummarize();
    }

    async summarizeUsingProvider(provider, transcript, durationSeconds) {
      if (provider === 'chrome') {
        const language = this.settings.get('chromeOutputLanguage') || 'en';
        const mode = this.settings.get('summaryMode') || 'simple';
        const customPrompt = (this.settings.get('customPrompt') || '').trim();
        return this.chromeSummarizer.summarize(transcript, durationSeconds, language, mode, customPrompt, progress => {
          if (progress < 1) {
            this.updateStatus(`Downloading Chrome AI model… ${Math.round(progress * 100)}%`, 'loading');
          } else {
            this.updateStatus('Summarizing with Chrome AI…', 'loading');
          }
        });
      }

      await ensureProviderKey(provider);
      const response = await chrome.runtime.sendMessage({
        type: 'summarizeVideo',
        provider,
        transcript,
        durationSeconds,
        summaryMode: this.settings.get('summaryMode') || 'simple',
        customPrompt: (this.settings.get('customPrompt') || '').trim()
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

    handleSettingsChange(values) {
      this.updateInfoMessage();
      if (!values) return;

      const language = values.chromeOutputLanguage || 'en';
      if (language !== this.lastKnownChromeLanguage) {
        this.lastKnownChromeLanguage = language;
        this.chromeSummarizer.reset();
      }
    }

    getProviderLabel(provider) {
      switch (provider) {
        case 'chrome':
          return 'Chrome AI';
        case 'gpt':
          return 'GPT';
        case 'claude':
          return 'Claude';
        default:
          return 'Gemini';
      }
    }

    getModeLabel(mode) {
      switch (mode) {
        case 'detailed':
          return 'Detailed';
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

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  const settingsManager = new SettingsManager(DEFAULT_SETTINGS);
  const transcriptService = new TranscriptService();
  new SummaryPanel(settingsManager, transcriptService);
})();
