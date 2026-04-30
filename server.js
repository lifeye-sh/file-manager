const express = require('express');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

// Parse CLI args
const args = {};
process.argv.slice(2).forEach((arg) => {
  if (arg.startsWith('--')) {
    const [key, val] = arg.slice(2).split('=');
    args[key] = val || true;
  }
});

const CONFIG_FILE = path.join(__dirname, 'config.json');

// Load config from file
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (_) { /* corrupted config, use defaults */ }
  return {};
}

function saveConfig(config) {
  const current = loadConfig();
  const merged = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

// Normalize bind to array (supports legacy string, array, or comma-separated)
function normalizeBind(raw) {
  if (!raw) return ['0.0.0.0'];
  if (Array.isArray(raw)) return raw.map(s => String(s).trim()).filter(Boolean);
  return String(raw).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

const savedConfig = loadConfig();
let ROOT_DIR = path.resolve(args.root || savedConfig.root || process.cwd());
let PORT = parseInt(args.port || savedConfig.port || '3000', 10);
let BIND_ADDRS = normalizeBind(args.bind || savedConfig.bind);
let WHITELIST = savedConfig.whitelist || [];

// --- IP Whitelist ---
function ipToNumber(ip) {
  return net.isIPv6(ip) ? null : ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function cidrMatch(clientIP, cidr) {
  // Normalize: map IPv4-mapped IPv6 to IPv4
  if (clientIP.startsWith('::ffff:')) clientIP = clientIP.slice(7);

  if (cidr.includes('/')) {
    const [rangeIP, bits] = cidr.split('/');
    const prefixLen = parseInt(bits, 10);

    if (net.isIPv6(clientIP) || net.isIPv6(rangeIP)) {
      // Simple IPv6: only exact match with CIDR support is complex; skip prefix for now
      return clientIP === rangeIP;
    }

    const clientNum = ipToNumber(clientIP);
    const rangeNum = ipToNumber(rangeIP);
    if (clientNum === null || rangeNum === null) return false;

    const mask = ~(2 ** (32 - prefixLen) - 1) >>> 0;
    return (clientNum & mask) === (rangeNum & mask);
  }

  return clientIP === cidr;
}

function isWhitelisted(clientIP) {
  if (!WHITELIST || WHITELIST.length === 0) return true;
  // Always allow localhost
  if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1') return true;
  return WHITELIST.some((entry) => cidrMatch(clientIP, entry));
}

// Whitelist middleware
function whitelistMiddleware(req, res, next) {
  const clientIP = req.ip || req.socket.remoteAddress || '127.0.0.1';
  if (!isWhitelisted(clientIP)) {
    return res.status(403).json({ error: 'Access denied: IP not in whitelist' });
  }
  next();
}

// --- MIME types ---
const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
  '.md': 'text/markdown', '.csv': 'text/csv', '.log': 'text/plain',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip', '.tar': 'application/x-tar',
  '.gz': 'application/gzip', '.7z': 'application/x-7z-compressed',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

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

// Resolve and validate a path stays within ROOT_DIR
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

function validateWhitelist(entries) {
  if (!Array.isArray(entries)) return 'whitelist must be an array';
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim() === '') return 'whitelist entries must be non-empty strings';
    const trimmed = entry.trim();
    if (trimmed.includes('/')) {
      const [ip, bits] = trimmed.split('/');
      if (!net.isIPv4(ip) && !net.isIPv6(ip)) return `Invalid IP in CIDR: ${trimmed}`;
      const n = parseInt(bits, 10);
      if (isNaN(n) || n < 0 || n > 128) return `Invalid CIDR prefix: ${trimmed}`;
    } else if (!net.isIPv4(trimmed) && !net.isIPv6(trimmed)) {
      return `Invalid IP address: ${trimmed}`;
    }
  }
  return null;
}

// --- Thumbnail Generation ---
const THUMB_CACHE_DIR = path.join(__dirname, '.thumbcache');
const THUMB_WIDTH = 256;
const THUMB_MAX_INPUT_SIZE = 50 * 1024 * 1024;
const THUMB_SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

try {
  if (!fs.existsSync(THUMB_CACHE_DIR)) {
    fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true });
  }
} catch (e) {
  console.error('[thumb] Failed to create cache directory:', e.message);
}

const _thumbLocks = new Map();

// --- App ---
const app = express();
app.use(express.json());

// Apply whitelist to all requests except settings page
app.use((req, res, next) => {
  // Always allow access to static files and config API from localhost
  // so user can fix misconfigured whitelist
  whitelistMiddleware(req, res, next);
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/browse?path=<relative-path>
app.get('/api/browse', (req, res) => {
  const relPath = req.query.path || '';
  const dirPath = safePath(relPath);

  if (!dirPath) {
    return res.status(403).json({ error: 'Access denied' });
  }

  fs.stat(dirPath, (err, stats) => {
    if (err || !stats.isDirectory()) {
      if (err) console.error(`[browse] stat failed for "${dirPath}":`, err.message);
      return res.status(404).json({ error: 'Directory not found' });
    }

    fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to read directory' });
      }

      const result = entries.map((entry) => {
        let entryStats = null;
        try {
          entryStats = fs.statSync(path.join(dirPath, entry.name));
        } catch (_) { /* skip inaccessible entries */ }

        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entryStats ? entryStats.size : 0,
          mtime: entryStats ? entryStats.mtime.toISOString() : null,
          birthtime: entryStats ? entryStats.birthtime.toISOString() : null,
        };
      }).filter(e => e.mtime !== null);

      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });

      const parent = relPath ? path.dirname(relPath).replace(/\\/g, '/') : null;
      res.json({ path: relPath.replace(/\\/g, '/'), parent, entries: result });
    });
  });
});

// GET /api/file?path=<relative-path>
app.get('/api/file', (req, res) => {
  const relPath = req.query.path || '';
  const filePath = safePath(relPath);

  if (!filePath) {
    return res.status(403).json({ error: 'Access denied' });
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const mimeType = getMimeType(filePath);
    const fileSize = stats.size;

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });

      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

// GET /api/thumb?path=<relative-path> - serve/generate image thumbnail
app.get('/api/thumb', (req, res) => {
  const relPath = req.query.path || '';
  const filePath = safePath(relPath);

  if (!filePath) {
    return res.status(403).json({ error: 'Access denied' });
  }

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
    stats = fs.statSync(filePath);
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

  const serveCachedFile = () => {
    const cacheStats = fs.statSync(cacheFile);
    res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': cacheStats.size,
      'Cache-Control': 'public, max-age=3600',
    });
    fs.createReadStream(cacheFile).pipe(res);
  };

  if (fs.existsSync(cacheFile)) {
    return serveCachedFile();
  }

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

  // Clean up stale thumbnails for this file
  try {
    const files = fs.readdirSync(THUMB_CACHE_DIR);
    files.forEach((f) => {
      if (f.startsWith(hash + '_') && f !== path.basename(cacheFile)) {
        try { fs.unlinkSync(path.join(THUMB_CACHE_DIR, f)); } catch (_) {}
      }
    });
  } catch (_) {}

  const tmpFile = cacheFile + '.tmp';
  sharp(filePath, { animated: false })
    .resize(THUMB_WIDTH, undefined, {
      withoutEnlargement: true,
      fit: 'inside',
    })
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

      try {
        fs.renameSync(tmpFile, cacheFile);
      } catch (renameErr) {
        console.error(`[thumb] rename failed for "${relPath}":`, renameErr.message);
        waiters.forEach((cb) => cb(renameErr));
        return res.status(500).json({ error: 'Failed to finalize thumbnail' });
      }

      waiters.forEach((cb) => cb(null));
      serveCachedFile();
    });
});

// GET /api/config - get current configuration
app.get('/api/config', (_req, res) => {
  res.json({
    root: ROOT_DIR,
    port: PORT,
    bind: BIND_ADDRS,
    whitelist: WHITELIST,
  });
});

// POST /api/config - update configuration
app.post('/api/config', (req, res) => {
  const { root, port, bind, whitelist } = req.body;
  const updates = {};

  // Update root
  if (root !== undefined) {
    if (!root || typeof root !== 'string') {
      return res.status(400).json({ error: '请提供有效的根目录路径' });
    }
    const resolved = path.resolve(root);
    try {
      const stats = fs.statSync(resolved);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: '路径存在但不是目录' });
      }
    } catch (_) {
      return res.status(400).json({ error: '目录不存在或无法访问' });
    }
    ROOT_DIR = resolved;
    updates.root = ROOT_DIR;
    console.log(`Root directory changed to: ${ROOT_DIR}`);
  }

  // Update port
  if (port !== undefined) {
    const p = parseInt(port, 10);
    if (isNaN(p) || p < 1 || p > 65535) {
      return res.status(400).json({ error: '端口号需在 1-65535 之间' });
    }
    PORT = p;
    updates.port = PORT;
    console.log(`Port changed to: ${PORT} (requires restart to take effect)`);
  }

  // Update bind
  if (bind !== undefined) {
    const addrs = Array.isArray(bind) ? bind : String(bind).split(/[\n,;]/).map(s => s.trim()).filter(Boolean);
    if (addrs.length === 0) {
      return res.status(400).json({ error: '请提供至少一个绑定地址' });
    }
    for (const addr of addrs) {
      if (!net.isIPv4(addr) && !net.isIPv6(addr) && addr !== '0.0.0.0') {
        return res.status(400).json({ error: `无效的 IP 地址: ${addr}` });
      }
    }
    BIND_ADDRS = addrs;
    updates.bind = BIND_ADDRS;
    console.log(`Bind addresses: ${BIND_ADDRS.join(', ')} (requires restart to take effect)`);
  }

  // Update whitelist
  if (whitelist !== undefined) {
    const err = validateWhitelist(whitelist);
    if (err) return res.status(400).json({ error: err });
    WHITELIST = whitelist.map(e => e.trim());
    updates.whitelist = WHITELIST;
    console.log(`Whitelist updated: ${WHITELIST.length ? WHITELIST.join(', ') : '(allow all)'}`);
  }

  try {
    saveConfig(updates);
  } catch (err) {
    return res.status(500).json({ error: '保存配置失败: ' + err.message });
  }

  res.json({ root: ROOT_DIR, port: PORT, bind: BIND_ADDRS, whitelist: WHITELIST });
});

// --- Multipart parser (no dependency) ---
function parseMultipart(rawBody, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');
  const boundaryBuf = Buffer.from('--' + boundary);
  const crlfBuf = Buffer.from('\r\n\r\n');
  const lfBuf = Buffer.from('\n\n');

  const fields = {};
  const files = [];

  let pos = 0;
  const bodyLen = rawBody.length;

  while (pos < bodyLen) {
    const boundaryPos = rawBody.indexOf(boundaryBuf, pos);
    if (boundaryPos === -1) break;

    const endCheck = rawBody.subarray(boundaryPos + boundaryBuf.length, boundaryPos + boundaryBuf.length + 2);
    if (Buffer.from('--').equals(endCheck)) break;

    const partStart = boundaryPos + boundaryBuf.length + 2;
    pos = partStart;

    let headerEnd = rawBody.indexOf(crlfBuf, partStart);
    if (headerEnd === -1) headerEnd = rawBody.indexOf(lfBuf, partStart);
    if (headerEnd === -1) break;

    const headerText = rawBody.subarray(partStart, headerEnd).toString('utf-8');
    const headers = {};
    headerText.split('\r\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    });

    const contentStart = headerEnd + (rawBody[headerEnd] === 0x0d ? 4 : 2);
    const nextBoundary = rawBody.indexOf(boundaryBuf, contentStart);
    if (nextBoundary === -1) break;

    const contentEnd = nextBoundary - 2;
    const content = rawBody.slice(contentStart, contentEnd);

    const disposition = headers['content-disposition'] || '';
    const nameMatch = disposition.match(/name="([^"]+)"/);
    const filenameMatch = disposition.match(/filename="([^"]+)"/);

    if (filenameMatch) {
      files.push({
        fieldName: nameMatch ? nameMatch[1] : 'files',
        filename: filenameMatch[1],
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: content,
        size: content.length,
      });
    } else if (nameMatch) {
      fields[nameMatch[1]] = content.toString('utf-8');
    }

    pos = nextBoundary;
  }

  return { fields, files };
}

// POST /api/mkdir - create directory
app.post('/api/mkdir', (req, res) => {
  const { path: relPath, name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: '请提供有效的文件夹名称' });
  }
  const safeName = name.replace(/[/\\:*?"<>|]/g, '').trim();
  if (!safeName) return res.status(400).json({ error: '文件夹名称包含无效字符' });

  const parentPath = safePath(relPath || '');
  if (!parentPath) return res.status(403).json({ error: 'Access denied' });

  const newPath = path.join(parentPath, safeName);
  const newRelPath = path.relative(ROOT_DIR, newPath).replace(/\\/g, '/');
  if (!safePath(newRelPath)) return res.status(403).json({ error: 'Access denied' });

  if (fs.existsSync(newPath)) return res.status(409).json({ error: '文件夹已存在' });

  fs.mkdir(newPath, { recursive: true }, (err) => {
    if (err) return res.status(500).json({ error: '创建文件夹失败: ' + err.message });
    console.log(`[mkdir] ${newRelPath}`);
    res.json({ success: true });
  });
});

// POST /api/rename - rename file/directory
app.post('/api/rename', (req, res) => {
  const { path: relPath, newName } = req.body;
  if (!relPath || !newName || typeof newName !== 'string' || newName.trim() === '') {
    return res.status(400).json({ error: '请提供有效的新名称' });
  }
  const safeName = newName.replace(/[/\\:*?"<>|]/g, '').trim();
  if (!safeName) return res.status(400).json({ error: '名称包含无效字符' });

  const sourcePath = safePath(relPath);
  if (!sourcePath) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: '文件或文件夹不存在' });

  const parentDir = path.dirname(sourcePath);
  const destPath = path.join(parentDir, safeName);
  const destRelPath = path.relative(ROOT_DIR, destPath).replace(/\\/g, '/');
  if (!safePath(destRelPath)) return res.status(403).json({ error: 'Access denied' });
  if (fs.existsSync(destPath)) return res.status(409).json({ error: '目标名称已存在' });

  fs.rename(sourcePath, destPath, (err) => {
    if (err) return res.status(500).json({ error: '重命名失败: ' + err.message });
    console.log(`[rename] ${relPath} -> ${destRelPath}`);
    res.json({ success: true });
  });
});

// POST /api/delete - delete file/directory
app.post('/api/delete', (req, res) => {
  const { path: relPath } = req.body;
  if (!relPath) return res.status(400).json({ error: '请指定要删除的路径' });

  const targetPath = safePath(relPath);
  if (!targetPath) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(targetPath)) return res.status(404).json({ error: '文件或文件夹不存在' });

  fs.rm(targetPath, { recursive: true, force: true }, (err) => {
    if (err) return res.status(500).json({ error: '删除失败: ' + err.message });
    console.log(`[delete] ${relPath}`);
    res.json({ success: true });
  });
});

// POST /api/move - move file/directory
app.post('/api/move', (req, res) => {
  const { path: relPath, targetDir } = req.body;
  if (!relPath || targetDir === undefined || targetDir === null) {
    return res.status(400).json({ error: '请提供源路径和目标目录' });
  }

  const sourcePath = safePath(relPath);
  if (!sourcePath) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: '源文件或文件夹不存在' });

  const destDirPath = safePath(targetDir);
  if (!destDirPath) return res.status(403).json({ error: '目标目录访问被拒绝' });
  if (!fs.existsSync(destDirPath)) return res.status(404).json({ error: '目标目录不存在' });

  const basename = path.basename(sourcePath);
  const destPath = path.join(destDirPath, basename);
  const destRelPath = path.relative(ROOT_DIR, destPath).replace(/\\/g, '/');
  if (!safePath(destRelPath)) return res.status(403).json({ error: 'Access denied' });
  if (fs.existsSync(destPath)) return res.status(409).json({ error: '目标位置已存在同名文件或文件夹' });

  // Simple rename (same filesystem)
  fs.rename(sourcePath, destPath, (err) => {
    if (err) return res.status(500).json({ error: '移动失败: ' + err.message });
    console.log(`[move] ${relPath} -> ${destRelPath}`);
    res.json({ success: true });
  });
});

// POST /api/save - save text file content
app.post('/api/save', (req, res) => {
  const { path: relPath, content } = req.body;
  if (!relPath) return res.status(400).json({ error: '请指定文件路径' });
  if (typeof content !== 'string') return res.status(400).json({ error: '请提供文件内容' });

  const filePath = safePath(relPath);
  if (!filePath) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });

  fs.writeFile(filePath, content, 'utf-8', (err) => {
    if (err) return res.status(500).json({ error: '保存失败: ' + err.message });
    console.log(`[save] ${relPath}`);
    res.json({ success: true });
  });
});

// POST /api/upload - upload files (multipart)
app.post('/api/upload', express.raw({ type: 'multipart/form-data', limit: '2gb' }), (req, res) => {
  const contentType = req.headers['content-type'] || '';
  const parsed = parseMultipart(req.body, contentType);
  if (!parsed) return res.status(400).json({ error: '无法解析上传数据' });

  const { fields, files } = parsed;
  const uploadDirRel = fields.uploadDir || '';
  const uploadDir = safePath(uploadDirRel);
  if (!uploadDir) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(uploadDir)) return res.status(404).json({ error: '目标目录不存在' });

  const results = [];
  for (const file of files) {
    const destPath = path.join(uploadDir, file.filename);
    const destRel = path.relative(ROOT_DIR, destPath).replace(/\\/g, '/');
    if (!safePath(destRel)) {
      results.push({ name: file.filename, error: 'Access denied' });
      continue;
    }
    try {
      fs.writeFileSync(destPath, file.buffer);
      console.log(`[upload] ${destRel} (${file.size} bytes)`);
      results.push({ name: file.filename, success: true, size: file.size });
    } catch (err) {
      results.push({ name: file.filename, error: err.message });
    }
  }

  res.json({ results });
});

BIND_ADDRS.forEach(addr => {
  app.listen(PORT, addr, () => {
    const label = addr === '0.0.0.0' ? 'localhost' : addr;
    console.log(`Listening on http://${label}:${PORT}`);
  });
});
console.log(`Serving files from: ${ROOT_DIR}`);
if (WHITELIST.length > 0) {
  console.log(`Whitelist: ${WHITELIST.join(', ')}`);
} else {
  console.log('Whitelist: (allow all)');
}
