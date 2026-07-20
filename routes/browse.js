const fs = require('fs');
const path = require('path');
const { getMimeType } = require('../utils/mime');
const { resolveExistingPath } = require('../utils/path-utils');

async function browse(req, res, rootDir) {
  const relPath = req.query.path || '';
  const dirPath = await resolveExistingPath(relPath, rootDir);

  if (!dirPath) {
    return res.status(403).json({ error: 'Access denied' });
  }

  let stats;
  try { stats = await fs.promises.stat(dirPath); }
  catch (err) {
    console.error(`[browse] stat failed for "${dirPath}":`, err.message);
    return res.status(404).json({ error: 'Directory not found' });
  }
  if (!stats.isDirectory()) {
    return res.status(404).json({ error: 'Directory not found' });
  }

  let entries;
  try { entries = await fs.promises.readdir(dirPath, { withFileTypes: true }); }
  catch (err) {
    console.error(`[browse] readdir failed for "${dirPath}":`, err.message);
    return res.status(500).json({ error: 'Failed to read directory' });
  }

  const result = (await Promise.all(entries.map(async (entry) => {
    let entryStats = null;
    try { entryStats = await fs.promises.lstat(path.join(dirPath, entry.name)); }
    catch (_) { }

    return {
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: entryStats ? entryStats.size : 0,
      mtime: entryStats ? entryStats.mtime.toISOString() : null,
      birthtime: entryStats ? entryStats.birthtime.toISOString() : null,
    };
  }))).filter(e => e.mtime !== null);

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  const parent = relPath ? path.dirname(relPath).replace(/\\/g, '/') : null;
  res.json({ path: relPath.replace(/\\/g, '/'), parent, entries: result });
}

async function file(req, res, rootDir) {
  const relPath = req.query.path || '';
  const filePath = await resolveExistingPath(relPath, rootDir, { allowRoot: false });

  if (!filePath) {
    return res.status(403).json({ error: 'Access denied' });
  }

  let stats;
  try { stats = await fs.promises.stat(filePath); }
  catch (_) { return res.status(404).json({ error: 'File not found' }); }
  if (!stats.isFile()) return res.status(404).json({ error: 'File not found' });

  const mimeType = getMimeType(filePath);
  const fileSize = stats.size;
    // 1-hour cache for standard files (images, PDFs, etc.)
    const isCacheable = ['image/', 'video/', 'audio/', 'application/pdf', 'text/'].some(p => mimeType.startsWith(p));
    const cacheControl = isCacheable ? 'public, max-age=3600' : 'no-cache';

    const baseHeaders = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
    };

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });

    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      ...baseHeaders,
      'Content-Length': fileSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

module.exports = { browse, file };
