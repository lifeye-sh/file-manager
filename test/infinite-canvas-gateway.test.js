'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PREFIX,
  WS_PREFIX,
  rewriteText,
  isAllowed,
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

test('canvas gateway denies upstream mutation and credential surfaces', () => {
  const enabled = { allowExecution: false };
  assert.equal(isAllowed('GET', '/', enabled), true);
  assert.equal(isAllowed('POST', '/api/canvases', enabled), true);
  assert.equal(isAllowed('POST', '/api/update-from-github', enabled), false);
  assert.equal(isAllowed('GET', '/api/config/token', enabled), false);
  assert.equal(isAllowed('PUT', '/api/providers', enabled), false);
  assert.equal(isAllowed('POST', '/api/canvas-comfy-tasks', enabled), false);
  assert.equal(isAllowed('POST', '/api/canvas-comfy-tasks', { allowExecution: true }), false);
});
