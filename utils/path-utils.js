const path = require('path');

// Try to decode percent-encoded path (handles fetch double-encoding edge cases)
function tryDecode(str) {
  if (!str || !/%[0-9A-Fa-f]{2}/.test(str)) return str;
  try {
    const decoded = decodeURIComponent(str);
    return decoded !== str ? decoded : str;
  } catch (_) {
    return str;
  }
}

// Resolve and validate a path stays within rootDir
function safePath(relativePath, rootDir) {
  const cleaned = tryDecode(relativePath || '');
  const normalized = path.normalize(cleaned);
  const resolved = path.resolve(rootDir, normalized);
  const rootNorm = path.normalize(rootDir) + path.sep;
  if (!path.normalize(resolved).startsWith(rootNorm) && path.normalize(resolved) !== path.normalize(rootDir)) {
    return null;
  }
  return resolved;
}

function sanitizeName(name) {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '').trim();
  if (cleaned === '..' || cleaned === '.' || cleaned === '') return null;
  return cleaned;
}

async function pathExists(p) {
  try { await require('fs').promises.access(p); return true; }
  catch { return false; }
}

module.exports = { safePath, sanitizeName, pathExists, tryDecode };
