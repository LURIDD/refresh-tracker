let allLogs = [];
let currentFilter = "all";

// Firefox uses browser.* with native Promise support; Chrome uses chrome.*
const storage = (typeof browser !== "undefined") ? browser.storage.local : chrome.storage.local;

// Track which entries have their console panel open
const openPanels = new Set();

async function loadLogs() {
  const result = (await storage.get(["logs", "filterUrl"])) || {};
  allLogs = result.logs || [];

  const filterUrl = result.filterUrl || "";
  document.getElementById("urlFilter").value = filterUrl;
  document.getElementById("filterStatus").textContent = filterUrl
    ? `Filtre: ${filterUrl}`
    : "Filtre: Yok";

  updateStats();
  renderLogs();
}

function updateStats() {
  const autoEntries = allLogs.filter(l => l.isAutomatic);
  document.getElementById("totalCount").textContent = allLogs.length;
  document.getElementById("autoCount").textContent = autoEntries.length;
  document.getElementById("reloadCount").textContent = autoEntries.length;

  if (allLogs.length > 0) {
    document.getElementById("lastEntry").textContent = allLogs[0].time;
    const first = allLogs[allLogs.length - 1];
    document.getElementById("firstEntry").textContent = first.date + " " + first.time;
  }
}

function getFilteredLogs() {
  switch (currentFilter) {
    case "auto":     return allLogs.filter(l => l.isAutomatic);
    case "reload":   return allLogs.filter(l => l.isReload);
    case "redirect": return allLogs.filter(l => l.isClientRedirect || l.isServerRedirect);
    default:         return allLogs;
  }
}

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

function renderLogs() {
  const container = document.getElementById("logList");
  const logs = getFilteredLogs();

  if (logs.length === 0) {
    container.innerHTML = `<div class="empty">
      <h3>Kayıt bulunamadı</h3>
      <p>${currentFilter === "all" ? "Sayfa yenilendikçe kayıtlar burada görünecek." : "Bu filtre için kayıt yok."}</p>
    </div>`;
    return;
  }

  container.innerHTML = logs.map(entry => {
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

    // Console indicator badge for automatic entries
    let consoleIndicator = "";
    if (entry.isAutomatic && entry.consoleLogs) {
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

    const shortUrl = entry.url.length > 65 ? entry.url.substring(0, 62) + "…" : entry.url;
    const isOpen = openPanels.has(entryId) ? "open" : "";
    const canExpand = entry.isAutomatic;

    const consoleHtml = canExpand
      ? renderConsolePanel(entry, entryId).replace('class="console-panel"', `class="console-panel ${isOpen}"`)
      : "";

    return `<div class="log-entry ${cssClass}" data-id="${entryId}">
      <div class="log-entry-header" ${canExpand ? `data-toggle="${entryId}"` : ""}>
        <div class="log-header-row">
          <span class="log-time">${entry.time}<span class="log-ms">.${String(entry.milliseconds).padStart(3, "0")}</span></span>
          <span class="log-type-badge">${typeLabel}</span>
          ${consoleIndicator}
          <span class="log-date">${entry.date} ${entry.dayOfWeek}</span>
        </div>
        ${entry.pageTitle ? `<div class="log-title">${escapeHtml(entry.pageTitle)}</div>` : ""}
        <div class="log-url" title="${escapeHtml(entry.url)}">${escapeHtml(shortUrl)}</div>
        ${qualifierTags}
      </div>
      ${consoleHtml}
    </div>`;
  }).join("");

  // Bind toggle clicks for console panels
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
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportCsv() {
  const logs = getFilteredLogs();
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

// ── Event listeners ──

document.getElementById("saveFilter").addEventListener("click", async () => {
  const filterUrl = document.getElementById("urlFilter").value.trim();
  await storage.set({ filterUrl });
  document.getElementById("filterStatus").textContent = filterUrl
    ? `Filtre: ${filterUrl}`
    : "Filtre: Yok";
});

document.getElementById("exportCsv").addEventListener("click", exportCsv);

document.getElementById("clearLogs").addEventListener("click", async () => {
  if (confirm("Tüm kayıtlar silinecek. Emin misiniz?")) {
    await storage.set({ logs: [] });
    allLogs = [];
    openPanels.clear();
    updateStats();
    renderLogs();
    (chrome.action || chrome.browserAction).setBadgeText({ text: "" });
  }
});

document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderLogs();
  });
});

// ── Debug panel ──

async function updateDebugPanel() {
  const result = (await storage.get(["logs", "filterUrl", "lastEventAt"])) || {};
  const logs = result.logs || [];
  const filterUrl = (result.filterUrl || "").trim();
  const lastEventAt = result.lastEventAt;

  // Background reachability
  document.getElementById("dbg-bg").textContent = "Çalışıyor";
  document.getElementById("dbg-bg").className = "debug-ok";

  // webNavigation permission check (indirect: if we have logs, it works)
  const navEl = document.getElementById("dbg-nav");
  if (logs.length > 0) {
    navEl.textContent = "OK";
    navEl.className = "debug-ok";
  } else {
    navEl.textContent = "Henüz olay yok";
    navEl.className = "debug-warn";
  }

  // Filter status
  const filterEl = document.getElementById("dbg-filter");
  if (filterUrl) {
    filterEl.textContent = `"${filterUrl}" — diğer siteler atlanıyor`;
    filterEl.className = "debug-warn";
  } else {
    filterEl.textContent = "Yok (tüm siteler)";
    filterEl.className = "debug-ok";
  }

  // Last event
  const lastEl = document.getElementById("dbg-last");
  if (lastEventAt) {
    const diff = Math.round((Date.now() - new Date(lastEventAt).getTime()) / 1000);
    lastEl.textContent = diff < 60 ? `${diff}s önce` : `${Math.round(diff/60)}dk önce`;
    lastEl.className = "debug-ok";
  } else {
    lastEl.textContent = "Hiç olay alınmadı";
    lastEl.className = "debug-err";
  }

  document.getElementById("dbg-total").textContent = `${logs.length} kayıt`;
}

let debugOpen = false;
document.getElementById("toggleDebug").addEventListener("click", () => {
  debugOpen = !debugOpen;
  document.getElementById("debugPanel").style.display = debugOpen ? "block" : "none";
  if (debugOpen) updateDebugPanel();
});

loadLogs();
setInterval(loadLogs, 3000);
setInterval(() => { if (debugOpen) updateDebugPanel(); }, 3000);
