const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const createFileOpsRouter = require('../routes/file-ops');

async function startFixture(t) {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-manager-routes-'));
  const rootDir = path.join(base, 'managed');
  const outsideDir = path.join(base, 'outside');
  await fs.promises.mkdir(rootDir);
  await fs.promises.mkdir(outsideDir);
  await fs.promises.writeFile(path.join(outsideDir, 'keep.txt'), 'keep');

  const app = express();
  app.use(express.json());
  app.use('/api', createFileOpsRouter({ config: { rootDir } }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(base, { recursive: true, force: true });
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/api`,
    rootDir,
    outsideDir,
  };
}

test('delete rejects the managed root and leaves it intact', async (t) => {
  const fixture = await startFixture(t);
  const response = await fetch(`${fixture.baseUrl}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '.' }),
  });
  assert.equal(response.status, 403);
  assert.equal((await fs.promises.stat(fixture.rootDir)).isDirectory(), true);
});

test('delete rejects a symlink or junction escape without changing the outside target', async (t) => {
  const fixture = await startFixture(t);
  const link = path.join(fixture.rootDir, 'escape');
  try {
    await fs.promises.symlink(
      fixture.outsideDir,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      t.skip(`link creation unavailable: ${err.code}`);
      return;
    }
    throw err;
  }

  const response = await fetch(`${fixture.baseUrl}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'escape' }),
  });
  assert.equal(response.status, 403);
  assert.equal(await fs.promises.readFile(path.join(fixture.outsideDir, 'keep.txt'), 'utf8'), 'keep');
});
