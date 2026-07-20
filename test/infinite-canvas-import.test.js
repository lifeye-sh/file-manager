'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  createImportId,
  validateImportId,
  importAuthorizedImage,
} = require('../services/ai/infinite-canvas-import-service');

test('import service resolves a managed file, decodes it and forwards immutable bytes', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fm-ic-import-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'image.png');
  await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  }).png().toFile(file);

  let submitted;
  const result = await importAuthorizedImage({
    fileRef: { rootId: 'main', path: 'image.png' },
    roots: { main: root },
    client: {
      importImage: async request => {
        submitted = request;
        return {
          ok: true,
          importId: request.importId,
          size: request.buffer.length,
          sha256: crypto.createHash('sha256').update(request.buffer).digest('hex'),
        };
      },
    },
  });

  assert.equal(validateImportId(result.importId), true);
  assert.equal(result.mediaType, 'image/png');
  assert.equal(result.width, 3);
  assert.equal(result.height, 2);
  assert.equal(submitted.mediaType, 'image/png');
  assert.ok(Buffer.isBuffer(submitted.buffer));
  assert.equal(submitted.buffer.includes(Buffer.from(root)), false);
});

test('import service rejects traversal and extension/content mismatch before sidecar call', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fm-ic-import-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const pngBuffer = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  }).png().toBuffer();
  await fs.promises.writeFile(path.join(root, 'wrong.jpg'), pngBuffer);
  let calls = 0;
  const client = { importImage: async () => { calls += 1; } };

  await assert.rejects(
    () => importAuthorizedImage({
      fileRef: { rootId: 'main', path: '../outside.png' },
      roots: { main: root },
      client,
    }),
    { code: 'INVALID_FILE_REF' },
  );
  await assert.rejects(
    () => importAuthorizedImage({
      fileRef: { rootId: 'main', path: 'wrong.jpg' },
      roots: { main: root },
      client,
    }),
    { code: 'IMPORT_TYPE_MISMATCH' },
  );
  assert.equal(calls, 0);
});

test('opaque import identifiers have 128 bits of server-generated randomness', () => {
  const first = createImportId();
  const second = createImportId();
  assert.match(first, /^imp_[a-f0-9]{32}$/);
  assert.notEqual(first, second);
  assert.equal(validateImportId('C:\\host\\file.png'), false);
});
