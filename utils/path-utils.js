const fs = require('fs');
const path = require('path');

// Decode repeatedly so values encoded by both the browser and a caller cannot
// smuggle traversal through a single decoding pass.
function tryDecode(str) {
  let value = String(str || '');
  for (let i = 0; i < 3 && /%[0-9A-Fa-f]{2}/.test(value); i++) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch (_) {
      break;
    }
  }
  return value;
}

function comparable(p) {
  const normalized = path.normalize(p);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathWithin(candidate, rootDir, { allowRoot = true } = {}) {
  const candidateNorm = comparable(candidate);
  const rootNorm = comparable(rootDir);
  if (candidateNorm === rootNorm) return allowRoot;
  return candidateNorm.startsWith(rootNorm.endsWith(path.sep) ? rootNorm : rootNorm + path.sep);
}

function isAbsoluteLike(value) {
  return path.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || /^[a-zA-Z]:/.test(value)
    || /^[/\\]{2}/.test(value);
}

function normalizeRelativePath(relativePath, { allowEmpty = true } = {}) {
  if (typeof relativePath !== 'string') return null;
  const decoded = tryDecode(relativePath);
  if (decoded.includes('\0') || isAbsoluteLike(decoded)) return null;

  const slashPath = decoded.replace(/\\/g, '/');
  const segments = slashPath.split('/');
  if (segments.some(segment => segment === '..')) return null;
  if (slashPath !== '.' && segments.some(segment => segment === '.')) return null;

  const normalized = path.posix.normalize(slashPath);
  if (normalized === '.' || normalized === '') return allowEmpty ? '' : null;
  if (normalized.startsWith('../') || normalized.includes('\0')) return null;
  return normalized;
}

// Lexical containment check. Existing filesystem targets must additionally use
// resolveExistingPath() so symlinks and Windows junctions cannot escape.
function safePath(relativePath, rootDir) {
  const normalized = normalizeRelativePath(String(relativePath || ''), { allowEmpty: true });
  if (normalized === null) return null;
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, normalized);
  return isPathWithin(resolved, root) ? resolved : null;
}

async function resolveExistingPath(relativePath, rootDir, { allowRoot = true } = {}) {
  const lexical = safePath(relativePath, rootDir);
  if (!lexical) return null;
  try {
    const [realRoot, realTarget] = await Promise.all([
      fs.promises.realpath(path.resolve(rootDir)),
      fs.promises.realpath(lexical),
    ]);
    return isPathWithin(realTarget, realRoot, { allowRoot }) ? lexical : null;
  } catch (_) {
    return null;
  }
}

async function resolveNewPath(parentRelativePath, name, rootDir) {
  const safeName = sanitizeName(name);
  if (!safeName) return null;
  const realParent = await resolveExistingPath(parentRelativePath || '', rootDir);
  if (!realParent) return null;
  try {
    const stats = await fs.promises.stat(realParent);
    if (!stats.isDirectory()) return null;
    const target = path.join(realParent, safeName);
    return isPathWithin(target, path.resolve(rootDir), { allowRoot: false }) ? target : null;
  } catch (_) {
    return null;
  }
}

function sanitizeName(name) {
  if (typeof name !== 'string') return null;
  const cleaned = name.trim();
  if (cleaned !== name || cleaned === '..' || cleaned === '.' || cleaned === '') return null;
  if (cleaned.length > 255 || /[\x00-\x1f/\\:*?"<>|]/.test(cleaned)) return null;
  if (/[. ]$/.test(cleaned)) return null;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) return null;
  return cleaned;
}

async function pathExists(p) {
  try { await require('fs').promises.access(p); return true; }
  catch { return false; }
}

module.exports = {
  safePath,
  resolveExistingPath,
  resolveNewPath,
  normalizeRelativePath,
  isPathWithin,
  sanitizeName,
  pathExists,
  tryDecode,
};
