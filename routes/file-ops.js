const express = require('express');
const fs = require('fs');
const path = require('path');
const { safePath, sanitizeName, pathExists } = require('../utils/path-utils');

const UPLOAD_BODY_LIMIT = '100mb';
const UPLOAD_MAX_CONCURRENCY = 2;
let uploadInProgress = 0;

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

module.exports = function ({ config }) {
  const router = express.Router();

  function rootDir() {
    return config.rootDir;
  }

  router.post('/mkdir', async (req, res) => {
    const { path: relPath, name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: '请提供有效的文件夹名称' });
    }
    const safeName = sanitizeName(name);
    if (!safeName) return res.status(400).json({ error: '文件夹名称包含无效字符' });

    const parentPath = safePath(relPath || '', rootDir());
    if (!parentPath) return res.status(403).json({ error: 'Access denied' });

    const newPath = path.join(parentPath, safeName);
    const newRelPath = path.relative(rootDir(), newPath).replace(/\\/g, '/');
    if (!safePath(newRelPath, rootDir())) return res.status(403).json({ error: 'Access denied' });

    if (await pathExists(newPath)) return res.status(409).json({ error: '文件夹已存在' });

    try {
      await fs.promises.mkdir(newPath, { recursive: true });
      console.log(`[mkdir] ${newRelPath}`);
      res.json({ success: true });
    } catch (err) {
      console.error(`[mkdir] failed ${newRelPath}:`, err.message);
      res.status(500).json({ error: '创建文件夹失败' });
    }
  });

  router.post('/rename', async (req, res) => {
    const { path: relPath, newName } = req.body;
    if (!relPath || !newName || typeof newName !== 'string' || newName.trim() === '') {
      return res.status(400).json({ error: '请提供有效的新名称' });
    }
    const safeName = sanitizeName(newName);
    if (!safeName) return res.status(400).json({ error: '名称包含无效字符' });

    const sourcePath = safePath(relPath, rootDir());
    if (!sourcePath) return res.status(403).json({ error: 'Access denied' });
    if (!(await pathExists(sourcePath))) return res.status(404).json({ error: '文件或文件夹不存在' });

    const parentDir = path.dirname(sourcePath);
    const destPath = path.join(parentDir, safeName);
    const destRelPath = path.relative(rootDir(), destPath).replace(/\\/g, '/');
    if (!safePath(destRelPath, rootDir())) return res.status(403).json({ error: 'Access denied' });
    if (await pathExists(destPath)) return res.status(409).json({ error: '目标名称已存在' });

    try {
      await fs.promises.rename(sourcePath, destPath);
      console.log(`[rename] ${relPath} -> ${destRelPath}`);
      res.json({ success: true });
    } catch (err) {
      console.error(`[rename] failed ${relPath} -> ${destRelPath}:`, err.message);
      res.status(500).json({ error: '重命名失败' });
    }
  });

  router.post('/delete', async (req, res) => {
    const { path: relPath } = req.body;
    if (!relPath) return res.status(400).json({ error: '请指定要删除的路径' });

    const targetPath = safePath(relPath, rootDir());
    if (!targetPath) return res.status(403).json({ error: 'Access denied' });
    if (!(await pathExists(targetPath))) return res.status(404).json({ error: '文件或文件夹不存在' });

    try {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
      console.log(`[delete] ${relPath}`);
      res.json({ success: true });
    } catch (err) {
      console.error(`[delete] failed ${relPath}:`, err.message);
      res.status(500).json({ error: '删除失败' });
    }
  });

  router.post('/move', async (req, res) => {
    const { path: relPath, targetDir } = req.body;
    if (!relPath || targetDir === undefined || targetDir === null) {
      return res.status(400).json({ error: '请提供源路径和目标目录' });
    }

    const sourcePath = safePath(relPath, rootDir());
    if (!sourcePath) return res.status(403).json({ error: 'Access denied' });
    if (!(await pathExists(sourcePath))) return res.status(404).json({ error: '源文件或文件夹不存在' });

    const destDirPath = safePath(targetDir, rootDir());
    if (!destDirPath) return res.status(403).json({ error: '目标目录访问被拒绝' });
    if (!(await pathExists(destDirPath))) return res.status(404).json({ error: '目标目录不存在' });

    const basename = path.basename(sourcePath);
    const destPath = path.join(destDirPath, basename);
    const destRelPath = path.relative(rootDir(), destPath).replace(/\\/g, '/');
    if (!safePath(destRelPath, rootDir())) return res.status(403).json({ error: 'Access denied' });
    if (await pathExists(destPath)) return res.status(409).json({ error: '目标位置已存在同名文件或文件夹' });

    try {
      await fs.promises.rename(sourcePath, destPath);
      console.log(`[move] ${relPath} -> ${destRelPath}`);
      res.json({ success: true });
    } catch (err) {
      console.error(`[move] failed ${relPath} -> ${destRelPath}:`, err.message);
      res.status(500).json({ error: '移动失败' });
    }
  });

  router.post('/save', async (req, res) => {
    const { path: relPath, content } = req.body;
    if (!relPath) return res.status(400).json({ error: '请指定文件路径' });
    if (typeof content !== 'string') return res.status(400).json({ error: '请提供文件内容' });

    const filePath = safePath(relPath, rootDir());
    if (!filePath) return res.status(403).json({ error: 'Access denied' });
    if (!(await pathExists(filePath))) return res.status(404).json({ error: '文件不存在' });

    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      console.log(`[save] ${relPath}`);
      res.json({ success: true });
    } catch (err) {
      console.error(`[save] failed ${relPath}:`, err.message);
      res.status(500).json({ error: '保存失败' });
    }
  });

  router.post('/upload',
    // Concurrency guard to avoid memory spikes from simultaneous large uploads
    (req, res, next) => {
      if (uploadInProgress >= UPLOAD_MAX_CONCURRENCY) {
        return res.status(503).json({ error: '上传并发数过多，请稍后重试' });
      }
      uploadInProgress++;
      res.on('finish', () => { uploadInProgress--; });
      next();
    },
    express.raw({ type: 'multipart/form-data', limit: UPLOAD_BODY_LIMIT }),
    async (req, res) => {
      const contentType = req.headers['content-type'] || '';
      const parsed = parseMultipart(req.body, contentType);
      if (!parsed) return res.status(400).json({ error: '无法解析上传数据' });

      const { fields, files } = parsed;
      const uploadDirRel = fields.uploadDir || '';
      const uploadDir = safePath(uploadDirRel, rootDir());
      if (!uploadDir) return res.status(403).json({ error: 'Access denied' });
      if (!(await pathExists(uploadDir))) return res.status(404).json({ error: '目标目录不存在' });

      const results = await Promise.all(files.map(async (file) => {
        const destPath = path.join(uploadDir, file.filename);
        const destRel = path.relative(rootDir(), destPath).replace(/\\/g, '/');
        if (!safePath(destRel, rootDir())) {
          return { name: file.filename, error: 'Access denied' };
        }
        try {
          await fs.promises.writeFile(destPath, file.buffer);
          console.log(`[upload] ${destRel} (${file.size} bytes)`);
          return { name: file.filename, success: true, size: file.size };
        } catch (err) {
          console.error(`[upload] failed ${destRel}:`, err.message);
          return { name: file.filename, error: '上传失败' };
        }
      }));

      res.json({ results });
    }
  );

  return router;
};
