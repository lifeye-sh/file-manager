const express = require('express');
const path = require('path');
const { safePath } = require('../utils/path-utils');
const { getThumb } = require('../services/thumbnail');

const THUMB_SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

module.exports = function ({ config }) {
  const router = express.Router();

  router.get('/thumb', async (req, res, next) => {
    const relPath = req.query.path || '';
    const filePath = safePath(relPath, config.rootDir);

    if (!filePath) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!THUMB_SUPPORTED_EXTS.has(ext)) {
      return res.status(400).json({ error: 'Not a supported image format for thumbnails' });
    }

    try {
      await getThumb(req, res, filePath);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
