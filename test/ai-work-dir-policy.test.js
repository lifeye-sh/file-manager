'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const {
  DEFAULT_AI_WORK_DIR,
  resolveWorkDir,
  assertSeparatedWorkDir,
} = require('../services/ai/work-dir-policy');

test('AI work directory defaults to private per-user runtime storage', () => {
  assert.equal(path.isAbsolute(DEFAULT_AI_WORK_DIR), true);
  assert.match(DEFAULT_AI_WORK_DIR, /FileManager|\.file-manager/i);
});

test('AI work directory policy rejects either direction of managed-root overlap', () => {
  const base = path.join(os.tmpdir(), 'file-manager-work-dir-policy');
  const managedRoot = path.join(base, 'managed');
  assert.throws(
    () => assertSeparatedWorkDir(path.join(managedRoot, 'ai'), managedRoot),
    { code: 'AI_WORK_DIR_OVERLAPS_MANAGED_ROOT' }
  );
  assert.throws(
    () => assertSeparatedWorkDir(base, managedRoot),
    { code: 'AI_WORK_DIR_OVERLAPS_MANAGED_ROOT' }
  );
  assert.equal(
    assertSeparatedWorkDir(path.join(base, 'runtime'), managedRoot),
    path.resolve(base, 'runtime')
  );
});

test('relative AI work directories resolve against the project, not the managed root', () => {
  const projectRoot = path.join(os.tmpdir(), 'file-manager-project');
  assert.equal(
    resolveWorkDir('runtime/ai', projectRoot),
    path.resolve(projectRoot, 'runtime/ai')
  );
});
