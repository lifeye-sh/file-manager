const fs = require('fs');
const path = require('path');
const { normalizeRelativePath, resolveExistingPath } = require('../utils/path-utils');

const ROOT_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

function normalizeFileRef(input, { defaultRootId = 'main' } = {}) {
  const raw = typeof input === 'string' ? { rootId: defaultRootId, path: input } : input;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const rootId = raw.rootId === undefined ? defaultRootId : raw.rootId;
  if (typeof rootId !== 'string' || !ROOT_ID_RE.test(rootId)) return null;
  const relativePath = normalizeRelativePath(raw.path, { allowEmpty: false });
  if (!relativePath) return null;

  const ref = { rootId, path: relativePath };
  if (raw.version !== undefined && raw.version !== null && raw.version !== '') {
    if (typeof raw.version !== 'string' || raw.version.length > 160) return null;
    ref.version = raw.version;
  }
  return ref;
}

function fileVersion(stats) {
  return `${Math.trunc(stats.mtimeMs)}-${stats.size}`;
}

async function resolveFileRef(input, roots, { requireFile = true } = {}) {
  const ref = normalizeFileRef(input);
  if (!ref) {
    const err = new Error('Invalid file reference');
    err.code = 'INVALID_FILE_REF';
    throw err;
  }
  const rootDir = roots && roots[ref.rootId];
  if (!rootDir) {
    const err = new Error('Unknown file root');
    err.code = 'UNKNOWN_FILE_ROOT';
    throw err;
  }

  const absPath = await resolveExistingPath(ref.path, rootDir, { allowRoot: false });
  if (!absPath) {
    const err = new Error('File reference is outside the authorized root or does not exist');
    err.code = 'FILE_REF_NOT_FOUND';
    throw err;
  }
  const stats = await fs.promises.stat(absPath);
  if (requireFile && !stats.isFile()) {
    const err = new Error('File reference does not identify a file');
    err.code = 'FILE_REF_NOT_FILE';
    throw err;
  }
  const currentVersion = fileVersion(stats);
  if (ref.version && ref.version !== currentVersion) {
    const err = new Error('Referenced file changed after selection');
    err.code = 'FILE_REF_VERSION_CHANGED';
    throw err;
  }
  return {
    ref: { ...ref, version: ref.version || currentVersion },
    absPath,
    stats,
    basename: path.basename(absPath),
  };
}

module.exports = { normalizeFileRef, resolveFileRef, fileVersion };
