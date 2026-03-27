// background.js — Service Worker (Manifest V3)

// Open comparator as full-page tab when icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});

// Handle messages from app.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'capture') {
    captureUrl(msg.url, msg.device)
      .then(dataUrl => sendResponse({ ok: true, dataUrl }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

/**
 * Opens a URL in a new window, waits for load, captures screenshot, closes window.
 * @param {string} url
 * @param {{ width: number, height: number }} device
 * @returns {Promise<string>} base64 data URL
 */
async function captureUrl(url, device = { width: 1440, height: 900 }) {
  const CHROME_UI_H = 100; // approximate Chrome toolbar height

  // Open new window at target URL
  const newWin = await chrome.windows.create({
    url,
    width: device.width,
    height: device.height + CHROME_UI_H,
    type: 'normal',
    focused: true
  });

  const tabId = newWin.tabs[0].id;

  // Wait for tab to fully load
  await waitForTabComplete(tabId);

  // Extra settle time for animations / lazy-load images
  await sleep(1500);

  // Capture visible area
  const dataUrl = await chrome.tabs.captureVisibleTab(newWin.id, { format: 'png' });

  // Close capture window
  await chrome.windows.remove(newWin.id);

  return dataUrl;
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout (30s)'));
    }, 30000);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Also check current status in case tab already loaded
    chrome.tabs.get(tabId, tab => {
      if (tab && tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
