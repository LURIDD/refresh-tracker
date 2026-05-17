const MAX_LOGS = 500;
const MAX_CONSOLE_PER_TAB = 300;
const CONSOLE_RETENTION_MS = 60 * 60 * 1000; // 1 saat

const badgeApi = chrome.action || chrome.browserAction;
const storage = (typeof browser !== "undefined") ? browser.storage.local : chrome.storage.local;

// In-memory console buffer: tabId → [{level, args, timestamp, url}]
const consoleBuffer = new Map();

// Dedup: track recent content-script navigations to avoid double-logging
// when webNavigation API also fires. Key: "tabId:url", value: timestamp ms
const recentContentNavs = new Map();
const DEDUP_WINDOW_MS = 500;

const TRANSITION_TYPES = {
  reload:       "Yenileme (Reload)",
  auto_subframe:"Otomatik Alt Çerçeve",
  link:         "Link Tıklama",
  typed:        "URL Yazıldı",
  generated:    "Otomatik Üretildi",
  start_page:   "Başlangıç Sayfası",
  form_submit:  "Form Gönderimi",
  keyword:      "Anahtar Kelime",
  keyword_generated: "Anahtar Kelime (Otomatik)"
};

const TRANSITION_QUALIFIERS = {
  client_redirect:  "İstemci Yönlendirmesi",
  server_redirect:  "Sunucu Yönlendirmesi",
  forward_back:     "İleri/Geri",
  from_address_bar: "Adres Çubuğundan"
};

// navType from PerformanceNavigationTiming → our fields
function navTypeToFields(navType, redirectCount) {
  const isReload         = navType === "reload";
  const isBackForward    = navType === "back_forward";
  const isClientRedirect = redirectCount > 0 && navType === "navigate";
  const isAutomatic      = isClientRedirect || isBackForward;

  let transitionType = "URL Yazıldı";
  let transitionTypeRaw = "typed";
  if (isReload)      { transitionType = "Yenileme (Reload)"; transitionTypeRaw = "reload"; }
  if (isBackForward) { transitionType = "İleri/Geri";        transitionTypeRaw = "forward_back"; }

  return { isReload, isClientRedirect, isServerRedirect: false, isAutomatic, transitionType, transitionTypeRaw, qualifiers: [] };
}

function isAutomaticFromWebNav(transitionType, qualifiers) {
  if (qualifiers.includes("client_redirect")) return true;
  if (qualifiers.includes("server_redirect")) return true;
  if (["typed","link","form_submit","keyword"].includes(transitionType)) return false;
  if (transitionType === "reload" && qualifiers.length === 0) return false;
  return true;
}

async function saveLogEntry(logEntry) {
  const result = (await storage.get(["logs", "filterUrls", "filterUrl", "notifEnabled"])) || {};
  const logs = result.logs || [];

  // Çoklu URL filtresi — filterUrls (array) öncelikli, eski filterUrl'den migrate et
  let filterUrls = result.filterUrls;
  if (!filterUrls) {
    const old = (result.filterUrl || "").trim();
    filterUrls = old ? [old] : [];
  }
  if (filterUrls.length > 0 && !filterUrls.some(f => f && (logEntry.url || "").includes(f))) return;

  // Avoid duplicate ids
  if (logs.some(l => l.id === logEntry.id)) return;

  logs.unshift(logEntry);
  if (logs.length > MAX_LOGS) logs.splice(MAX_LOGS);

  await storage.set({ logs, lastEventAt: logEntry.timestamp });

  const autoCount = logs.filter(l => l.isAutomatic || l.isReload).length;
  badgeApi.setBadgeText({ text: autoCount > 0 ? String(autoCount) : "" });
  badgeApi.setBadgeBackgroundColor({ color: "#e53e3e" });

  // Bildirim — yalnızca navigasyon olayları, ws/js değil
  if (result.notifEnabled && !logEntry.kind && (logEntry.isAutomatic || logEntry.isReload)) {
    const typeLabel = logEntry.isClientRedirect ? "JS Yönlendirmesi"
                    : logEntry.isServerRedirect  ? "Sunucu Yönlendirmesi"
                    : logEntry.isReload           ? "Yenileme"
                    : "Otomatik Navigasyon";
    const shortUrl = (logEntry.url || "").replace(/^https?:\/\//, "").substring(0, 60);
    chrome.notifications.create(`rt-${logEntry.id}`, {
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "Refresh Tracker — " + typeLabel,
      message: shortUrl
    });
  }
}

// ── RT_NAVIGATION: content script reports page load (primary, cross-browser) ──
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "RT_CONSOLE") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    if (!consoleBuffer.has(tabId)) consoleBuffer.set(tabId, []);
    const buf = consoleBuffer.get(tabId);
    buf.push({ level: msg.level, args: msg.args, timestamp: msg.timestamp, url: msg.url });
    if (buf.length > MAX_CONSOLE_PER_TAB) buf.shift();
    return;
  }

  if (msg.type === "RT_WS_EVENT") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    const now = new Date(msg.timestamp);
    saveLogEntry({
      id: now.getTime(),
      kind: "ws_event",
      wsEvent: msg.event,
      wsUrl: msg.wsUrl,
      code: msg.code,
      reason: msg.reason,
      wasClean: msg.wasClean,
      timestamp: msg.timestamp,
      date: now.toLocaleDateString("tr-TR"),
      time: now.toLocaleTimeString("tr-TR", { hour12: false }),
      milliseconds: now.getMilliseconds(),
      url: msg.url,
      tabId,
      source: "injected"
    });
    return;
  }

  if (msg.type === "RT_JS_NAV") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    const now = new Date(msg.timestamp);
    saveLogEntry({
      id: now.getTime(),
      kind: "js_nav",
      method: msg.method,
      targetUrl: msg.targetUrl,
      stack: msg.stack,
      timestamp: msg.timestamp,
      date: now.toLocaleDateString("tr-TR"),
      time: now.toLocaleTimeString("tr-TR", { hour12: false }),
      milliseconds: now.getMilliseconds(),
      url: msg.url,
      tabId,
      source: "injected"
    });
    return;
  }

  if (msg.type === "RT_NAVIGATION") {
    const tabId = sender.tab?.id;
    if (!tabId) return;

    const now = new Date(msg.timestamp);
    const fields = navTypeToFields(msg.navType, msg.redirectCount);

    // Grab console buffer for automatic navigations
    let capturedConsoleLogs = null;
    if (fields.isAutomatic || fields.isReload) {
      const buf = consoleBuffer.get(tabId) || [];
      const cutoff = now.getTime() - CONSOLE_RETENTION_MS;
      capturedConsoleLogs = buf.filter(e => new Date(e.timestamp).getTime() >= cutoff);
      consoleBuffer.set(tabId, []);
    }

    const dedupKey = `${tabId}:${msg.url}`;
    recentContentNavs.set(dedupKey, now.getTime());
    setTimeout(() => recentContentNavs.delete(dedupKey), DEDUP_WINDOW_MS);

    const logEntry = {
      id: now.getTime(),
      timestamp: msg.timestamp,
      date: now.toLocaleDateString("tr-TR"),
      time: now.toLocaleTimeString("tr-TR", { hour12: false }),
      milliseconds: now.getMilliseconds(),
      url: msg.url || "(bilinmiyor)",
      tabId,
      pageTitle: sender.tab?.title || "",
      dayOfWeek: now.toLocaleDateString("tr-TR", { weekday: "long" }),
      source: "content",
      consoleLogs: capturedConsoleLogs,
      ...fields
    };

    saveLogEntry(logEntry);
  }
});

// ── webNavigation.onCommitted: supplement (Chrome reliable, Firefox fallback) ──
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  // Skip if content script already logged this navigation
  const dedupKey = `${details.tabId}:${details.url}`;
  const contentNavTime = recentContentNavs.get(dedupKey);
  if (contentNavTime && Math.abs(Date.now() - contentNavTime) < DEDUP_WINDOW_MS) return;

  const transitionType = details.transitionType;
  const qualifiers = details.transitionQualifiers || [];
  const isReload = transitionType === "reload";
  const isClientRedirect = qualifiers.includes("client_redirect");
  const isServerRedirect = qualifiers.includes("server_redirect");
  const automatic = isAutomaticFromWebNav(transitionType, qualifiers);

  const now = new Date();

  let capturedConsoleLogs = null;
  if (automatic) {
    const buf = consoleBuffer.get(details.tabId) || [];
    const cutoff = now.getTime() - CONSOLE_RETENTION_MS;
    capturedConsoleLogs = buf.filter(e => new Date(e.timestamp).getTime() >= cutoff);
    consoleBuffer.set(details.tabId, []);
  }

  let pageTitle = "";
  try { pageTitle = (await chrome.tabs.get(details.tabId)).title || ""; } catch {}

  const logEntry = {
    id: now.getTime(),
    timestamp: now.toISOString(),
    date: now.toLocaleDateString("tr-TR"),
    time: now.toLocaleTimeString("tr-TR", { hour12: false }),
    milliseconds: now.getMilliseconds(),
    url: details.url || "(bilinmiyor)",
    tabId: details.tabId,
    pageTitle,
    transitionType: TRANSITION_TYPES[transitionType] || transitionType,
    transitionTypeRaw: transitionType,
    qualifiers: qualifiers.map(q => TRANSITION_QUALIFIERS[q] || q),
    isReload, isClientRedirect, isServerRedirect,
    isAutomatic: automatic,
    dayOfWeek: now.toLocaleDateString("tr-TR", { weekday: "long" }),
    source: "webNavigation",
    consoleLogs: capturedConsoleLogs
  };

  saveLogEntry(logEntry);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  consoleBuffer.delete(tabId);
});
