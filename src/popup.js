let allLogs = [];
let filterUrls = [];
let currentFilter = "all";
let currentTimeFilter = "all";
let currentTabFilter = null;
let displayLimit = 50;
let notifEnabled = false;
let tabLabelMap = new Map();

const storage = (typeof browser !== "undefined") ? browser.storage.local : chrome.storage.local;
const storageApi = (typeof browser !== "undefined") ? browser.storage : chrome.storage;

// Track which entries have their panel open
const openPanels = new Set();

// ── Load / render ─────────────────────────────────────────────────────

async function loadLogs() {
  const result = (await storage.get(["logs", "filterUrls", "filterUrl", "notifEnabled"])) || {};
  allLogs = result.logs || [];
  notifEnabled = result.notifEnabled || false;

  // Backward compat: migrate eski filterUrl string → filterUrls array
  if (result.filterUrls !== undefined) {
    filterUrls = result.filterUrls;
  } else if (result.filterUrl) {
    filterUrls = [result.filterUrl.trim()].filter(Boolean);
  } else {
    filterUrls = [];
  }

  // Tab label haritası: tabId → sıralı numara (T1, T2, ...)
  tabLabelMap = new Map();
  let tabCounter = 1;
  for (const l of allLogs) {
    if (l.tabId !== undefined && !tabLabelMap.has(l.tabId)) {
      tabLabelMap.set(l.tabId, tabCounter++);
    }
  }

  renderChips();
  updateNotifButton();
  updateStats();
  renderLogs();
}

function renderChips() {
  const container = document.getElementById("filterChips");
  const parts = [];

  filterUrls.forEach((f, i) => {
    parts.push(
      `<span class="filter-chip">${escapeHtml(f)}<span class="chip-remove" data-url-idx="${i}">×</span></span>`
    );
  });

  if (currentTabFilter !== null) {
    const label = tabLabelMap.get(currentTabFilter) || currentTabFilter;
    parts.push(
      `<span class="filter-chip tab-chip">Tab ${label}<span class="chip-remove" id="clearTabFilter">×</span></span>`
    );
  }

  container.style.display = parts.length ? "flex" : "none";
  container.innerHTML = parts.join("");

  container.querySelectorAll("[data-url-idx]").forEach(el => {
    el.addEventListener("click", async () => {
      const idx = Number(el.dataset.urlIdx);
      filterUrls.splice(idx, 1);
      await storage.set({ filterUrls });
      renderChips();
    });
  });

  const clearTab = document.getElementById("clearTabFilter");
  if (clearTab) {
    clearTab.addEventListener("click", () => {
      currentTabFilter = null;
      displayLimit = 50;
      renderChips();
      renderLogs();
    });
  }
}

function updateNotifButton() {
  const btn = document.getElementById("toggleNotif");
  if (notifEnabled) {
    btn.textContent = "Bildirim: Açık";
    btn.style.background = "#064e3b";
    btn.style.color = "#6ee7b7";
    btn.style.border = "1px solid #065f46";
  } else {
    btn.textContent = "Bildirim: Kapalı";
    btn.style.background = "#1e293b";
    btn.style.color = "#64748b";
    btn.style.border = "";
  }
}

function updateStats() {
  const navLogs = allLogs.filter(l => !l.kind);
  document.getElementById("totalCount").textContent = navLogs.length;
  document.getElementById("autoCount").textContent = navLogs.filter(l => l.isAutomatic).length;
  document.getElementById("reloadCount").textContent = navLogs.filter(l => l.isAutomatic || l.isReload).length;

  if (navLogs.length > 0) {
    document.getElementById("lastEntry").textContent = navLogs[0].time;
    const first = navLogs[navLogs.length - 1];
    document.getElementById("firstEntry").textContent = first.date + " " + first.time;
  }
}

function applyTimeFilter(logs) {
  if (currentTimeFilter === "all") return logs;
  const cutoff = Date.now() - (currentTimeFilter === "1h" ? 3_600_000 : 86_400_000);
  return logs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
}

function getFilteredLogs() {
  let logs = allLogs;

  switch (currentFilter) {
    case "auto":     logs = logs.filter(l => l.isAutomatic); break;
    case "reload":   logs = logs.filter(l => l.isReload); break;
    case "redirect": logs = logs.filter(l => l.isClientRedirect || l.isServerRedirect); break;
    case "ws_js":    logs = logs.filter(l => l.kind === "ws_event" || l.kind === "js_nav"); break;
  }

  logs = applyTimeFilter(logs);

  if (currentTabFilter !== null) {
    logs = logs.filter(l => l.tabId === currentTabFilter);
  }

  return logs;
}

// ── WS entry render ───────────────────────────────────────────────────

const WS_CLOSE_CODES = {
  1000: "normal kapanış",
  1001: "uzak taraf gitti",
  1002: "protokol hatası",
  1005: "durum kodu yok",
  1006: "anormal kapanış (bağlantı kesildi)",
  1007: "geçersiz veri",
  1008: "politika ihlali",
  1009: "mesaj çok büyük",
  1011: "sunucu hatası",
  1012: "servis yeniden başlatılıyor",
  1013: "tekrar dene",
  1015: "TLS hatası"
};

function renderWsEntry(entry) {
  const eventMap = { open: "WS BAĞLANDI", close: "WS KOPTU", error: "WS HATA" };
  const label = eventMap[entry.wsEvent] || "WS";
  const cssClass = entry.wsEvent === "open" ? "ws-open"
                 : entry.wsEvent === "error" ? "ws-error"
                 : "ws-close";

  let detail = "";
  if (entry.wsEvent === "close") {
    const codeDesc = WS_CLOSE_CODES[entry.code] || `kod ${entry.code}`;
    const reason = entry.reason ? ` — "${escapeHtml(entry.reason)}"` : "";
    const isAbnormal = !entry.wasClean;
    detail = `<span class="ws-detail ${isAbnormal ? "abnormal" : ""}">${escapeHtml(codeDesc)}${reason}</span>`;
  }

  const shortWsUrl = (entry.wsUrl || "").length > 58
    ? (entry.wsUrl || "").substring(0, 55) + "…"
    : (entry.wsUrl || "");
  const shortPageUrl = (entry.url || "").length > 65
    ? (entry.url || "").substring(0, 62) + "…"
    : (entry.url || "");

  return `<div class="log-entry ${cssClass}" data-id="${entry.id}">
    <div class="log-entry-header">
      <div class="log-header-row">
        <span class="log-time">${entry.time}<span class="log-ms">.${String(entry.milliseconds).padStart(3, "0")}</span></span>
        <span class="log-type-badge">${label}</span>
        ${detail}
        <span class="log-date">${entry.date}</span>
      </div>
      <div class="ws-url" title="${escapeHtml(entry.wsUrl || "")}">${escapeHtml(shortWsUrl)}</div>
      <div class="log-url" title="${escapeHtml(entry.url || "")}">${escapeHtml(shortPageUrl)}</div>
    </div>
  </div>`;
}

// ── JS Nav entry render ───────────────────────────────────────────────

function renderJsNavEntry(entry) {
  const entryId = entry.id;
  const hasStack = !!(entry.stack && entry.stack.trim());
  const isOpen = openPanels.has(entryId) ? "open" : "";

  const shortTarget = (entry.targetUrl || "").length > 65
    ? (entry.targetUrl || "").substring(0, 62) + "…"
    : (entry.targetUrl || "");

  const stackHtml = hasStack
    ? `<div class="stack-panel ${isOpen}" id="sp-${entryId}">
        ${entry.stack.split("\n").filter(l => l.trim()).map(l =>
          `<div class="stack-line">${escapeHtml(l.trim())}</div>`
        ).join("")}
      </div>`
    : "";

  return `<div class="log-entry js-nav" data-id="${entryId}">
    <div class="log-entry-header" ${hasStack ? `data-toggle-stack="${entryId}"` : ""}>
      <div class="log-header-row">
        <span class="log-time">${entry.time}<span class="log-ms">.${String(entry.milliseconds).padStart(3, "0")}</span></span>
        <span class="log-type-badge">JS NAV</span>
        <span class="js-method">${escapeHtml(entry.method || "")}</span>
        <span class="log-date">${entry.date}</span>
      </div>
      <div class="log-url" title="${escapeHtml(entry.targetUrl || "")}">${escapeHtml(shortTarget)}</div>
    </div>
    ${stackHtml}
  </div>`;
}

// ── Console panel render ──────────────────────────────────────────────

const LEVEL_LABELS = {
  log: "LOG", info: "INFO", warn: "WARN", error: "ERR",
  debug: "DBG", uncaught_error: "HATA", unhandled_rejection: "REJECT"
};

function renderConsolePanel(entry, entryId) {
  const logs = entry.consoleLogs;
  if (!logs) {
    return `<div class="console-panel" id="cp-${entryId}">
      <div class="no-console">Bu yenileme kullanıcı kaynaklı — console logları yakalanmadı.</div>
    </div>`;
  }

  const header = `<div class="console-panel-header">
    <span>Console logları (yenilemeden önceki 1 saat) — ${logs.length} kayıt</span>
    <span>${logs.filter(l => ["error","uncaught_error","unhandled_rejection"].includes(l.level)).length} hata</span>
  </div>`;

  if (logs.length === 0) {
    return `<div class="console-panel" id="cp-${entryId}">
      ${header}
      <div class="no-console">Console logu yakalanmadı.</div>
    </div>`;
  }

  const lines = logs.map(l => {
    const t = new Date(l.timestamp).toLocaleTimeString("tr-TR", { hour12: false });
    const label = LEVEL_LABELS[l.level] || l.level.toUpperCase();
    const argsText = (l.args || []).join(" ");
    return `<div class="console-line">
      <span class="console-time">${t}</span>
      <span class="console-level lvl-${l.level}">${label}</span>
      <span class="console-args">${escapeHtml(argsText)}</span>
    </div>`;
  }).join("");

  return `<div class="console-panel" id="cp-${entryId}">
    ${header}${lines}
  </div>`;
}

// ── Nav entry render ──────────────────────────────────────────────────

function renderNavEntry(entry) {
  const entryId = entry.id;
  let cssClass = "normal";
  let typeLabel = entry.transitionType;

  if (entry.isClientRedirect) {
    cssClass = "auto";
    typeLabel = "JS YÖN.";
  } else if (entry.isServerRedirect) {
    cssClass = "redirect";
    typeLabel = "SUNUCU YÖN.";
  } else if (entry.isAutomatic) {
    cssClass = "auto";
    typeLabel = "OTOMATİK";
  } else if (entry.isReload) {
    cssClass = "reload";
    typeLabel = "YENİLEME";
  }

  let consoleIndicator = "";
  if ((entry.isAutomatic || entry.isReload) && entry.consoleLogs) {
    const errCount = entry.consoleLogs.filter(l =>
      ["error", "uncaught_error", "unhandled_rejection"].includes(l.level)
    ).length;
    const cls = errCount > 0 ? "has-errors" : "";
    const label = errCount > 0
      ? `${errCount} hata / ${entry.consoleLogs.length} log`
      : `${entry.consoleLogs.length} log`;
    consoleIndicator = `<span class="console-indicator ${cls}">CONSOLE ${label}</span>`;
  }

  const qualifierTags = entry.qualifiers && entry.qualifiers.length > 0
    ? `<div class="log-qualifiers">${entry.qualifiers.map(q => `<span class="qualifier-tag">${q}</span>`).join("")}</div>`
    : "";

  const shortUrl = (entry.url || "").length > 65
    ? entry.url.substring(0, 62) + "…"
    : (entry.url || "");
  const isOpen = openPanels.has(entryId) ? "open" : "";
  const canExpand = entry.isAutomatic || entry.isReload;

  const consoleHtml = canExpand
    ? renderConsolePanel(entry, entryId).replace('class="console-panel"', `class="console-panel ${isOpen}"`)
    : "";

  // Tab badge — yalnızca birden fazla tab varsa göster
  const tabBadge = tabLabelMap.size > 1 && entry.tabId !== undefined
    ? `<span class="tab-badge ${currentTabFilter === entry.tabId ? "active" : ""}" data-tab-click="${entry.tabId}">T${tabLabelMap.get(entry.tabId) || "?"}</span>`
    : "";

  return `<div class="log-entry ${cssClass}" data-id="${entryId}">
    <div class="log-entry-header" ${canExpand ? `data-toggle="${entryId}"` : ""}>
      <div class="log-header-row">
        <span class="log-time">${entry.time}<span class="log-ms">.${String(entry.milliseconds).padStart(3, "0")}</span></span>
        <span class="log-type-badge">${typeLabel}</span>
        ${consoleIndicator}
        ${tabBadge}
        <span class="log-date">${entry.date} ${entry.dayOfWeek || ""}</span>
      </div>
      ${entry.pageTitle ? `<div class="log-title">${escapeHtml(entry.pageTitle)}</div>` : ""}
      <div class="log-url" title="${escapeHtml(entry.url || "")}">${escapeHtml(shortUrl)}</div>
      ${qualifierTags}
    </div>
    ${consoleHtml}
  </div>`;
}

// ── Main render ───────────────────────────────────────────────────────

function renderLogs() {
  const container = document.getElementById("logList");
  const logs = getFilteredLogs();

  if (logs.length === 0) {
    container.innerHTML = `<div class="empty">
      <h3>Kayıt bulunamadı</h3>
      <p>${currentFilter === "all" && currentTimeFilter === "all" && currentTabFilter === null
        ? "Sayfa yenilendikçe kayıtlar burada görünecek."
        : "Bu filtre için kayıt yok."}</p>
    </div>`;
    return;
  }

  const visible = logs.slice(0, displayLimit);
  const remaining = logs.length - displayLimit;

  container.innerHTML = visible.map(entry => {
    if (entry.kind === "ws_event") return renderWsEntry(entry);
    if (entry.kind === "js_nav")   return renderJsNavEntry(entry);
    return renderNavEntry(entry);
  }).join("") + (remaining > 0
    ? `<div class="load-more-row"><button id="loadMore" class="btn">${remaining} kayıt daha göster</button></div>`
    : "");

  // Console panel toggle
  container.querySelectorAll("[data-toggle]").forEach(el => {
    el.addEventListener("click", () => {
      const id = Number(el.dataset.toggle);
      const panel = document.getElementById(`cp-${id}`);
      if (!panel) return;
      if (openPanels.has(id)) {
        openPanels.delete(id);
        panel.classList.remove("open");
      } else {
        openPanels.add(id);
        panel.classList.add("open");
      }
    });
  });

  // Stack trace panel toggle
  container.querySelectorAll("[data-toggle-stack]").forEach(el => {
    el.addEventListener("click", () => {
      const id = Number(el.dataset.toggleStack);
      const panel = document.getElementById(`sp-${id}`);
      if (!panel) return;
      if (openPanels.has(id)) {
        openPanels.delete(id);
        panel.classList.remove("open");
      } else {
        openPanels.add(id);
        panel.classList.add("open");
      }
    });
  });

  // Tab badge click — tab filtresini aktif et / kaldır
  container.querySelectorAll("[data-tab-click]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const tabId = Number(el.dataset.tabClick);
      currentTabFilter = currentTabFilter === tabId ? null : tabId;
      displayLimit = 50;
      renderChips();
      renderLogs();
    });
  });

  // Load more button
  const loadMoreBtn = document.getElementById("loadMore");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      displayLimit += 50;
      renderLogs();
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportCsv() {
  const logs = getFilteredLogs().filter(l => !l.kind); // yalnızca nav logları
  if (logs.length === 0) return;

  const rows = [];
  for (const l of logs) {
    const base = [
      l.date, l.time, l.milliseconds,
      l.transitionTypeRaw,
      l.isAutomatic ? "Evet" : "Hayır",
      l.isReload ? "Evet" : "Hayır",
      l.isClientRedirect ? "Evet" : "Hayır",
      l.isServerRedirect ? "Evet" : "Hayır",
      (l.qualifiers || []).join("; "),
      l.url, l.pageTitle || ""
    ];

    if (l.consoleLogs && l.consoleLogs.length > 0) {
      for (const c of l.consoleLogs) {
        rows.push([...base,
          new Date(c.timestamp).toLocaleTimeString("tr-TR", { hour12: false }),
          c.level,
          (c.args || []).join(" ")
        ]);
      }
    } else {
      rows.push([...base, "", "", ""]);
    }
  }

  const headers = [
    "Tarih", "Saat", "ms", "Tür", "Otomatik", "Reload",
    "İstemci Yön.", "Sunucu Yön.", "Niteleyiciler", "URL", "Sayfa Başlığı",
    "Console Saat", "Console Seviye", "Console Mesaj"
  ];

  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `refresh-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Debug panel ───────────────────────────────────────────────────────

async function updateDebugPanel() {
  const result = (await storage.get(["logs", "lastEventAt"])) || {};
  const logs = result.logs || [];

  document.getElementById("dbg-bg").textContent = "Çalışıyor";
  document.getElementById("dbg-bg").className = "debug-ok";

  const navEl = document.getElementById("dbg-nav");
  if (logs.length > 0) {
    navEl.textContent = "OK";
    navEl.className = "debug-ok";
  } else {
    navEl.textContent = "Henüz olay yok";
    navEl.className = "debug-warn";
  }

  const filterEl = document.getElementById("dbg-filter");
  if (filterUrls.length > 0) {
    filterEl.textContent = `"${filterUrls.join(", ")}" — diğer siteler atlanıyor`;
    filterEl.className = "debug-warn";
  } else {
    filterEl.textContent = "Yok (tüm siteler)";
    filterEl.className = "debug-ok";
  }

  const lastEl = document.getElementById("dbg-last");
  if (result.lastEventAt) {
    const diff = Math.round((Date.now() - new Date(result.lastEventAt).getTime()) / 1000);
    lastEl.textContent = diff < 60 ? `${diff}s önce` : `${Math.round(diff / 60)}dk önce`;
    lastEl.className = "debug-ok";
  } else {
    lastEl.textContent = "Hiç olay alınmadı";
    lastEl.className = "debug-err";
  }

  document.getElementById("dbg-total").textContent = `${logs.length} kayıt`;
}

// ── Event listeners ───────────────────────────────────────────────────

// URL filtresi ekle
document.getElementById("addFilter").addEventListener("click", async () => {
  const val = document.getElementById("urlFilterInput").value.trim();
  if (!val || filterUrls.includes(val)) return;
  filterUrls.push(val);
  await storage.set({ filterUrls });
  document.getElementById("urlFilterInput").value = "";
  renderChips();
});

document.getElementById("urlFilterInput").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const val = e.target.value.trim();
  if (!val || filterUrls.includes(val)) return;
  filterUrls.push(val);
  await storage.set({ filterUrls });
  e.target.value = "";
  renderChips();
});

// CSV export
document.getElementById("exportCsv").addEventListener("click", exportCsv);

// Temizle
document.getElementById("clearLogs").addEventListener("click", async () => {
  if (confirm("Tüm kayıtlar silinecek. Emin misiniz?")) {
    await storage.set({ logs: [] });
    allLogs = [];
    openPanels.clear();
    displayLimit = 50;
    currentTabFilter = null;
    tabLabelMap = new Map();
    updateStats();
    renderChips();
    renderLogs();
    (chrome.action || chrome.browserAction).setBadgeText({ text: "" });
  }
});

// Tip filtreleri
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    displayLimit = 50;
    renderLogs();
  });
});

// Zaman filtreleri
document.querySelectorAll(".time-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".time-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTimeFilter = btn.dataset.time;
    displayLimit = 50;
    renderLogs();
  });
});

// Bildirim toggle
document.getElementById("toggleNotif").addEventListener("click", async () => {
  notifEnabled = !notifEnabled;
  await storage.set({ notifEnabled });
  updateNotifButton();
});

// Debug panel
let debugOpen = false;
document.getElementById("toggleDebug").addEventListener("click", () => {
  debugOpen = !debugOpen;
  document.getElementById("debugPanel").style.display = debugOpen ? "block" : "none";
  if (debugOpen) updateDebugPanel();
});

// ── Storage listener — gerçek zamanlı güncelleme ──────────────────────

storageApi.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.logs || changes.filterUrls || changes.notifEnabled) {
    loadLogs();
    if (debugOpen) updateDebugPanel();
  }
});

// ── Init ──────────────────────────────────────────────────────────────

loadLogs();
// 30 saniyelik yedek polling (onChanged'ın kaçırdığı durumlar için)
setInterval(loadLogs, 30_000);
setInterval(() => { if (debugOpen) updateDebugPanel(); }, 5_000);
