// Retry-After is either delta-seconds ("47") or an HTTP-date (RFC 9110 §10.2.3).
// Returns the absolute epoch ms at which retrying is allowed, or null if absent/invalid.
function parseRetryAfter(value, now) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return now + Number(s) * 1000;
  // Date.parse accepts things like "-5" (year -5), so require the IMF-fixdate shape.
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// ChatGPT's client reads this header (seconds) next to Retry-After and blocks loading a
// conversation, including its own Retry button, until the later of the two.
const HISTORY_RETRY_HEADER = 'x-oai-history-initial-retry-after';

// When retrying is allowed according to both headers, or null if neither gives a time.
function cooldownUntil(retryAfter, historyRetryAfter, now) {
  const times = [parseRetryAfter(retryAfter, now)];
  if (historyRetryAfter != null && /^\d+$/.test(String(historyRetryAfter).trim())) times.push(now + Number(historyRetryAfter) * 1000);
  const known = times.filter(t => t != null);
  return known.length ? Math.max(...known) : null;
}

if (typeof module !== 'undefined') module.exports = { parseRetryAfter, cooldownUntil, HISTORY_RETRY_HEADER };
