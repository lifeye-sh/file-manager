const express = require('express');
const path = require('path');
const net = require('net');
const configModule = require('./config/index.js');
const { createDefaultAdmin, loadUsers } = require('./services/user-service');

const securityHeaders = require('./middleware/security-headers');
const { csrfMiddleware, createCsrfSetter } = require('./middleware/csrf');
const { authMiddleware } = require('./middleware/auth');
const { createWhitelistMiddleware } = require('./middleware/whitelist');

const authRouter = require('./routes/auth');
const authAdminRouter = require('./routes/auth-admin');
const configApiRouter = require('./routes/config-api');
const browseRouter = require('./routes/browse-router');
const thumbRouter = require('./routes/thumb');
const fileOpsRouter = require('./routes/file-ops');

// Parse CLI arguments
const args = {};
process.argv.slice(2).forEach((arg) => {
  if (arg.startsWith('--')) {
    const [key, val] = arg.slice(2).split('=');
    args[key] = val || true;
  }
});

const savedConfig = configModule.initial;

function validateWhitelist(entries) {
  if (!Array.isArray(entries)) return 'whitelist must be an array';
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim() === '') return 'whitelist entries must be non-empty strings';
    const trimmed = entry.trim();
    if (trimmed.includes('/')) {
      const [ip, bits] = trimmed.split('/');
      if (!net.isIPv4(ip) && !net.isIPv6(ip)) return `Invalid IP in CIDR: ${trimmed}`;
      const n = parseInt(bits, 10);
      if (isNaN(n) || n < 0 || n > 128) return `Invalid CIDR prefix: ${trimmed}`;
    } else if (!net.isIPv4(trimmed) && !net.isIPv6(trimmed)) {
      return `Invalid IP address: ${trimmed}`;
    }
  }
  return null;
}

// Mutable runtime configuration
const config = {
  rootDir: path.resolve(args.root || savedConfig.root || process.cwd()),
  port: parseInt(args.port || savedConfig.port || '3000', 10),
  bindAddrs: configModule.normalizeBind(args.bind || savedConfig.bind),
  whitelist: savedConfig.whitelist || [],
  cookieSecure: savedConfig.cookieSecure !== false,
  trustedProxies: savedConfig.trustedProxies || ['loopback', '127.0.0.1'],

  validateWhitelist,
  saveConfig(updates) {
    configModule.saveConfig({
      root: config.rootDir,
      port: config.port,
      bind: config.bindAddrs,
      whitelist: config.whitelist,
      ...updates,
    });
  },
};

const secure = config.cookieSecure;
const app = express();

// Trust proxies so req.ip reflects the real client IP behind frp/nginx
app.set('trust proxy', config.trustedProxies);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use(securityHeaders);
app.use(csrfMiddleware);
app.use(authMiddleware);
app.use(createWhitelistMiddleware(config));

// Static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Public CSRF token endpoint (called by login page and app on load)
const setCsrfCookie = createCsrfSetter(secure);
app.get('/api/csrf-token', (req, res) => {
  const token = setCsrfCookie(res);
  res.json({ token });
});

// API route modules
app.use('/api/auth', authRouter(secure));
app.use('/api/auth', authAdminRouter);
app.use('/api/config', configApiRouter({ config }));
app.use('/api', browseRouter({ config }));
app.use('/api', thumbRouter({ config }));
app.use('/api', fileOpsRouter({ config }));

// Initialize users and start server
(async function startServer() {
  if (loadUsers().length === 0) {
    await createDefaultAdmin();
  }

  config.bindAddrs.forEach(addr => {
    app.listen(config.port, addr, () => {
      const label = addr === '0.0.0.0' ? 'localhost' : addr;
      console.log(`Listening on http://${label}:${config.port}`);
    });
  });

  console.log(`Serving files from: ${config.rootDir}`);
  console.log('Authentication: enabled');
  console.log(`Cookie Secure flag: ${secure}`);
  if (config.whitelist.length > 0) {
    console.log(`Whitelist: ${config.whitelist.join(', ')}`);
  } else {
    console.log('Whitelist: (allow all)');
  }
})();
