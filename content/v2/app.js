// Experimental refactor entrypoint (v2).
// Uses extracted pure helpers; does not alter DOM behavior yet.
import {
  getVideoIdFromUrl,
  waitForElement,
  findDescriptionElement,
  formatSummaryHtml,
  parseTimestamp,
  secondsToLabel
} from './utils.js';
import { SettingsManager, DEFAULT_SETTINGS } from './core/settings.js';
import { TranscriptService } from './core/transcript.js';
import { SummaryPanel } from './ui/panel.js';

(() => {
  try {
    const ROOT = document.documentElement;
    if (ROOT && !ROOT.hasAttribute('data-yaivs-active')) {
      ROOT.setAttribute('data-yaivs-active', 'true');
    }
    // Light sanity checks (dev-friendly logs only)
    const vid = getVideoIdFromUrl(location.href);
    if (vid) {
      console.debug('[YAIVS v2] video id:', vid);
    }
    // Tiny no-op usage of helpers to ensure tree-shaking doesn't drop them in dev
    void parseTimestamp('1:23');
    void secondsToLabel(83);
    void formatSummaryHtml('Test [01:23] link', true);

    // Initialize core services (no UI yet)
    const settings = new SettingsManager(DEFAULT_SETTINGS);
    const transcript = new TranscriptService();
    void settings.ready;
    new SummaryPanel(settings, transcript);
    console.info('[YAIVS] Experimental v2 loaded (UI mounted).');
  } catch (e) {
    console.warn('[YAIVS] v2 init failed:', e?.message || e);
  }
})();
