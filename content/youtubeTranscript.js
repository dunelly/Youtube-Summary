import { decodeHtmlEntities, normalizeWhitespace } from './utils.js';

const YOUTUBE_TRANSCRIPT_ENDPOINT = 'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false';

export async function fetchTranscriptLines(videoUrl) {
  const transcriptData = await getTranscriptDict(videoUrl);
  if (!transcriptData?.transcript || transcriptData.transcript.length === 0) {
    return [];
  }
  const lines = transcriptData.transcript.map(([, text]) => normalizeWhitespace(text)).filter(Boolean);
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
