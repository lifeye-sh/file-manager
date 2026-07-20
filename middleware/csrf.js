const crypto = require('crypto');
const { parseCookies } = require('../utils/cookies');
const { SESSION_MAX_AGE } = require('../services/user-service');

function createCsrfSetter(secure) {
  return function setCsrfCookie(res, req) {
    const csrfToken = crypto.randomBytes(32).toString('hex');
    // HTTPS (direct or via reverse proxy) -> SameSite=None; Secure (cross-site friendly)
    // HTTP  -> SameSite=Lax (same-site only, no Secure needed)
    const isSecure = secure || (req && req.secure) || (req && req.headers && req.headers['x-forwarded-proto'] === 'https');
    const parts = [
      'csrf_token=' + csrfToken,
      'Path=/',
      isSecure ? 'SameSite=None' : 'SameSite=Lax',
      'Max-Age=' + (SESSION_MAX_AGE / 1000),
    ];
    if (isSecure) parts.push('Secure');
    res.appendHeader('Set-Cookie', parts.join('; '));
    return csrfToken;
  };
}

function csrfMiddleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/api/auth/login' || req.path === '/api/auth/logout') return next();

  const cookies = parseCookies(req.headers.cookie);
  const csrfCookie = cookies.csrf_token;
  const csrfHeader = req.headers['x-csrf-token'];

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return res.status(403).json({ error: 'CSRF validation failed' });
  }
  next();
}

module.exports = { createCsrfSetter, csrfMiddleware };
