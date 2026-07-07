const { parseCookies } = require('../utils/cookies');
const { validateSession } = require('../services/user-service');

function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: '请先登录', code: 'UNAUTHORIZED' });
    }
    return res.redirect('/login.html');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: '需要管理员权限', code: 'FORBIDDEN' });
  }
  next();
}

function authMiddleware(req, res, next) {
  const pathname = req.path;

  // Public paths that do not require a session
  const publicPaths = new Set([
    '/login.html',
    '/api/csrf-token',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/session',
  ]);
  if (publicPaths.has(pathname)) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.auth_token;
  const session = validateSession(token);

  if (session) {
    req.user = session;
    return next();
  }

  if (pathname.startsWith('/api/')) {
    return res.status(401).json({ error: '请先登录', code: 'UNAUTHORIZED' });
  }

  return res.redirect('/login.html');
}

module.exports = { authMiddleware, requireAuth, requireAdmin };
