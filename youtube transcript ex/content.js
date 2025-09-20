(() => {
  if (window.hasTranscriptScript) {
    return;
  }
  window.hasTranscriptScript = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "copyTranscript") {
      handleCopyTranscript().then(sendResponse);
      return true;
    }
  });

  async function handleCopyTranscript() {
    const videoUrl = window.location.href;
    const isShorts = /youtube\.com\/shorts\//.test(videoUrl);
    const videoId = isShorts
      ? videoUrl.split("/shorts/")[1].split(/[/?#&]/)[0]
      : new URLSearchParams(window.location.search).get("v");

    if (!videoId) return { status: "error", message: chrome.i18n.getMessage("noVideoId") };

    try {
      const transcriptObj = await getTranscriptDict(videoUrl);
      const lines = transcriptObj.transcript.map(
        ([timestamp, text]) => `(${timestamp}) ${text}`
      ).join("\n");

      const transcriptWithTitle = `Title: ${transcriptObj.title}\n\n${lines}`;

      await copyToClipboard(transcriptWithTitle);
      return { 
        status: "success", 
        message: chrome.i18n.getMessage("transcriptCopied"),
        transcript: transcriptWithTitle,
        title: transcriptObj.title
      };
    } catch (err) {
      console.error("❌", chrome.i18n.getMessage("transcriptError"), ":", err);
      return { status: "error", message: err.message };
    }
  }

  async function getTranscriptDict(videoUrl) {
    const isShorts = /youtube\.com\/shorts\//.test(videoUrl);
    const videoId = isShorts
      ? videoUrl.split("/shorts/")[1].split(/[/?#&]/)[0]
      : new URLSearchParams(window.location.search).get("v");

    if (isShorts) {
      // Transform the Shorts URL to regular video URL
      const transformedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log("Transforming Shorts URL to regular video URL:", transformedUrl);

      try {
        // Request background script to fetch the transformed URL
        const response = await chrome.runtime.sendMessage({
          action: "fetchTransformedUrl",
          url: transformedUrl
        });

        if (!response.success) {
          throw new Error("Failed to fetch transformed URL: " + response.error);
        }

        // Extract data from the fetched HTML
        const { title, ytData, dataKey, resolvedType } =
          await resolveYouTubeDataFromHtml(response.html);
        const segments = await getTranscriptItems(ytData, dataKey);

        if (!segments.length) return { title, transcript: [] };

        const transcript = createTranscriptArray(segments, resolvedType);
        return { title, transcript };
      } catch (error) {
        console.error("Error with transformed URL approach:", error);
        throw new Error("Transcript not available for this Short");
      }
    } else {
      // Regular video - use existing logic
      const { title, ytData, dataKey, resolvedType } =
        await resolveYouTubeData(videoUrl);
      const segments = await getTranscriptItems(ytData, dataKey);

      if (!segments.length) return { title, transcript: [] };

      const transcript = createTranscriptArray(segments, resolvedType);
      return { title, transcript };
    }
  }

  async function resolveYouTubeDataFromHtml(html) {
    // Extract data from provided HTML string
    try {
      // First try to get ytInitialData (has transcript panel info)
      const ytData = extractJsonFromHtml(html, "ytInitialData");
      if (ytData) {
        let title = ytData?.videoDetails?.title ||
                  ytData?.playerOverlays?.playerOverlayRenderer?.videoDetails
                    ?.playerOverlayVideoDetailsRenderer?.title?.simpleText ||
                  chrome.i18n.getMessage("untitled");

        // Check for transcript panel
        const panels = ytData?.engagementPanels || [];
        const hasTranscriptPanel = panels.some(p =>
          p.engagementPanelSectionListRenderer?.content
            ?.continuationItemRenderer?.continuationEndpoint
            ?.getTranscriptEndpoint
        );

        if (hasTranscriptPanel) {
          return {
            title,
            ytData,
            dataKey: "ytInitialData",
            resolvedType: "regular"
          };
        }
      }
    } catch (e) {
      console.warn("Failed to extract ytInitialData from HTML:", e);
    }

    // Fallback to ytInitialPlayerResponse (for caption URLs)
    try {
      const playerData = extractJsonFromHtml(html, "ytInitialPlayerResponse");
      if (playerData) {
        const title = playerData?.videoDetails?.title ||
                     playerData?.microformat?.playerMicroformatRenderer
                       ?.title?.simpleText ||
                     chrome.i18n.getMessage("untitled");
        return {
          title,
          ytData: playerData,
          dataKey: "ytInitialPlayerResponse",
          resolvedType: "shorts"
        };
      }
    } catch (e) {
      console.warn("Failed to extract ytInitialPlayerResponse from HTML:", e);
    }

    throw new Error("Could not extract transcript data from page");
  }

  async function resolveYouTubeData(videoUrl, initialType) {
    const dataKey = "ytInitialData";
    const html = await fetch(videoUrl).then(res => res.text());
    let ytData = extractJsonFromHtml(html, dataKey);

    let title = ytData?.videoDetails?.title || 
              ytData?.playerOverlays?.playerOverlayRenderer?.videoDetails?.playerOverlayVideoDetailsRenderer?.title?.simpleText ||
              chrome.i18n.getMessage("untitled");

      const panels = ytData?.engagementPanels || [];
      const hasTranscriptPanel = panels.some(p =>
        p.engagementPanelSectionListRenderer?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint
      );
    
      if (!hasTranscriptPanel) {
        const fallbackData = extractJsonFromHtml(html, "ytInitialPlayerResponse");
        return {
          title: title || fallbackData?.videoDetails?.title || chrome.i18n.getMessage("untitled"),
          ytData: fallbackData,
          dataKey: "ytInitialPlayerResponse",
          resolvedType: "shorts"
        };
    }

    return {
      title,
      ytData,
      dataKey,
      resolvedType: "regular"
    };
  }

  function createTranscriptArray(items, type) {
    return type === "regular"
      ? items.map(item => getSegmentData(item))
      : items.filter(e => e.segs).map(e => getShortsSegmentData(e));
  }

  function getSegmentData(item) {
    const seg = item?.transcriptSegmentRenderer;
    if (!seg) return ["", ""];
    const timestamp = seg.startTimeText?.simpleText || "";
    const text = seg.snippet?.runs?.map(r => r.text).join(" ") || "";
    return [timestamp, text];
  }

  function getShortsSegmentData(event) {
    const timestamp = msToTimestamp(event.tStartMs);
    const text = (event.segs || []).map(seg => seg.utf8).join(" ").replace(/\n/g, " ");
    return [timestamp, text];
  }

  function msToTimestamp(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }

  async function getTranscriptItems(ytData, dataKey) {
    if (dataKey === "ytInitialPlayerResponse") {
      const baseUrl = ytData?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0]?.baseUrl;
      if (!baseUrl) throw new Error("Transcript not available for this video.");
      const captionUrl = baseUrl + "&fmt=json3";
      try {
        const json = await fetch(captionUrl).then(res => {
          if (!res.ok) throw new Error(`Fetch failed with status: ${res.status}`);
          return res.json();
        });
      return json.events || [];
      } catch (e) {
        console.error("Error fetching or parsing transcript from baseUrl:", e);
        throw new Error("Transcript not available for this video.");
      }
    }

    const continuationParams = ytData.engagementPanels?.find(p =>
      p.engagementPanelSectionListRenderer?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint
    )?.engagementPanelSectionListRenderer?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint?.params;

    if (!continuationParams) throw new Error("Transcript not available for this video");

    const hl = ytData.topbar?.desktopTopbarRenderer?.searchbox?.fusionSearchboxRenderer?.config?.webSearchboxConfig?.requestLanguage || "en";
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

    const res = await fetch("https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const json = await res.json();
    return json.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer
      ?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments || [];
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
        } catch (err) {
          console.warn(`⚠️ Failed to parse ${key}:`, err.message);
        }
      }
    }

    throw new Error(`${key} not found`);
  }

  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = 0;
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        document.body.removeChild(textarea);
        throw new Error("Clipboard copy failed");
      }
    });
  }
})();
