const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: '需要管理员权限', code: 'FORBIDDEN' });
  }
  next();
}

module.exports = function ({ config }) {
  router.get('/', requireAdmin, (_req, res) => {
    res.json({
      root: config.rootDir,
      port: config.port,
      bind: config.bindAddrs,
      whitelist: config.whitelist,
    });
  });

  router.post('/', requireAdmin, async (req, res) => {
    const { root, port, bind, whitelist } = req.body;
    const updates = {};

    if (root !== undefined) {
      if (!root || typeof root !== 'string') {
        return res.status(400).json({ error: '请提供有效的根目录路径' });
      }
      const resolved = path.resolve(root);
      try {
        const stats = await fs.promises.stat(resolved);
        if (!stats.isDirectory()) {
          return res.status(400).json({ error: '路径存在但不是目录' });
        }
      } catch (_) {
        return res.status(400).json({ error: '目录不存在或无法访问' });
      }
      config.rootDir = resolved;
      updates.root = config.rootDir;
      console.log(`Root directory changed to: ${config.rootDir}`);
    }

    if (port !== undefined) {
      const p = parseInt(port, 10);
      if (isNaN(p) || p < 1 || p > 65535) {
        return res.status(400).json({ error: '端口号需在 1-65535 之间' });
      }
      config.port = p;
      updates.port = config.port;
      console.log(`Port changed to: ${config.port} (requires restart to take effect)`);
    }

    if (bind !== undefined) {
      const addrs = Array.isArray(bind) ? bind : String(bind).split(/[\n,;]/).map(s => s.trim()).filter(Boolean);
      if (addrs.length === 0) {
        return res.status(400).json({ error: '请提供至少一个绑定地址' });
      }
      const net = require('net');
      for (const addr of addrs) {
        if (!net.isIPv4(addr) && !net.isIPv6(addr) && addr !== '0.0.0.0') {
          return res.status(400).json({ error: `无效的 IP 地址: ${addr}` });
        }
      }
      config.bindAddrs = addrs;
      updates.bind = config.bindAddrs;
      console.log(`Bind addresses: ${config.bindAddrs.join(', ')} (requires restart to take effect)`);
    }

    if (whitelist !== undefined) {
      const err = config.validateWhitelist(whitelist);
      if (err) return res.status(400).json({ error: err });
      config.whitelist = whitelist.map(e => e.trim());
      updates.whitelist = config.whitelist;
      console.log(`Whitelist updated: ${config.whitelist.length ? config.whitelist.join(', ') : '(allow all)'}`);
    }

    try {
      config.saveConfig(updates);
    } catch (err) {
      console.error('[config] save failed:', err.message);
      return res.status(500).json({ error: '保存配置失败' });
    }

    res.json({ root: config.rootDir, port: config.port, bind: config.bindAddrs, whitelist: config.whitelist });
  });

  return router;
};
