const express = require('express');
const { browse, file } = require('./browse');

module.exports = function ({ config }) {
  const router = express.Router();

  router.get('/browse', async (req, res, next) => {
    try {
      await browse(req, res, config.rootDir);
    } catch (err) {
      next(err);
    }
  });

  router.get('/file', async (req, res, next) => {
    try {
      await file(req, res, config.rootDir);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
