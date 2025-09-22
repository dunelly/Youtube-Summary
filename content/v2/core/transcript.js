// Transcript service (copied from v1 with helpers imported from v2/utils)
import {
  decodeHtml,
  cleanWhitespace,
  parseTimestamp,
  secondsToLabel,
  parseJsonResponse,
  fetchHtml,
  extractJsonFromHtml,
  getVideoIdFromUrl,
  containsAuthMessage
} from '../utils.js';

const YOUTUBE_TRANSCRIPT_ENDPOINT = 'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false';

export class TranscriptService {
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
