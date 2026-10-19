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

if (typeof module !== 'undefined') module.exports = { parseRetryAfter };
