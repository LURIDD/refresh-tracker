// Runs in the page's main world — intercepts console, WebSocket, and JS navigation
(function () {
  if (window.__RT_INJECTED__) return;
  window.__RT_INJECTED__ = true;

  // ── Serialize helper ──────────────────────────────────────────────────
  function serialize(val) {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (val instanceof Error) return val.stack || val.message;
    if (typeof val === "object") {
      try { return JSON.stringify(val, null, 0); } catch { return String(val); }
    }
    return String(val);
  }

  // ── Emit helpers ──────────────────────────────────────────────────────
  function emitConsole(level, args) {
    try {
      window.postMessage({
        __RT__: true, __RT_TYPE__: "console",
        level, args: Array.from(args).map(serialize),
        timestamp: new Date().toISOString()
      }, "*");
    } catch (_) {}
  }

  function emitWs(event, data) {
    try {
      window.postMessage({
        __RT__: true, __RT_TYPE__: "ws",
        event, ...data,
        timestamp: new Date().toISOString()
      }, "*");
    } catch (_) {}
  }

  function emitJsNav(method, targetUrl) {
    try {
      const rawStack = (() => { try { throw new Error(); } catch (e) { return e.stack || ""; } })();
      const stack = rawStack
        .split("\n")
        .filter(l => !l.includes("injected.js") && l.trim() !== "Error")
        .slice(0, 8)
        .join("\n");
      window.postMessage({
        __RT__: true, __RT_TYPE__: "js_nav",
        method, targetUrl: String(targetUrl),
        stack,
        timestamp: new Date().toISOString()
      }, "*");
    } catch (_) {}
  }

  // ── Console intercept ─────────────────────────────────────────────────
  const LEVELS = ["log", "warn", "error", "info", "debug"];
  const _orig = {};
  LEVELS.forEach(level => {
    _orig[level] = console[level].bind(console);
    console[level] = function (...args) {
      _orig[level](...args);
      emitConsole(level, args);
    };
  });

  window.addEventListener("error", (e) => {
    const msg = e.message || "Unknown error";
    const loc = e.filename ? ` — ${e.filename}:${e.lineno}:${e.colno}` : "";
    emitConsole("uncaught_error", [msg + loc]);
  });

  window.addEventListener("unhandledrejection", (e) => {
    emitConsole("unhandled_rejection", [String(e.reason)]);
  });

  // ── WebSocket intercept ───────────────────────────────────────────────
  if (window.WebSocket) {
    const _WS = window.WebSocket;

    function RTWebSocket(url, protocols) {
      const ws = protocols !== undefined ? new _WS(url, protocols) : new _WS(url);
      const urlStr = String(url);

      ws.addEventListener("open", () => emitWs("open", { wsUrl: urlStr }));
      ws.addEventListener("close", (e) => emitWs("close", {
        wsUrl: urlStr, code: e.code, reason: e.reason || "", wasClean: e.wasClean
      }));
      ws.addEventListener("error", () => emitWs("error", { wsUrl: urlStr }));

      return ws;
    }

    RTWebSocket.prototype = _WS.prototype;
    RTWebSocket.CONNECTING = 0;
    RTWebSocket.OPEN = 1;
    RTWebSocket.CLOSING = 2;
    RTWebSocket.CLOSED = 3;

    window.WebSocket = RTWebSocket;
  }

  // ── Location / navigation intercept ──────────────────────────────────
  try {
    const _reload = Location.prototype.reload;
    Location.prototype.reload = function () {
      emitJsNav("location.reload()", this.href);
      return _reload.apply(this, arguments);
    };

    const _replace = Location.prototype.replace;
    Location.prototype.replace = function (url) {
      emitJsNav("location.replace()", url);
      return _replace.call(this, url);
    };

    const _assign = Location.prototype.assign;
    Location.prototype.assign = function (url) {
      emitJsNav("location.assign()", url);
      return _assign.call(this, url);
    };

    const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, "href");
    if (hrefDesc && hrefDesc.set) {
      Object.defineProperty(Location.prototype, "href", {
        get: hrefDesc.get,
        set(url) {
          emitJsNav("location.href=", url);
          hrefDesc.set.call(this, url);
        },
        configurable: true,
        enumerable: hrefDesc.enumerable
      });
    }
  } catch (_) {}

})();
