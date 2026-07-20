const express = require('express');
const compression = require('compression');
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
const aiWorkbenchRouter = require('./routes/ai-workbench');
const aiStorage = require('./services/ai/storage');
const aiTaskScheduler = require('./services/ai/task-scheduler');
const {
  PREFIX: canvasProxyPrefix,
  createCanvasProxy,
  attachCanvasWebSocketProxy,
} = require('./services/ai/infinite-canvas-gateway');

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
  cookieSecure: false,
  trustedProxies: savedConfig.trustedProxies || ['loopback', '127.0.0.1'],
  aiWorkbench: {
    enabled: true,
    comfyuiUrl: 'http://127.0.0.1:8188',
    connectTimeoutMs: 5000,
    execTimeoutMs: 600000,
    maxConcurrentTasks: 1,
    keepResultsDays: 30,
    ...savedConfig.aiWorkbench,
    infiniteCanvas: {
      enabled: false,
      baseUrl: 'http://127.0.0.1:7862',
      requestTimeoutMs: 5000,
      ...((savedConfig.aiWorkbench && savedConfig.aiWorkbench.infiniteCanvas) || {}),
    },
  },

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

app.use(compression());
app.use(securityHeaders);
app.use(csrfMiddleware);
app.use(authMiddleware);
app.use(createWhitelistMiddleware(config));

app.get('/ai-workbench.html', (_req, res) => res.redirect(`${canvasProxyPrefix}/`));
app.get('/ai-workbench-legacy.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ai-workbench.html'));
});

// Static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Public CSRF token endpoint
const setCsrfCookieFn = createCsrfSetter(secure);
app.get('/api/csrf-token', (req, res) => {
  const tok = setCsrfCookieFn(res, req);
  res.json({ token: tok });
});

// API route modules
app.use('/api/auth', authRouter(secure));
app.use('/api/auth', authAdminRouter);
app.use('/api/config', configApiRouter({ config }));
app.use('/api', browseRouter({ config }));
app.use('/api', thumbRouter({ config }));
app.use('/api', fileOpsRouter({ config }));
app.use('/api/ai', aiWorkbenchRouter({ config }));
app.use(canvasProxyPrefix, createCanvasProxy({ config }));

// Initialize users and start server
(async function startServer() {
  if (loadUsers().length === 0) {
    await createDefaultAdmin();
  }

  aiStorage.ensureDirs();
  aiTaskScheduler.initialize(() => ({
    rootDir: config.rootDir,
    fileRoots: { main: config.rootDir },
    maxConcurrentTasks: config.aiWorkbench.maxConcurrentTasks,
    infiniteCanvasBaseUrl: config.aiWorkbench.infiniteCanvas.upstreamBaseUrl,
  }));

  config.bindAddrs.forEach(addr => {
    const server = app.listen(config.port, addr, () => {
      const label = addr === '0.0.0.0' ? 'localhost' : addr;
      console.log(`Listening on http://${label}:${config.port}`);
    });
    attachCanvasWebSocketProxy(server, { config });
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

// Global error handler
app.use((err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  if (req.path.startsWith('/api/')) {
    res.status(500).json({ error: '服务器内部错误' });
  } else {
    res.status(500).send('Internal Server Error');
  }
});
