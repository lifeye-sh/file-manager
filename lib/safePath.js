const path = require('path');

let ROOT_DIR = process.cwd();

function setRoot(dir) {
  ROOT_DIR = path.resolve(dir);
}

function tryDecode(str) {
  if (!str || !/%[0-9A-Fa-f]{2}/.test(str)) return str;
  try {
    const decoded = decodeURIComponent(str);
    return decoded !== str ? decoded : str;
  } catch (_) {
    return str;
  }
}

function safePath(relativePath) {
  const cleaned = tryDecode(relativePath || '');
  const normalized = path.normalize(cleaned);
  const resolved = path.resolve(ROOT_DIR, normalized);
  const rootNorm = path.normalize(ROOT_DIR) + path.sep;
  if (!path.normalize(resolved).startsWith(rootNorm) && path.normalize(resolved) !== path.normalize(ROOT_DIR)) {
    return null;
  }
  return resolved;
}

module.exports = { setRoot, safePath, tryDecode };
