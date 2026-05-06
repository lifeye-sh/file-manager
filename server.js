const http = require('http');
const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');

// Parse CLI args
const args = {};
process.argv.slice(2).forEach((arg) => {
  if (arg.startsWith('--')) {
    const [key, val] = arg.slice(2).split('=');
    args[key] = val || true;
  }
});

// --- Load modules ---
const config = require('./lib/config');
const { setRoot } = require('./lib/safePath');
const { setWhitelist } = require('./lib/whitelist');
const { registerRoutes } = require('./routes/api');
const watcher = require('./lib/watcher');

// --- Init config ---
const savedConfig = config.loadConfig();
config.root = path.resolve(args.root || savedConfig.root || process.cwd());
config.port = parseInt(args.port || savedConfig.port || '3000', 10);
config.bind = config.normalizeBind(args.bind || savedConfig.bind);
config.whitelist = savedConfig.whitelist || [];

// Propagate state to dependent modules
setRoot(config.root);
setWhitelist(config.whitelist);

// --- App setup ---
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Register all API routes
registerRoutes(app);

// --- HTTP server ---
const server = http.createServer(app);

// --- WebSocket ---
const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress || '127.0.0.1';
  console.log(`[ws] client connected: ${clientIP}`);

  ws.on('close', () => {
    console.log(`[ws] client disconnected: ${clientIP}`);
  });
});

// Broadcast directory changes to all connected clients
watcher.onChange((dirPath) => {
  const relPath = path.relative(config.root, dirPath).replace(/\\/g, '/');
  const payload = JSON.stringify({ type: 'change', path: relPath });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
});

// --- Start ---
config.bind.forEach(addr => {
  server.listen(config.port, addr, () => {
    const label = addr === '0.0.0.0' ? 'localhost' : addr;
    console.log(`Listening on http://${label}:${config.port}`);
    console.log(`WebSocket on ws://${label}:${config.port}`);
  });
});
console.log(`Serving files from: ${config.root}`);
console.log(`Watching directory for changes...`);
if (config.whitelist.length > 0) {
  console.log(`Whitelist: ${config.whitelist.join(', ')}`);
} else {
  console.log('Whitelist: (allow all)');
}
watcher.start(config.root);
