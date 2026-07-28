'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PREFIX,
  WS_PREFIX,
  rewriteText,
  isAllowed,
  upstreamWebSocketPath,
  webSocketPayload,
} = require('../services/ai/infinite-canvas-gateway');

test('canvas gateway rewrites upstream browser paths into the authenticated same-origin prefix', () => {
  const input = `
    <head></head>
    <script src="/static/js/canvas.js"></script>
    <img src="/assets/input/a.png">
    <script>
      fetch('/api/canvases');
      const ws = new WebSocket(\`ws://\${host}/ws/stats\`);
    </script>`;
  const output = rewriteText(input);
  assert.match(output, /infinite-canvas-bridge\.js/);
  assert.match(output, new RegExp(`${PREFIX}/static/js/canvas\\.js`));
  assert.match(output, new RegExp(`${PREFIX}/assets/input/a\\.png`));
  assert.match(output, new RegExp(`${PREFIX}/api/canvases`));
  assert.match(output, new RegExp(`${WS_PREFIX}/stats`));
});

test('canvas gateway rewrites unquoted CSS url() references that the quoted rules miss', () => {
  const input = `
    <style>
      .thumb { background-image: url(/output/42.png); }
      .asset { background: url(/assets/icons/m.png) no-repeat; }
      .api-bg { background-image: url('/api/view?filename=x.png'); }
    </style>`;
  const output = rewriteText(input);
  // unquoted forms are rewritten into the gateway prefix
  assert.match(output, new RegExp(`url\\(${PREFIX}/output/42\\.png\\)`));
  assert.match(output, new RegExp(`url\\(${PREFIX}/assets/icons/m\\.png\\)`));
  // quoted form still works and is not double-rewritten
  assert.match(output, new RegExp(`url\\('${PREFIX}/api/view\\?filename=x\\.png'\\)`));
  assert.doesNotMatch(output, new RegExp(`${PREFIX}${PREFIX}`));
});

test('canvas gateway denies upstream mutation and credential surfaces', () => {
  const enabled = { allowExecution: false };
  assert.equal(isAllowed('GET', '/', enabled), true);
  assert.equal(isAllowed('GET', '/api/history', enabled), true);
  assert.equal(isAllowed('POST', '/api/canvases', enabled), true);
  assert.equal(isAllowed('POST', '/api/update-from-github', enabled), false);
  assert.equal(isAllowed('GET', '/api/config/token', enabled), false);
  assert.equal(isAllowed('PUT', '/api/providers', enabled), false);
  assert.equal(isAllowed('POST', '/api/canvas-comfy-tasks', enabled), false);
  assert.equal(isAllowed('POST', '/api/canvas-comfy-tasks', { allowExecution: true }), false);
  assert.equal(isAllowed('POST', '/api/online-image', { allowExecution: true }), false);
  assert.equal(isAllowed('POST', '/api/image-task-query', { allowExecution: true }), false);
  assert.equal(isAllowed('GET', '/api/canvas-comfy-tasks/upstream-id', { allowExecution: true }), false);
});

test('canvas WebSocket proxy preserves /ws and rejects unknown channels', () => {
  assert.equal(
    upstreamWebSocketPath(`${WS_PREFIX}/stats`, '?client_id=browser-1'),
    '/ws/stats?client_id=browser-1'
  );
  assert.equal(upstreamWebSocketPath(`${WS_PREFIX}/unknown`, ''), null);
});

test('canvas WebSocket proxy preserves text frames instead of turning them into browser Blobs', () => {
  const text = webSocketPayload(Buffer.from('{"type":"stats"}'), false);
  assert.equal(text.data, '{"type":"stats"}');
  assert.deepEqual(text.options, { binary: false });
  const binaryData = Buffer.from([0, 1, 2]);
  const binary = webSocketPayload(binaryData, true);
  assert.equal(binary.data, binaryData);
  assert.deepEqual(binary.options, { binary: true });
});
