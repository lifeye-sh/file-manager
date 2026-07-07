const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const THUMB_CACHE_DIR = path.join(__dirname, '..', '.thumbcache');
const THUMB_WIDTH = 256;
const THUMB_MAX_INPUT_SIZE = 50 * 1024 * 1024;
const THUMB_SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

(async function ensureCacheDir() {
  try {
    if (!fs.existsSync(THUMB_CACHE_DIR)) {
      await fs.promises.mkdir(THUMB_CACHE_DIR, { recursive: true });
    }
  } catch (e) {
    console.error('[thumb] Failed to create cache directory:', e.message);
  }
})();

const _thumbLocks = new Map();

async function getThumb(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!THUMB_SUPPORTED_EXTS.has(ext)) {
    return res.status(400).json({ error: 'Not a supported image format for thumbnails' });
  }

  let sharp;
  try {
    sharp = require('sharp');
  } catch (_) {
    return res.status(500).json({ error: 'Thumbnail generation is not available (sharp not installed)' });
  }

  let stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch (err) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!stats.isFile()) {
    return res.status(404).json({ error: 'Not a file' });
  }
  if (stats.size > THUMB_MAX_INPUT_SIZE) {
    return res.status(400).json({ error: 'Image too large for thumbnail generation' });
  }

  const hash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 16);
  const cacheKey = `${hash}_${String(stats.mtimeMs)}`;
  const cacheFile = path.join(THUMB_CACHE_DIR, `${cacheKey}.webp`);

  const serveCachedFile = async () => {
    const cacheStats = await fs.promises.stat(cacheFile);
    res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': cacheStats.size,
      'Cache-Control': 'public, max-age=3600',
    });
    fs.createReadStream(cacheFile).pipe(res);
  };

  try {
    await fs.promises.access(cacheFile);
    return await serveCachedFile();
  } catch (_) { /* cache miss */ }

  if (_thumbLocks.has(cacheKey)) {
    _thumbLocks.get(cacheKey).push((err) => {
      if (err) return res.status(500).json({ error: 'Thumbnail generation failed' });
      serveCachedFile().catch(() => res.status(500).json({ error: 'Failed to serve thumbnail' }));
    });
    return;
  }
  _thumbLocks.set(cacheKey, []);

  fs.promises.readdir(THUMB_CACHE_DIR).then(files => {
    return Promise.all(files
      .filter(f => f.startsWith(hash + '_') && f !== path.basename(cacheFile))
      .map(f => fs.promises.unlink(path.join(THUMB_CACHE_DIR, f)).catch(() => {})));
  }).catch(() => {});

  const tmpFile = cacheFile + '.tmp';
  sharp(filePath, { animated: false })
    .resize(THUMB_WIDTH, undefined, {
      withoutEnlargement: true,
      fit: 'inside',
    })
    .webp({ quality: 80 })
    .toFile(tmpFile, async (err) => {
      const waiters = _thumbLocks.get(cacheKey) || [];
      _thumbLocks.delete(cacheKey);

      if (err) {
        console.error(`[thumb] generation failed for "${filePath}":`, err.message);
        try { await fs.promises.unlink(tmpFile); } catch (_) {}
        waiters.forEach((cb) => cb(err));
        return res.status(500).json({ error: 'Thumbnail generation failed' });
      }

      try {
        await fs.promises.rename(tmpFile, cacheFile);
      } catch (renameErr) {
        console.error(`[thumb] rename failed for "${filePath}":`, renameErr.message);
        waiters.forEach((cb) => cb(renameErr));
        return res.status(500).json({ error: 'Failed to finalize thumbnail' });
      }

      waiters.forEach((cb) => cb(null));
      try { await serveCachedFile(); }
      catch (serveErr) {
        console.error(`[thumb] serve failed for "${filePath}":`, serveErr.message);
        return res.status(500).json({ error: 'Failed to serve thumbnail' });
      }
    });
}

module.exports = { getThumb };
