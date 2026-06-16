/**
 * Timestamped logging for long-running build pipelines.
 */
export function formatTimestamp(d = new Date()) {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const mrem = min % 60;
  return mrem ? `${hr}h ${mrem}m` : `${hr}h`;
}

export function formatEta(elapsedMs, done, total) {
  if (!done || !total || done >= total) return "done";
  const remaining = ((total - done) * elapsedMs) / done;
  return `~${formatDuration(remaining)} remaining`;
}

export function log(message, { level = "info" } = {}) {
  const tag = level === "warn" ? "WARN" : level === "error" ? "ERROR" : "INFO";
  console.log(`[${formatTimestamp()}] ${tag}  ${message}`);
}

export function logSection(title) {
  console.log("");
  log(`── ${title} ──`);
}

/** Emit at most one progress line per intervalMs. */
export function createProgressTicker({ intervalMs = 15000, onTick }) {
  let lastTick = 0;
  let timer = null;

  function maybeTick(force = false) {
    const now = Date.now();
    if (!force && now - lastTick < intervalMs) return;
    lastTick = now;
    const msg = onTick(now);
    if (msg) log(msg);
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => maybeTick(false), intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function finish(finalMsg) {
    stop();
    if (finalMsg) log(finalMsg);
  }

  return { bump: () => maybeTick(false), force: () => maybeTick(true), start, stop, finish };
}