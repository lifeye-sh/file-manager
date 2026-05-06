const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safePath } = require('./safePath');

const THUMB_CACHE_DIR = path.join(__dirname, '..', '.thumbcache');
const THUMB_WIDTH = 256;
const THUMB_MAX_INPUT_SIZE = 50 * 1024 * 1024;
const THUMB_SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

const _thumbLocks = new Map();

// Init cache directory
try {
  if (!fs.existsSync(THUMB_CACHE_DIR)) {
    fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true });
  }
} catch (e) {
  console.error('[thumb] Failed to create cache directory:', e.message);
}

function getCacheKey(filePath, mtimeMs) {
  const hash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 16);
  return `${hash}_${String(mtimeMs)}`;
}

function cleanStale(filePath, hash, cacheFile) {
  try {
    const files = fs.readdirSync(THUMB_CACHE_DIR);
    files.forEach((f) => {
      if (f.startsWith(hash + '_') && f !== path.basename(cacheFile)) {
        try { fs.unlinkSync(path.join(THUMB_CACHE_DIR, f)); } catch (_) {}
      }
    });
  } catch (_) {}
}

function handleThumb(req, res) {
  const relPath = req.query.path || '';
  const filePath = safePath(relPath);
  if (!filePath) return res.status(403).json({ error: 'Access denied' });

  const ext = path.extname(filePath).toLowerCase();
  if (!THUMB_SUPPORTED_EXTS.has(ext)) {
    return res.status(400).json({ error: 'Not a supported image format for thumbnails' });
  }

  let sharp;
  try { sharp = require('sharp'); } catch (_) {
    return res.status(500).json({ error: 'Thumbnail generation is not available (sharp not installed)' });
  }

  let stats;
  try { stats = fs.statSync(filePath); } catch (_) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!stats.isFile()) return res.status(404).json({ error: 'Not a file' });
  if (stats.size > THUMB_MAX_INPUT_SIZE) {
    return res.status(400).json({ error: 'Image too large for thumbnail generation' });
  }

  const hash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 16);
  const cacheKey = getCacheKey(filePath, stats.mtimeMs);
  const cacheFile = path.join(THUMB_CACHE_DIR, `${cacheKey}.webp`);

  const serveCachedFile = () => {
    const cacheStats = fs.statSync(cacheFile);
    res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': cacheStats.size,
      'Cache-Control': 'public, max-age=3600',
    });
    fs.createReadStream(cacheFile).pipe(res);
  };

  if (fs.existsSync(cacheFile)) return serveCachedFile();

  if (_thumbLocks.has(cacheKey)) {
    _thumbLocks.get(cacheKey).push((err) => {
      if (err) return res.status(500).json({ error: 'Thumbnail generation failed' });
      try { serveCachedFile(); } catch (e) {
        return res.status(500).json({ error: 'Failed to serve thumbnail' });
      }
    });
    return;
  }
  _thumbLocks.set(cacheKey, []);

  cleanStale(filePath, hash, cacheFile);

  const tmpFile = cacheFile + '.tmp';
  sharp(filePath, { animated: false })
    .resize(THUMB_WIDTH, undefined, { withoutEnlargement: true, fit: 'inside' })
    .webp({ quality: 80 })
    .toFile(tmpFile, (err) => {
      const waiters = _thumbLocks.get(cacheKey) || [];
      _thumbLocks.delete(cacheKey);

      if (err) {
        console.error(`[thumb] generation failed for "${relPath}":`, err.message);
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        waiters.forEach((cb) => cb(err));
        return res.status(500).json({ error: 'Thumbnail generation failed' });
      }

      try { fs.renameSync(tmpFile, cacheFile); } catch (renameErr) {
        console.error(`[thumb] rename failed for "${relPath}":`, renameErr.message);
        waiters.forEach((cb) => cb(renameErr));
        return res.status(500).json({ error: 'Failed to finalize thumbnail' });
      }

      waiters.forEach((cb) => cb(null));
      serveCachedFile();
    });
}

module.exports = {
  handleThumb,
  THUMB_CACHE_DIR,
  THUMB_SUPPORTED_EXTS,
  THUMB_MAX_INPUT_SIZE,
};
