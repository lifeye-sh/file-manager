const fs = require('fs');
const path = require('path');
const net = require('net');

const { safePath } = require('../lib/safePath');
const { getMimeType } = require('../lib/mime');
const { handleThumb } = require('../lib/thumbnail');
const { isWhitelisted, whitelistMiddleware, validateWhitelist } = require('../lib/whitelist');
const config = require('../lib/config');

// Sensitive filenames that must not be edited
const SENSITIVE_NAMES = new Set([
  '.env', '.env.local', '.env.production',
  '.htpasswd', '.htaccess',
  'authorized_keys', 'id_rsa', 'id_ed25519',
  'known_hosts', 'config.json', 'config.json.enc',
  '.gitconfig', '.npmrc', '.bashrc', '.zshrc',
  'credentials', 'secrets',
]);

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

function registerRoutes(app) {
  // Whitelist middleware
  app.use((req, res, next) => whitelistMiddleware(req, res, next));

  // GET /api/browse
  app.get('/api/browse', (req, res) => {
    const relPath = req.query.path || '';
    const dirPath = safePath(relPath);
    if (!dirPath) return res.status(403).json({ error: 'Access denied' });

    fs.stat(dirPath, (err, stats) => {
      if (err || !stats.isDirectory()) {
        if (err) console.error(`[browse] stat failed for "${dirPath}":`, err.message);
        return res.status(404).json({ error: 'Directory not found' });
      }

      fs.readdir(dirPath, { withFileTypes: true }, async (err, entries) => {
        if (err) return res.status(500).json({ error: 'Failed to read directory' });

        const statsResults = await Promise.all(
          entries.map((entry) =>
            fs.promises.stat(path.join(dirPath, entry.name)).catch(() => null)
          )
        );

        const result = entries
          .map((entry, i) => {
            const s = statsResults[i];
            return {
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
              size: s ? s.size : 0,
              mtime: s ? s.mtime.toISOString() : null,
              birthtime: s ? s.birthtime.toISOString() : null,
            };
          })
          .filter(e => e.mtime !== null);

        result.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        });

        const parent = relPath ? path.dirname(relPath).replace(/\\/g, '/') : null;
        res.json({ path: relPath.replace(/\\/g, '/'), parent, entries: result });
      });
    });
  });

  // GET /api/file
  app.get('/api/file', (req, res) => {
    const relPath = req.query.path || '';
    const filePath = safePath(relPath);
    if (!filePath) return res.status(403).json({ error: 'Access denied' });

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) return res.status(404).json({ error: 'File not found' });

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

  // GET /api/thumb
  app.get('/api/thumb', handleThumb);

  // GET /api/config
  app.get('/api/config', (_req, res) => {
    res.json({
      root: config.root,
      port: config.port,
      bind: config.bind,
      whitelist: config.whitelist,
    });
  });

  // POST /api/config
  app.post('/api/config', (req, res) => {
    const { root, port, bind, whitelist } = req.body;
    const updates = {};

    if (root !== undefined) {
      if (!root || typeof root !== 'string') {
        return res.status(400).json({ error: '请提供有效的根目录路径' });
      }
      const resolved = path.resolve(root);
      try {
        const s = fs.statSync(resolved);
        if (!s.isDirectory()) return res.status(400).json({ error: '路径存在但不是目录' });
      } catch (_) {
        return res.status(400).json({ error: '目录不存在或无法访问' });
      }
      config.root = resolved;
      require('../lib/safePath').setRoot(resolved);
      updates.root = resolved;
      console.log(`Root directory changed to: ${resolved}`);
    }

    if (port !== undefined) {
      const p = parseInt(port, 10);
      if (isNaN(p) || p < 1 || p > 65535) return res.status(400).json({ error: '端口号需在 1-65535 之间' });
      config.port = p;
      updates.port = p;
      console.log(`Port changed to: ${p} (requires restart to take effect)`);
    }

    if (bind !== undefined) {
      const addrs = Array.isArray(bind) ? bind : String(bind).split(/[\n,;]/).map(s => s.trim()).filter(Boolean);
      if (addrs.length === 0) return res.status(400).json({ error: '请提供至少一个绑定地址' });
      for (const addr of addrs) {
        if (!net.isIPv4(addr) && !net.isIPv6(addr) && addr !== '0.0.0.0') {
          return res.status(400).json({ error: `无效的 IP 地址: ${addr}` });
        }
      }
      config.bind = addrs;
      updates.bind = addrs;
      console.log(`Bind addresses: ${addrs.join(', ')} (requires restart to take effect)`);
    }

    if (whitelist !== undefined) {
      const err = validateWhitelist(whitelist);
      if (err) return res.status(400).json({ error: err });
      const list = whitelist.map(e => e.trim());
      config.whitelist = list;
      require('../lib/whitelist').setWhitelist(list);
      updates.whitelist = list;
      console.log(`Whitelist updated: ${list.length ? list.join(', ') : '(allow all)'}`);
    }

    try {
      config.saveConfig(updates);
    } catch (err) {
      return res.status(500).json({ error: '保存配置失败: ' + err.message });
    }

    res.json({ root: config.root, port: config.port, bind: config.bind, whitelist: config.whitelist });
  });

  // POST /api/mkdir
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
    const newRelPath = path.relative(config.root, newPath).replace(/\\/g, '/');
    if (!safePath(newRelPath)) return res.status(403).json({ error: 'Access denied' });
    if (fs.existsSync(newPath)) return res.status(409).json({ error: '文件夹已存在' });

    fs.mkdir(newPath, { recursive: true }, (err) => {
      if (err) return res.status(500).json({ error: '创建文件夹失败: ' + err.message });
      console.log(`[mkdir] ${newRelPath}`);
      res.json({ success: true });
    });
  });

  // POST /api/rename
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
    const destRelPath = path.relative(config.root, destPath).replace(/\\/g, '/');
    if (!safePath(destRelPath)) return res.status(403).json({ error: 'Access denied' });
    if (fs.existsSync(destPath)) return res.status(409).json({ error: '目标名称已存在' });

    fs.rename(sourcePath, destPath, (err) => {
      if (err) return res.status(500).json({ error: '重命名失败: ' + err.message });
      console.log(`[rename] ${relPath} -> ${destRelPath}`);
      res.json({ success: true });
    });
  });

  // POST /api/delete
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

  // POST /api/move
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
    const destRelPath = path.relative(config.root, destPath).replace(/\\/g, '/');
    if (!safePath(destRelPath)) return res.status(403).json({ error: 'Access denied' });
    if (fs.existsSync(destPath)) return res.status(409).json({ error: '目标位置已存在同名文件或文件夹' });

    fs.rename(sourcePath, destPath, (err) => {
      if (err) return res.status(500).json({ error: '移动失败: ' + err.message });
      console.log(`[move] ${relPath} -> ${destRelPath}`);
      res.json({ success: true });
    });
  });

  // POST /api/save
  app.post('/api/save', (req, res) => {
    const { path: relPath, content } = req.body;
    if (!relPath) return res.status(400).json({ error: '请指定文件路径' });
    if (typeof content !== 'string') return res.status(400).json({ error: '请提供文件内容' });

    const filePath = safePath(relPath);
    if (!filePath) return res.status(403).json({ error: 'Access denied' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });

    if (SENSITIVE_NAMES.has(path.basename(filePath).toLowerCase())) {
      return res.status(403).json({ error: '不允许编辑此文件' });
    }

    fs.writeFile(filePath, content, 'utf-8', (err) => {
      if (err) return res.status(500).json({ error: '保存失败: ' + err.message });
      console.log(`[save] ${relPath}`);
      res.json({ success: true });
    });
  });

  // POST /api/upload
  app.post('/api/upload', require('express').raw({ type: 'multipart/form-data', limit: '2gb' }), (req, res) => {
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
      const destRel = path.relative(config.root, destPath).replace(/\\/g, '/');
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
}

module.exports = { registerRoutes };
