const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

const _rateLimitMap = new Map();

function rateLimit(ip, max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS) {
  const now = Date.now();
  let record = _rateLimitMap.get(ip);
  if (!record || now - record.since > windowMs) {
    _rateLimitMap.set(ip, { since: now, count: 1 });
    return true;
  }
  record.count++;
  if (record.count > max) return false;
  return true;
}

// Purge stale entries periodically
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [ip, r] of _rateLimitMap) {
    if (Date.now() - r.since > cutoff) _rateLimitMap.delete(ip);
  }
}, 300_000).unref();

module.exports = { rateLimit, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS };
