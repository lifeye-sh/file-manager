const express = require('express');
const router = express.Router();
const {
  hashPassword,
  verifyPassword,
  loadUsers,
  saveUsers,
  createSession,
  validateSession,
  destroySession,
  SESSION_MAX_AGE,
} = require('../services/user-service');
const { parseCookies } = require('../utils/cookies');

// Import login rate-limiting helpers from shared middleware/rate-limit module (defined inline here for now)
const loginAttempts = new Map();

function checkLoginRateLimit(clientIP, username) {
  const key = `${clientIP}:${username.toLowerCase()}`;
  const record = loginAttempts.get(key);
  if (!record) return { blocked: false };

  if (Date.now() - record.firstAttempt > 15 * 60 * 1000) {
    loginAttempts.delete(key);
    return { blocked: false };
  }

  if (record.lockUntil && record.lockUntil > Date.now()) {
    return { blocked: true, retryAfter: Math.ceil((record.lockUntil - Date.now()) / 1000) };
  }
  if (record.lockUntil && record.lockUntil <= Date.now()) {
    loginAttempts.delete(key);
    return { blocked: false };
  }
  return { blocked: false };
}

function recordLoginAttempt(clientIP, username) {
  const key = `${clientIP}:${username.toLowerCase()}`;
  const record = loginAttempts.get(key) || { count: 0, firstAttempt: Date.now() };
  record.count++;
  if (record.count >= 5) {
    record.lockUntil = Date.now() + 300000;
  }
  loginAttempts.set(key, record);
}

function clearLoginAttempts(clientIP, username) {
  loginAttempts.delete(`${clientIP}:${username.toLowerCase()}`);
}

setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, record] of loginAttempts) {
    if (record.firstAttempt < cutoff) loginAttempts.delete(key);
  }
}, 10 * 60 * 1000);

function _isReqSecure(secure, req) {
  // HTTPS directly, or behind a reverse proxy that sets x-forwarded-proto
  if (secure) return true;
  if (req && req.secure) return true;
  if (req && req.headers && req.headers['x-forwarded-proto'] === 'https') return true;
  return false;
}

function setAuthCookie(res, token, secure, req) {
  const isSecure = _isReqSecure(secure, req);
  const parts = [
    'auth_token=' + token,
    'Path=/', 'HttpOnly',
    isSecure ? 'SameSite=None' : 'SameSite=Lax',
    'Max-Age=' + (SESSION_MAX_AGE / 1000),
  ];
  if (isSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function setCsrfCookie(res, secure, req) {
  const csrfToken = require('crypto').randomBytes(32).toString('hex');
  const isSecure = _isReqSecure(secure, req);
  const parts = [
    'csrf_token=' + csrfToken,
    'Path=/',
    isSecure ? 'SameSite=None' : 'SameSite=Lax',
    'Max-Age=' + (SESSION_MAX_AGE / 1000),
  ];
  if (isSecure) parts.push('Secure');
  res.appendHeader('Set-Cookie', parts.join('; '));
  return csrfToken;
}

// Expose helper for other modules
function cookieHelpers(secure) {
  return {
    setAuthCookie: (res, token, req) => setAuthCookie(res, token, secure, req),
    setCsrfCookie: (res, req) => setCsrfCookie(res, secure, req),
  };
}

module.exports = function (secure) {
  const { setAuthCookie, setCsrfCookie } = cookieHelpers(secure);

  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const clientIP = req.ip || req.socket.remoteAddress || '127.0.0.1';

    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }

    const limit = checkLoginRateLimit(clientIP, username);
    if (limit.blocked) {
      return res.status(429).json({
        error: `尝试次数过多，请 ${limit.retryAfter} 秒后重试`,
        code: 'RATE_LIMITED',
        retryAfter: limit.retryAfter,
      });
    }

    const users = loadUsers();
    const user = users.find(u => u.username === username);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      recordLoginAttempt(clientIP, username);
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    clearLoginAttempts(clientIP, username);
    const token = createSession(user.username, user.isAdmin);
    if (!token) return res.status(500).json({ error: '无法创建登录会话' });
    setAuthCookie(res, token, secure, req);
    setCsrfCookie(res, secure, req);

    res.json({ success: true, username: user.username, isAdmin: user.isAdmin });
  });

  router.post('/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    destroySession(cookies.auth_token);
    const isSecure = _isReqSecure(secure, req);
    const clearAttrs = isSecure ? 'Path=/; SameSite=None; Secure; Max-Age=0' : 'Path=/; SameSite=Lax; Max-Age=0';
    res.setHeader('Set-Cookie', [
      'auth_token=; ' + clearAttrs + '; HttpOnly',
      'csrf_token=; ' + clearAttrs,
    ]);
    res.json({ success: true });
  });

  router.get('/session', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.auth_token;
    const session = validateSession(token);

    if (!session) {
      return res.status(401).json({ error: '未登录', code: 'UNAUTHORIZED' });
    }

    const users = loadUsers();
    const user = users.find(u => u.username === session.username);
    res.json({ username: session.username, isAdmin: user ? user.isAdmin : false });
  });

  return router;
};
