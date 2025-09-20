chrome.action.onClicked.addListener(async (tab) => {
  // This listener is kept in case we want to add direct icon-click functionality
  // in the future. For now, its primary job is to let the popup open.
  // The logic for fetching the transcript is handled entirely within the popup script.
  console.log("Extension icon clicked. Opening popup.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchTransformedUrl") {
    fetch(message.url)
      .then(response => response.text())
      .then(html => {
        sendResponse({ success: true, html: html });
      })
      .catch(error => {
        console.error("Error fetching transformed URL:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.setUninstallURL("https://docs.google.com/forms/d/e/1FAIpQLSe3QRmZddw108e9FJ-MWX34ZjHs-1OAEWRIISi_Xnr7HSHNkg/viewform?usp=header");
  }
});
