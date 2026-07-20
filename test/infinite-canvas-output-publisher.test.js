'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  collectOutputRefs,
  publishCanvasOutputs,
  validateMedia,
} = require('../services/ai/infinite-canvas-output-publisher');

test('output collector de-duplicates only project-owned relative media references', () => {
  assert.deepEqual(collectOutputRefs({
    images: ['/output/a.png', 'https://evil.test/a.png', '/output/a.png'],
    nested: { url: '/assets/b.webp' },
  }), ['/output/a.png', '/assets/b.webp']);
});

test('publisher validates media and atomically publishes versioned fileRefs', async t => {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'canvas-publish-'));
  t.after(() => fs.promises.rm(rootDir, { recursive: true, force: true }));
  const png = await sharp({
    create: { width: 2, height: 3, channels: 4, background: '#123456' },
  }).png().toBuffer();
  const client = {
    downloadCanvasOutput: async sourcePath => ({ buffer: png, contentType: 'image/png', sourcePath }),
  };
  const results = await publishCanvasOutputs({
    taskId: 'task_20260720_120000_abcdef',
    result: { images: ['/output/a.png'] },
    client,
    rootDir,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].width, 2);
  assert.equal(results[0].height, 3);
  assert.match(results[0].fileRef.version, /^\d+-\d+$/);
  assert.equal((await fs.promises.stat(path.join(rootDir, results[0].fileRef.path))).isFile(), true);
  assert.equal((await fs.promises.readdir(path.join(rootDir, 'AI-Canvas'))).some(name => name.includes('.staging-')), false);
});

test('publisher leaves no visible task directory when media validation fails', async t => {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'canvas-publish-bad-'));
  t.after(() => fs.promises.rm(rootDir, { recursive: true, force: true }));
  const client = {
    downloadCanvasOutput: async sourcePath => ({
      buffer: Buffer.from('not-a-png'),
      contentType: 'image/png',
      sourcePath,
    }),
  };
  await assert.rejects(() => publishCanvasOutputs({
    taskId: 'task_20260720_120000_badbad',
    result: { image: '/output/bad.png' },
    client,
    rootDir,
  }), { code: 'INVALID_CANVAS_OUTPUT_MEDIA' });
  assert.deepEqual(await fs.promises.readdir(path.join(rootDir, 'AI-Canvas')), []);
  await assert.rejects(() => validateMedia(Buffer.from('MZ'), 'application/x-msdownload'), {
    code: 'INVALID_CANVAS_OUTPUT_MEDIA',
  });
});
