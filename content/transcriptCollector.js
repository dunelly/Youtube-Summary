import { containsAuthMessage, getVideoIdFromUrl, normalizeWhitespace } from './utils.js';
import { fetchTranscriptLines } from './youtubeTranscript.js';

export class TranscriptCollector {
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
