'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  InfiniteCanvasClient,
  normalizeSidecarUrl,
  normalizeOutputPath,
  upstream,
} = require('../services/ai/infinite-canvas-client');
const TEST_GATEWAY_TOKEN = 'test-gateway-token-at-least-32-characters';

test('sidecar URL policy permits literal loopback only', () => {
  assert.equal(normalizeSidecarUrl('http://127.0.0.1:7862'), 'http://127.0.0.1:7862');
  assert.throws(() => normalizeSidecarUrl('https://127.0.0.1:7862'), { code: 'INVALID_SIDECAR_SCHEME' });
  assert.throws(() => normalizeSidecarUrl('http://localhost:7862'), { code: 'SIDECAR_NOT_LOOPBACK' });
  assert.throws(() => normalizeSidecarUrl('http://192.168.1.20:7862'), { code: 'SIDECAR_NOT_LOOPBACK' });
  assert.throws(() => normalizeSidecarUrl('http://user:secret@127.0.0.1:7862'), { code: 'INVALID_SIDECAR_URL' });
  assert.throws(() => normalizeSidecarUrl('http://127.0.0.1:7862/admin'), { code: 'INVALID_SIDECAR_URL' });
});

test('canvas output references are restricted to safe upstream-relative media paths', () => {
  assert.equal(normalizeOutputPath('/output/generated/a.png'), '/output/generated/a.png');
  assert.equal(normalizeOutputPath('/assets/a.webp'), '/assets/a.webp');
  assert.equal(normalizeOutputPath('/api/storage-files/output/a.mp4'), '/api/storage-files/output/a.mp4');
  for (const unsafe of [
    'http://example.com/a.png', '//example.com/a.png', '/output/../secret',
    '/output/%2e%2e/secret', '/input/a.png', 'C:\\secret.png', '/output/a.png?token=x',
  ]) assert.equal(normalizeOutputPath(unsafe), null);
});

test('canvas output download rejects redirects, oversized bodies and unsafe paths', async () => {
  let calls = 0;
  const client = new InfiniteCanvasClient({
    baseUrl: 'http://127.0.0.1:7863',
    gatewayToken: TEST_GATEWAY_TOKEN,
    fetchImpl: async () => {
      calls += 1;
      return new Response('x'.repeat(2048), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '2048' },
      });
    },
  });
  await assert.rejects(() => client.downloadCanvasOutput('https://example.com/a.png'), { code: 'INVALID_CANVAS_OUTPUT_REF' });
  assert.equal(calls, 0);
  await assert.rejects(() => client.downloadCanvasOutput('/output/a.png', 1024), { code: 'CANVAS_OUTPUT_TOO_LARGE' });
});

test('health accepts only the pinned adapter contract and revision', async () => {
  let request;
  const client = new InfiniteCanvasClient({
    baseUrl: 'http://127.0.0.1:7862',
    gatewayToken: TEST_GATEWAY_TOKEN,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        ok: true,
        contractVersion: upstream.adapterContractVersion,
        upstreamCommit: upstream.pinnedCommit,
        version: 'test',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const health = await client.health();
  assert.equal(health.ok, true);
  assert.equal(request.url, 'http://127.0.0.1:7862/health');
  assert.equal(request.options.redirect, 'manual');
  assert.equal(request.options.headers.Accept, 'application/json');
  assert.equal(request.options.headers['X-File-Manager-Gateway-Token'], TEST_GATEWAY_TOKEN);
});

test('health rejects revision mismatch, redirects and oversized responses', async () => {
  const mismatch = new InfiniteCanvasClient({
    gatewayToken: TEST_GATEWAY_TOKEN,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      contractVersion: upstream.adapterContractVersion,
      upstreamCommit: 'wrong',
    }), { status: 200 }),
  });
  await assert.rejects(() => mismatch.health(), { code: 'SIDECAR_REVISION_MISMATCH' });

  const redirect = new InfiniteCanvasClient({
    gatewayToken: TEST_GATEWAY_TOKEN,
    fetchImpl: async () => new Response('', { status: 302, headers: { location: 'http://example.com' } }),
  });
  await assert.rejects(() => redirect.health(), { code: 'SIDECAR_REDIRECT_REJECTED' });

  const oversized = new InfiniteCanvasClient({
    gatewayToken: TEST_GATEWAY_TOKEN,
    maxResponseBytes: 1024,
    fetchImpl: async () => new Response('x'.repeat(2048), { status: 200 }),
  });
  await assert.rejects(() => oversized.health(), { code: 'SIDECAR_RESPONSE_TOO_LARGE' });
});

test('health refuses to make a request without a server-side gateway token', async () => {
  let called = false;
  const client = new InfiniteCanvasClient({
    fetchImpl: async () => {
      called = true;
      throw new Error('must not be called');
    },
  });
  await assert.rejects(() => client.health(), { code: 'SIDECAR_GATEWAY_TOKEN_MISSING' });
  assert.equal(called, false);
});

test('authorized image import sends only opaque id, bytes and media type', async () => {
  const importId = `imp_${'a'.repeat(32)}`;
  const buffer = Buffer.from('image-bytes');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  let request;
  const client = new InfiniteCanvasClient({
    gatewayToken: TEST_GATEWAY_TOKEN,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        ok: true,
        importId,
        size: buffer.length,
        sha256,
      }), { status: 200 });
    },
  });

  const result = await client.importImage({ importId, buffer, mediaType: 'image/png' });
  assert.equal(result.importId, importId);
  assert.equal(request.url, `http://127.0.0.1:7862/v1/imports/${importId}`);
  assert.equal(request.options.method, 'PUT');
  assert.equal(request.options.headers['Content-Type'], 'image/png');
  assert.equal(request.options.headers['Content-Length'], String(buffer.length));
  assert.equal(request.options.body, buffer);
});

test('image import rejects client-provided path-like IDs and invalid media before fetch', async () => {
  let calls = 0;
  const client = new InfiniteCanvasClient({
    gatewayToken: TEST_GATEWAY_TOKEN,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('must not run');
    },
  });
  await assert.rejects(
    () => client.importImage({ importId: '../image', buffer: Buffer.from('x'), mediaType: 'image/png' }),
    { code: 'INVALID_IMPORT_ID' },
  );
  await assert.rejects(
    () => client.importImage({ importId: `imp_${'a'.repeat(32)}`, buffer: Buffer.from('x'), mediaType: 'text/plain' }),
    { code: 'UNSUPPORTED_IMPORT_TYPE' },
  );
  assert.equal(calls, 0);
});

test('canvas execution client submits and polls only fixed task endpoints', async () => {
  const upstreamTaskId = `canvas_comfy_${'c'.repeat(32)}`;
  const requests = [];
  const client = new InfiniteCanvasClient({
    baseUrl: 'http://127.0.0.1:7863',
    gatewayToken: TEST_GATEWAY_TOKEN,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const body = options.method === 'POST'
        ? { task_id: upstreamTaskId, status: 'queued' }
        : { id: upstreamTaskId, status: 'running', result: null };
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });
  const submitted = await client.submitCanvasTask('comfy', { workflow_json: 'fixture.json' });
  const polled = await client.getCanvasTask('comfy', upstreamTaskId);
  assert.equal(submitted.task_id, upstreamTaskId);
  assert.equal(polled.status, 'running');
  assert.equal(requests[0].url, 'http://127.0.0.1:7863/api/canvas-comfy-tasks');
  assert.equal(requests[1].url, `http://127.0.0.1:7863/api/canvas-comfy-tasks/${upstreamTaskId}`);
  assert.equal(requests[0].options.headers['X-File-Manager-Gateway-Token'], TEST_GATEWAY_TOKEN);
  await assert.rejects(() => client.submitCanvasTask('../unsafe', {}), { code: 'INVALID_CANVAS_TASK_KIND' });
});

test('legacy image query is adapted through the fixed upstream endpoint', async () => {
  let request;
  const client = new InfiniteCanvasClient({
    baseUrl: 'http://127.0.0.1:7863',
    gatewayToken: TEST_GATEWAY_TOKEN,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ status: 'running', task_id: 'provider-task' }), { status: 200 });
    },
  });
  const result = await client.submitCanvasTask('image-query', { task_id: 'provider-task' });
  assert.equal(result.status, 'running');
  assert.equal(request.url, 'http://127.0.0.1:7863/api/image-task-query');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['X-File-Manager-Gateway-Token'], TEST_GATEWAY_TOKEN);
});
