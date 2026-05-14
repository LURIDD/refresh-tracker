// --- 1. Navigation detection (works on all browsers, no special permissions needed) ---
(function detectNavigation() {
  const timestamp = new Date().toISOString();
  const navEntry = performance.getEntriesByType("navigation")[0];
  const navType = navEntry ? navEntry.type : "navigate";           // "reload" | "navigate" | "back_forward"
  const redirectCount = navEntry ? (navEntry.redirectCount || 0) : 0;

  chrome.runtime.sendMessage({
    type: "RT_NAVIGATION",
    navType,
    redirectCount,
    url: location.href,
    timestamp
  }).catch(() => {});
})();

// --- 2. Console interception (inject into page's main world) ---
const s = document.createElement("script");
s.src = chrome.runtime.getURL("injected.js");
document.documentElement.prepend(s);
s.remove();

window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || !e.data.__RT__) return;
  chrome.runtime.sendMessage({
    type: "RT_CONSOLE",
    level: e.data.level,
    args: e.data.args,
    timestamp: e.data.timestamp,
    url: location.href
  }).catch(() => {});
});
