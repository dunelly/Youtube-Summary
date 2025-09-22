import { waitForElement, findDescriptionElement } from '../utils.js';

export const PANEL_ID = 'yaivs-summary-panel';
export const STYLE_ID = 'yaivs-summary-styles';

export async function getPanelMountPoint() {
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

export function injectStyles() {
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

      .yaivs-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        position: relative;
      }

      .yaivs-panel__header { display: none; }

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

      .yaivs-unified-button {
        display: flex;
        align-items: center;
        padding: 0;
        border-radius: 20px;
        border: none;
        background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05));
        color: var(--yt-spec-text-primary, #0f0f0f);
        font-family: "Roboto", "Arial", sans-serif;
        cursor: pointer;
        transition: all 0.1s ease;
        overflow: hidden;
        flex-shrink: 0;
        height: 44px;
      }

      .yaivs-unified-main {
        display: flex;
        align-items: center;
        padding: 0 12px;
        flex: 1;
        transition: background 0.1s ease;
        height: 100%;
      }

      .yaivs-unified-dropdown {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 8px;
        border-left: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
        transition: background 0.1s ease;
        min-width: 24px;
        position: relative;
        height: 100%;
      }

      .yaivs-text { font-size: 15px; font-weight: 500; letter-spacing: 0.25px; }
      .yaivs-arrow { font-size: 14px; line-height: 1; opacity: 0.8; }

      .yaivs-unified-button:hover { background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.1)); }
      .yaivs-unified-button:disabled { background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05)); color: var(--yt-spec-text-disabled, rgba(0, 0, 0, 0.38)); cursor: not-allowed; }
      .yaivs-unified-button:focus { outline: 2px solid rgba(62, 166, 255, 0.5); outline-offset: 2px; }
      .yaivs-unified-button:focus:not(:focus-visible) { outline: none; }

      .yaivs-actions { display: flex; align-items: center; position: relative; gap: 8px; width: 100%; overflow: visible; }

      .yaivs-prompt { flex: 1; position: relative; }
      .yaivs-input-wrap { position: relative; }
      .yaivs-input {
        width: 100%;
        min-width: 220px;
        max-width: 100%;
        padding: 10px 42px 10px 14px;
        border-radius: 20px;
        border: 1px solid var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.1));
        background: var(--yt-spec-brand-background-primary, rgba(255, 255, 255, 0.06));
        color: var(--yt-spec-text-primary, #0f0f0f);
        font: inherit;
        box-sizing: border-box;
      }
      .yaivs-send { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 28px; height: 28px; border-radius: 50%; border: none; background: #ffffff; color: #111; font-size: 16px; line-height: 1; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }

      .yaivs-style-menu {
        position: absolute;
        left: 0;
        right: auto;
        top: 100%;
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
      .yaivs-style-menu > button { border: none; background: transparent; text-align: left; font: inherit; font-size: 13px; padding: 6px 8px; border-radius: 6px; cursor: pointer; color: #eaeaea; }
      .yaivs-style-menu > button:hover { background: rgba(255,255,255,0.08); }

      .yaivs-status--loading, .yaivs-status--success { color: var(--yt-spec-text-primary, #0f0f0f); }
      .yaivs-status--error { color: var(--yt-spec-brand-danger, #d93025); }

      .yaivs-summary { margin: 0; padding: 0; border: none; background: transparent; font-family: inherit; font-size: 14px; line-height: 1.6; white-space: normal; color: var(--yt-spec-text-primary, #0f0f0f); }
      .yaivs-summary.collapsed { max-height: 360px; overflow: hidden; }
      .yaivs-tools { display: flex; align-items: center; gap: 8px; }
      .yaivs-tool { border: none; background: transparent; color: var(--yt-spec-text-secondary, #606060); font: inherit; font-size: 12px; cursor: pointer; }
      .yaivs-summary .yaivs-timestamp { color: var(--yt-spec-call-to-action, #3ea6ff); text-decoration: none; font-weight: 500; cursor: pointer; }
      .yaivs-summary .yaivs-timestamp:hover { text-decoration: underline; }

      .yaivs-onboarding { border: 1px dashed rgba(0,0,0,0.2); border-radius: 8px; padding: 10px; background: rgba(62,166,255,0.06); }
      .yaivs-onb-text { font-size: 13px; margin-bottom: 8px; }
      .yaivs-onb-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
      .yaivs-onb-btn { border: 1px solid rgba(0,0,0,0.15); background: #fff; color: #111; border-radius: 16px; padding: 6px 10px; font: inherit; cursor: pointer; }
      .yaivs-onb-hint { font-size: 12px; color: #666; }
    `;

  document.head.appendChild(style);
}
