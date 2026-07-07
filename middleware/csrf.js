const crypto = require('crypto');
const { parseCookies } = require('../utils/cookies');
const { SESSION_MAX_AGE } = require('../services/user-service');

function createCsrfSetter(secure) {
  return function setCsrfCookie(res) {
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const parts = [
      'csrf_token=' + csrfToken,
      'Path=/', 'SameSite=Strict',
      'Max-Age=' + (SESSION_MAX_AGE / 1000),
    ];
    if (secure) parts.push('Secure');
    res.appendHeader('Set-Cookie', parts.join('; '));
    return csrfToken;
  };
}

function csrfMiddleware(req, res, next) {
  // Safe methods do not require CSRF validation
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Login/logout endpoints manage their own tokens
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
