// background.js — Auditor Service Worker

// Relay audit data from content.js back to popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'auditData') {
    // Store result temporarily so popup can retrieve it
    chrome.storage.session.set({ pendingAudit: msg.data });
    sendResponse({ ok: true });
  }
});
