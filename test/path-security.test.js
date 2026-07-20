const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeRelativePath,
  resolveExistingPath,
  resolveNewPath,
  sanitizeName,
} = require('../utils/path-utils');
const { normalizeFileRef, resolveFileRef, fileVersion } = require('../services/file-ref-service');
const { isValidAiId } = require('../utils/identifiers');
const { snapshotWorkflowInputs } = require('../services/ai/workflow-inputs');

async function fixture(t) {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-manager-security-'));
  const root = path.join(base, 'managed');
  const outside = path.join(base, 'outside');
  await fs.promises.mkdir(path.join(root, 'nested'), { recursive: true });
  await fs.promises.mkdir(outside, { recursive: true });
  await fs.promises.writeFile(path.join(root, 'nested', 'inside.txt'), 'inside');
  await fs.promises.writeFile(path.join(outside, 'secret.txt'), 'outside');
  t.after(() => fs.promises.rm(base, { recursive: true, force: true }));
  return { root, outside };
}

test('relative path normalization rejects traversal and absolute path forms', () => {
  assert.equal(normalizeRelativePath('nested/inside.txt'), 'nested/inside.txt');
  for (const value of [
    '../secret.txt',
    '%2e%2e/secret.txt',
    '%252e%252e%252fsecret.txt',
    'C:\\Windows\\win.ini',
    'C:Windows\\win.ini',
    '\\\\server\\share\\file',
    '/etc/passwd',
    'bad\0name',
  ]) {
    assert.equal(normalizeRelativePath(value, { allowEmpty: false }), null, value);
  }
});

test('existing target resolution permits ordinary files and rejects the root when requested', async (t) => {
  const { root } = await fixture(t);
  assert.equal(
    await resolveExistingPath('nested/inside.txt', root, { allowRoot: false }),
    await fs.promises.realpath(path.join(root, 'nested', 'inside.txt')),
  );
  assert.equal(await resolveExistingPath('.', root, { allowRoot: false }), null);
  assert.equal(await resolveExistingPath('', root, { allowRoot: false }), null);
});

test('existing target resolution rejects a symlink or junction escape', async (t) => {
  const { root, outside } = await fixture(t);
  const link = path.join(root, 'escape');
  try {
    await fs.promises.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      t.skip(`link creation unavailable: ${err.code}`);
      return;
    }
    throw err;
  }
  assert.equal(await resolveExistingPath('escape/secret.txt', root, { allowRoot: false }), null);
});

test('new targets validate their real parent and strict basename', async (t) => {
  const { root } = await fixture(t);
  assert.equal(
    await resolveNewPath('nested', 'new.txt', root),
    path.join(await fs.promises.realpath(path.join(root, 'nested')), 'new.txt'),
  );
  for (const name of ['../x', 'CON', 'trailing.', ' spaced', 'bad:name']) {
    assert.equal(sanitizeName(name), null, name);
  }
});

test('file references resolve only known managed roots and enforce versions', async (t) => {
  const { root } = await fixture(t);
  const input = { rootId: 'main', path: 'nested/inside.txt' };
  const resolved = await resolveFileRef(input, { main: root });
  assert.equal(resolved.ref.version, fileVersion(resolved.stats));
  await assert.rejects(
    resolveFileRef({ ...input, version: 'stale' }, { main: root }),
    { code: 'FILE_REF_VERSION_CHANGED' },
  );
  await assert.rejects(resolveFileRef({ rootId: 'other', path: input.path }, { main: root }), {
    code: 'UNKNOWN_FILE_ROOT',
  });
  assert.equal(normalizeFileRef('C:\\Windows\\win.ini'), null);
  assert.equal(normalizeFileRef('../outside/secret.txt'), null);
});

test('workflow input snapshots replace legacy paths and freeze file versions', async (t) => {
  const { root } = await fixture(t);
  const workflow = {
    id: 'wf_20260718_abcdef',
    nodes: [{
      id: 'image1',
      type: 'image-input',
      data: { path: 'nested/inside.txt' },
    }],
    edges: [],
  };
  const snapshot = await snapshotWorkflowInputs(workflow, { main: root });
  assert.equal(snapshot.nodes[0].data.path, undefined);
  assert.equal(snapshot.nodes[0].data.fileRef.rootId, 'main');
  assert.match(snapshot.nodes[0].data.fileRef.version, /^\d+-\d+$/);
  await assert.rejects(
    snapshotWorkflowInputs({
      ...workflow,
      nodes: [{ ...workflow.nodes[0], data: { path: 'C:\\Windows\\win.ini' } }],
    }, { main: root }),
    { code: 'INVALID_FILE_REF' },
  );
});

test('AI identifiers cannot contain path syntax', () => {
  assert.equal(isValidAiId('wf_20260718_abcdef', 'wf'), true);
  assert.equal(isValidAiId('task_20260718_abcdef', 'wf'), false);
  for (const value of ['../history', 'task_../../x', 'wf_x', 'def_C:\\temp', 'wf_bad/name']) {
    assert.equal(isValidAiId(value), false, value);
  }
});
