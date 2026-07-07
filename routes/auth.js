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

function setAuthCookie(res, token, secure) {
  const parts = [
    'auth_token=' + token,
    'Path=/', 'HttpOnly', 'SameSite=Strict',
    'Max-Age=' + (SESSION_MAX_AGE / 1000),
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function setCsrfCookie(res, secure) {
  const csrfToken = require('crypto').randomBytes(32).toString('hex');
  const parts = [
    'csrf_token=' + csrfToken,
    'Path=/', 'SameSite=Strict',
    'Max-Age=' + (SESSION_MAX_AGE / 1000),
  ];
  if (secure) parts.push('Secure');
  res.appendHeader('Set-Cookie', parts.join('; '));
  return csrfToken;
}

// Expose helper for other modules
function cookieHelpers(secure) {
  return {
    setAuthCookie: (res, token) => setAuthCookie(res, token, secure),
    setCsrfCookie: (res) => setCsrfCookie(res, secure),
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
    setAuthCookie(res, token);
    setCsrfCookie(res);

    res.json({ success: true, username: user.username, isAdmin: user.isAdmin });
  });

  router.post('/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    destroySession(cookies.auth_token);
    const clearAttrs = 'Path=/; SameSite=Strict; Max-Age=0';
    const secureAttr = secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', [
      'auth_token=; ' + clearAttrs + '; HttpOnly' + secureAttr,
      'csrf_token=; ' + clearAttrs + secureAttr,
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
