// Runs in the page's main world — intercepts console output and JS errors
(function () {
  if (window.__RT_INJECTED__) return;
  window.__RT_INJECTED__ = true;

  const LEVELS = ["log", "warn", "error", "info", "debug"];
  const _orig = {};

  function serialize(val) {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (val instanceof Error) return val.stack || val.message;
    if (typeof val === "object") {
      try { return JSON.stringify(val, null, 0); } catch { return String(val); }
    }
    return String(val);
  }

  function emit(level, args) {
    try {
      window.postMessage({
        __RT__: true,
        level,
        args: Array.from(args).map(serialize),
        timestamp: new Date().toISOString()
      }, "*");
    } catch (_) {}
  }

  LEVELS.forEach(level => {
    _orig[level] = console[level].bind(console);
    console[level] = function (...args) {
      _orig[level](...args);
      emit(level, args);
    };
  });

  window.addEventListener("error", (e) => {
    const msg = e.message || "Unknown error";
    const loc = e.filename ? ` — ${e.filename}:${e.lineno}:${e.colno}` : "";
    emit("uncaught_error", [msg + loc]);
  });

  window.addEventListener("unhandledrejection", (e) => {
    emit("unhandled_rejection", [String(e.reason)]);
  });
})();
