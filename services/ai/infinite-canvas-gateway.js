'use strict';

const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');
const { parseCookies } = require('../../utils/cookies');
const { validateSession } = require('../user-service');
const { normalizeSidecarUrl } = require('./infinite-canvas-client');

const PREFIX = '/api/ai/canvas/upstream';
const WS_PREFIX = '/api/ai/canvas/ws';
const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 100 * 1024 * 1024;
const TEXT_TYPES = /(?:text\/|javascript|json|xml|svg)/i;
const SAFE_API_PREFIXES = [
  '/api/app-info', '/api/queue_status', '/api/view', '/api/download-output',
  '/api/media-preview', '/api/image-jpeg', '/api/upload', '/api/ai/upload',
  '/api/ai/upload-base64', '/api/comfyui/upload-base64', '/api/local-assets',
  '/api/asset-library', '/api/prompt-libraries', '/api/smart-canvas',
  '/api/conversations', '/api/canvases', '/api/projects', '/api/canvas-assets',
  '/api/canvas-workflows', '/api/image-params', '/api/models', '/api/config',
  '/api/comfyui/instances', '/api/workflows',
];
const EXECUTION_PREFIXES = [
  '/api/canvas-image-tasks', '/api/canvas-comfy-tasks', '/api/canvas-video',
  '/api/canvas-llm', '/api/online-image', '/api/image-task-query',
];
const DENIED_PREFIXES = [
  '/api/update-', '/api/check-update', '/api/providers', '/api/config/token',
  '/api/storage-', '/api/codex', '/api/gemini', '/api/jimeng',
  '/api/runninghub', '/api/temp-sh', '/api/cloud-video',
];

function rewriteText(text) {
  return text
    .replace(/(["'`])\/api\//g, `$1${PREFIX}/api/`)
    .replace(/(["'`])\/static\//g, `$1${PREFIX}/static/`)
    .replace(/(["'`])\/assets\//g, `$1${PREFIX}/assets/`)
    .replace(/(["'`])\/output\//g, `$1${PREFIX}/output/`)
    .replace(/\/ws\//g, `${WS_PREFIX}/`)
    .replace(/<head([^>]*)>/i, '<head$1><script src="/infinite-canvas-bridge.js"></script>');
}

function upstreamConfig(config) {
  const value = config.aiWorkbench && config.aiWorkbench.infiniteCanvas || {};
  return {
    baseUrl: normalizeSidecarUrl(value.upstreamBaseUrl || 'http://127.0.0.1:7863'),
    enabled: Boolean(value.enabled),
    allowExecution: Boolean(value.allowExecution),
  };
}

function isAllowed(method, pathname, config) {
  if (pathname === '/api/providers') return method === 'GET';
  if (DENIED_PREFIXES.some(prefix => pathname.startsWith(prefix))) return false;
  if (pathname === '/' || pathname.startsWith('/static/') || pathname.startsWith('/assets/')
      || pathname.startsWith('/output/')) return method === 'GET' || method === 'HEAD';
  if (EXECUTION_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return false;
  }
  return SAFE_API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function buildBody(req) {
  if (req.body === undefined || req.body === null || !Object.keys(req.body || {}).length) return null;
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) return Buffer.from(JSON.stringify(req.body));
  if (type.includes('application/x-www-form-urlencoded')) {
    return Buffer.from(new URLSearchParams(req.body).toString());
  }
  return null;
}

function createCanvasProxy({ config }) {
  return function canvasProxy(req, res) {
    const runtime = upstreamConfig(config);
    if (!runtime.enabled) return res.status(409).json({ error: 'Infinite-Canvas 未启用', code: 'INFINITE_CANVAS_DISABLED' });
    const suffix = req.originalUrl.slice(req.originalUrl.indexOf(PREFIX) + PREFIX.length) || '/';
    const parsedSuffix = new URL(suffix, 'http://gateway.invalid');
    if (req.method === 'GET' && ['/api/check-update', '/api/update-connectivity', '/api/update-connectivity/probe'].includes(parsedSuffix.pathname)) {
      return res.json({
        ok: true,
        update_available: false,
        gateway_managed: true,
        message: '版本由 File Manager 固定清单管理',
      });
    }
    if (req.method === 'GET' && parsedSuffix.pathname === '/api/shared-folders') {
      return res.json({ folders: [], gateway_managed: true });
    }
    if (!isAllowed(req.method, parsedSuffix.pathname, runtime)) {
      return res.status(403).json({ error: 'Infinite-Canvas 接口未获网关授权', code: 'CANVAS_ENDPOINT_DENIED' });
    }
    const target = new URL(runtime.baseUrl);
    const body = buildBody(req);
    if (body && body.length > MAX_REQUEST_BYTES) {
      return res.status(413).json({ error: 'Infinite-Canvas 请求过大', code: 'CANVAS_REQUEST_TOO_LARGE' });
    }
    const headers = {
      accept: req.headers.accept || '*/*',
      'accept-language': req.headers['accept-language'] || 'zh-CN',
      'content-type': req.headers['content-type'] || undefined,
      'content-length': body ? String(body.length) : req.headers['content-length'],
      'x-file-manager-gateway-token': process.env.INFINITE_CANVAS_GATEWAY_TOKEN || '',
    };
    for (const key of Object.keys(headers)) if (headers[key] === undefined) delete headers[key];
    const proxyReq = http.request({
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: `${parsedSuffix.pathname}${parsedSuffix.search}`,
      headers,
      timeout: Math.min(120000, Number(config.aiWorkbench && config.aiWorkbench.execTimeoutMs) || 600000),
    }, upstreamRes => {
      const contentType = String(upstreamRes.headers['content-type'] || 'application/octet-stream');
      res.status(upstreamRes.statusCode || 502);
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', contentType.includes('text/html') ? 'no-store' : (upstreamRes.headers['cache-control'] || 'no-cache'));
      if (upstreamRes.headers['content-disposition']) res.setHeader('Content-Disposition', upstreamRes.headers['content-disposition']);
      if (!TEXT_TYPES.test(contentType)) {
        let total = 0;
        upstreamRes.on('data', chunk => {
          total += chunk.length;
          if (total > MAX_RESPONSE_BYTES) proxyReq.destroy(new Error('Canvas response too large'));
        });
        upstreamRes.pipe(res);
        return;
      }
      const chunks = [];
      let total = 0;
      upstreamRes.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_RESPONSE_BYTES) {
          upstreamRes.destroy(new Error('Canvas response too large'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      upstreamRes.on('end', () => res.send(rewriteText(Buffer.concat(chunks).toString('utf8'))));
    });
    proxyReq.on('timeout', () => proxyReq.destroy(new Error('Canvas upstream timeout')));
    proxyReq.on('error', err => {
      if (!res.headersSent) res.status(502).json({ error: 'Infinite-Canvas 上游不可用', code: 'CANVAS_UPSTREAM_UNAVAILABLE' });
      else res.destroy(err);
    });
    if (body) proxyReq.end(body);
    else if (['GET', 'HEAD'].includes(req.method)) proxyReq.end();
    else {
      let total = 0;
      req.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_REQUEST_BYTES) proxyReq.destroy(new Error('Canvas request too large'));
      });
      req.pipe(proxyReq);
    }
  };
}

function attachCanvasWebSocketProxy(server, { config }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://gateway.invalid');
    if (!url.pathname.startsWith(`${WS_PREFIX}/`)) return;
    const session = validateSession(parseCookies(req.headers.cookie).auth_token);
    const origin = req.headers.origin;
    const expectedOrigin = `http://${req.headers.host}`;
    if (!session || (origin && origin !== expectedOrigin && origin !== expectedOrigin.replace('http:', 'https:'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const runtime = upstreamConfig(config);
    if (!runtime.enabled) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, browserWs => {
      const target = new URL(runtime.baseUrl);
      const upstreamPath = url.pathname.slice(WS_PREFIX.length) + url.search;
      const upstreamWs = new WebSocket(`ws://${target.host}${upstreamPath}`, {
        headers: { 'X-File-Manager-Gateway-Token': process.env.INFINITE_CANVAS_GATEWAY_TOKEN || '' },
        maxPayload: 1024 * 1024,
      });
      browserWs.on('message', data => { if (upstreamWs.readyState === WebSocket.OPEN) upstreamWs.send(data); });
      upstreamWs.on('message', data => { if (browserWs.readyState === WebSocket.OPEN) browserWs.send(data); });
      const closeBoth = () => {
        if (browserWs.readyState < WebSocket.CLOSING) browserWs.close();
        if (upstreamWs.readyState < WebSocket.CLOSING) upstreamWs.close();
      };
      browserWs.on('close', closeBoth);
      browserWs.on('error', closeBoth);
      upstreamWs.on('close', closeBoth);
      upstreamWs.on('error', closeBoth);
    });
  });
}

module.exports = {
  PREFIX,
  WS_PREFIX,
  rewriteText,
  isAllowed,
  createCanvasProxy,
  attachCanvasWebSocketProxy,
};
