'use strict';

const crypto = require('crypto');
const upstream = require('../../integrations/infinite-canvas/upstream.json');

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['127.0.0.1', '[::1]']);
const IMPORT_ID_RE = /^imp_[a-f0-9]{32}$/;
const IMPORT_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const CANVAS_TASK_KINDS = new Set(['image', 'comfy', 'video', 'llm']);
const CANVAS_TASK_ID_RE = /^(?:canvas_img|canvas_comfy)_[a-f0-9]{32}$/;
const OUTPUT_PATH_PREFIXES = ['/output/', '/assets/', '/api/storage-files/output/'];

class InfiniteCanvasClientError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = 'InfiniteCanvasClientError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function normalizeSidecarUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch (err) {
    throw new InfiniteCanvasClientError('Infinite-Canvas sidecar URL 无效', 'INVALID_SIDECAR_URL', err);
  }
  if (parsed.protocol !== 'http:') {
    throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 仅允许 http 回环连接', 'INVALID_SIDECAR_SCHEME');
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 必须使用回环 IP', 'SIDECAR_NOT_LOOPBACK');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new InfiniteCanvasClientError('Infinite-Canvas sidecar URL 不得包含凭据、查询参数或片段', 'INVALID_SIDECAR_URL');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new InfiniteCanvasClientError('Infinite-Canvas sidecar URL 不得包含路径', 'INVALID_SIDECAR_URL');
  }
  return parsed.origin;
}

async function readBoundedBody(response, maxBytes) {
  const declared = Number.parseInt(response.headers.get('content-length') || '0', 10);
  if (declared > maxBytes) {
    throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 响应过大', 'SIDECAR_RESPONSE_TOO_LARGE');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body || []) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 响应过大', 'SIDECAR_RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function normalizeOutputPath(value) {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('\\')) return null;
  let parsed;
  try {
    parsed = new URL(value, 'http://canvas.invalid');
  } catch (_) {
    return null;
  }
  if (parsed.origin !== 'http://canvas.invalid' || parsed.username || parsed.password
      || parsed.hash || parsed.search) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(parsed.pathname);
  } catch (_) {
    return null;
  }
  if (decoded.includes('\0') || decoded.split('/').some(part => part === '..' || part === '.')) return null;
  return OUTPUT_PATH_PREFIXES.some(prefix => decoded.startsWith(prefix)) ? parsed.pathname : null;
}

class InfiniteCanvasClient {
  constructor(options = {}) {
    this.baseUrl = normalizeSidecarUrl(options.baseUrl || 'http://127.0.0.1:7862');
    this.timeoutMs = Math.max(250, Math.min(30 * 60 * 1000, Number.parseInt(options.timeoutMs, 10) || DEFAULT_TIMEOUT_MS));
    this.maxResponseBytes = Math.max(1024, Math.min(MAX_RESPONSE_BYTES, options.maxResponseBytes || MAX_RESPONSE_BYTES));
    this.fetchImpl = options.fetchImpl || fetch;
    this.gatewayToken = typeof options.gatewayToken === 'string' ? options.gatewayToken : '';
  }

  async health() {
    this._requireGatewayToken();
    const data = await this._requestJson('/health');
    if (!data || data.ok !== true) {
      throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 健康检查未通过', 'SIDECAR_UNHEALTHY');
    }
    if (data.contractVersion !== upstream.adapterContractVersion) {
      throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 契约版本不兼容', 'SIDECAR_CONTRACT_MISMATCH');
    }
    if (data.upstreamCommit !== upstream.pinnedCommit) {
      throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 上游提交与固定版本不一致', 'SIDECAR_REVISION_MISMATCH');
    }
    return {
      ok: true,
      contractVersion: data.contractVersion,
      upstreamCommit: data.upstreamCommit,
      version: typeof data.version === 'string' ? data.version.slice(0, 80) : null,
    };
  }

  async importImage({ importId, buffer, mediaType }) {
    this._requireGatewayToken();
    if (!IMPORT_ID_RE.test(importId || '')) {
      throw new InfiniteCanvasClientError('Infinite-Canvas importId 无效', 'INVALID_IMPORT_ID');
    }
    if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > MAX_IMPORT_BYTES) {
      throw new InfiniteCanvasClientError('Infinite-Canvas 导入文件大小无效', 'INVALID_IMPORT_SIZE');
    }
    if (!IMPORT_MEDIA_TYPES.has(mediaType)) {
      throw new InfiniteCanvasClientError('Infinite-Canvas 导入媒体类型不受支持', 'UNSUPPORTED_IMPORT_TYPE');
    }
    const data = await this._requestJson(`/v1/imports/${importId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': mediaType,
        'Content-Length': String(buffer.length),
      },
      body: buffer,
    });
    const expectedSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (!data || data.ok !== true || data.importId !== importId || data.size !== buffer.length
      || data.sha256 !== expectedSha256) {
      throw new InfiniteCanvasClientError('Infinite-Canvas 导入响应无效', 'SIDECAR_INVALID_IMPORT_RESPONSE');
    }
    return data;
  }

  async deleteImport(importId) {
    this._requireGatewayToken();
    if (!IMPORT_ID_RE.test(importId || '')) {
      throw new InfiniteCanvasClientError('Infinite-Canvas importId 无效', 'INVALID_IMPORT_ID');
    }
    const data = await this._requestJson(`/v1/imports/${importId}`, { method: 'DELETE' });
    if (!data || data.ok !== true || data.importId !== importId || data.deleted !== true) {
      throw new InfiniteCanvasClientError('Infinite-Canvas 删除导入响应无效', 'SIDECAR_INVALID_IMPORT_RESPONSE');
    }
    return data;
  }

  async submitCanvasTask(kind, payload) {
    this._requireGatewayToken();
    if (!CANVAS_TASK_KINDS.has(kind)) {
      throw new InfiniteCanvasClientError('Infinite-Canvas 任务类型无效', 'INVALID_CANVAS_TASK_KIND');
    }
    const endpoint = {
      image: '/api/canvas-image-tasks',
      comfy: '/api/canvas-comfy-tasks',
      video: '/api/canvas-video',
      llm: '/api/canvas-llm',
    }[kind];
    const data = await this._requestJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload || {})),
    });
    if ((kind === 'image' || kind === 'comfy')
      && (!data || !CANVAS_TASK_ID_RE.test(data.task_id || '') || data.status !== 'queued')) {
      throw new InfiniteCanvasClientError('Infinite-Canvas 任务提交响应无效', 'SIDECAR_INVALID_TASK_RESPONSE');
    }
    return data;
  }

  async getCanvasTask(kind, taskId) {
    this._requireGatewayToken();
    if (!['image', 'comfy'].includes(kind) || !CANVAS_TASK_ID_RE.test(taskId || '')) {
      throw new InfiniteCanvasClientError('Infinite-Canvas 任务标识无效', 'INVALID_CANVAS_TASK_ID');
    }
    const endpoint = kind === 'image'
      ? `/api/canvas-image-tasks/${taskId}`
      : `/api/canvas-comfy-tasks/${taskId}`;
    const data = await this._requestJson(endpoint);
    if (!data || data.id !== taskId || typeof data.status !== 'string') {
      throw new InfiniteCanvasClientError('Infinite-Canvas 任务状态响应无效', 'SIDECAR_INVALID_TASK_RESPONSE');
    }
    return data;
  }

  async downloadCanvasOutput(outputPath, maxBytes = MAX_OUTPUT_BYTES) {
    this._requireGatewayToken();
    const pathname = normalizeOutputPath(outputPath);
    if (!pathname) {
      throw new InfiniteCanvasClientError('Infinite-Canvas 输出引用无效', 'INVALID_CANVAS_OUTPUT_REF');
    }
    const limit = Math.max(1024, Math.min(MAX_OUTPUT_BYTES, Number(maxBytes) || MAX_OUTPUT_BYTES));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method: 'GET',
        headers: {
          Accept: 'image/*,video/*,application/octet-stream',
          'X-File-Manager-Gateway-Token': this.gatewayToken,
        },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new InfiniteCanvasClientError('Infinite-Canvas 输出不允许重定向', 'SIDECAR_REDIRECT_REJECTED');
      }
      if (!response.ok) {
        const error = new InfiniteCanvasClientError(`Infinite-Canvas 输出返回 HTTP ${response.status}`, 'SIDECAR_HTTP_ERROR');
        error.status = response.status;
        throw error;
      }
      const declared = Number.parseInt(response.headers.get('content-length') || '0', 10);
      if (declared > limit) {
        throw new InfiniteCanvasClientError('Infinite-Canvas 输出过大', 'CANVAS_OUTPUT_TOO_LARGE');
      }
      const chunks = [];
      let total = 0;
      for await (const chunk of response.body || []) {
        total += chunk.length;
        if (total > limit) {
          throw new InfiniteCanvasClientError('Infinite-Canvas 输出过大', 'CANVAS_OUTPUT_TOO_LARGE');
        }
        chunks.push(Buffer.from(chunk));
      }
      if (!total) throw new InfiniteCanvasClientError('Infinite-Canvas 输出为空', 'CANVAS_OUTPUT_EMPTY');
      return {
        buffer: Buffer.concat(chunks),
        contentType: String(response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase(),
        sourcePath: pathname,
      };
    } catch (err) {
      if (err instanceof InfiniteCanvasClientError) throw err;
      if (err.name === 'AbortError') {
        throw new InfiniteCanvasClientError('Infinite-Canvas 输出下载超时', 'SIDECAR_TIMEOUT', err);
      }
      throw new InfiniteCanvasClientError('Infinite-Canvas 输出不可用', 'SIDECAR_UNREACHABLE', err);
    } finally {
      clearTimeout(timer);
    }
  }

  async uploadCanvasImage({ buffer, mediaType, name }) {
    this._requireGatewayToken();
    if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > MAX_IMPORT_BYTES
        || !IMPORT_MEDIA_TYPES.has(mediaType)) {
      throw new InfiniteCanvasClientError('Infinite-Canvas 画布上传无效', 'INVALID_IMPORT_IMAGE');
    }
    const safeName = typeof name === 'string'
      ? name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120)
      : 'managed-image';
    const data = await this._requestJson('/api/ai/upload-base64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({
        data: buffer.toString('base64'),
        name: safeName,
        content_type: mediaType,
      })),
    });
    const file = data && Array.isArray(data.files) ? data.files[0] : null;
    if (!file || typeof file.url !== 'string'
        || !(file.url.startsWith('/assets/') || file.url.startsWith('/output/'))) {
      throw new InfiniteCanvasClientError('Infinite-Canvas 画布上传响应无效', 'SIDECAR_INVALID_IMPORT_RESPONSE');
    }
    return { url: file.url, name: String(file.name || safeName).slice(0, 160), kind: 'image' };
  }

  _requireGatewayToken() {
    if (this.gatewayToken.length < 32) {
      throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 网关令牌未配置', 'SIDECAR_GATEWAY_TOKEN_MISSING');
    }
  }

  async _requestJson(endpoint, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.headers || {}),
          'X-File-Manager-Gateway-Token': this.gatewayToken,
        },
        body: options.body,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 不允许重定向', 'SIDECAR_REDIRECT_REJECTED');
      }
      const text = await readBoundedBody(response, this.maxResponseBytes);
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 返回了无效 JSON', 'SIDECAR_INVALID_JSON', err);
      }
      if (!response.ok) {
        const error = new InfiniteCanvasClientError(`Infinite-Canvas sidecar 返回 HTTP ${response.status}`, 'SIDECAR_HTTP_ERROR');
        error.status = response.status;
        error.sidecarCode = data && typeof data.code === 'string' ? data.code : null;
        throw error;
      }
      return data;
    } catch (err) {
      if (err instanceof InfiniteCanvasClientError) throw err;
      if (err.name === 'AbortError') {
        throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 请求超时', 'SIDECAR_TIMEOUT', err);
      }
      throw new InfiniteCanvasClientError('Infinite-Canvas sidecar 不可达', 'SIDECAR_UNREACHABLE', err);
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  InfiniteCanvasClient,
  InfiniteCanvasClientError,
  normalizeSidecarUrl,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_IMPORT_BYTES,
  MAX_OUTPUT_BYTES,
  IMPORT_ID_RE,
  IMPORT_MEDIA_TYPES,
  CANVAS_TASK_KINDS,
  CANVAS_TASK_ID_RE,
  normalizeOutputPath,
  upstream,
};
