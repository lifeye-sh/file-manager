'use strict';

const crypto = require('crypto');
const fs = require('fs');
const sharp = require('sharp');
const { resolveFileRef } = require('../file-ref-service');
const { getMimeType } = require('../../utils/mime');
const { isPathWithin } = require('../../utils/path-utils');
const { IMPORT_ID_RE, MAX_IMPORT_BYTES, IMPORT_MEDIA_TYPES } = require('./infinite-canvas-client');

const MAX_IMAGE_PIXELS = 100 * 1024 * 1024;
const SHARP_FORMAT_TO_MIME = new Map([
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
]);

function createImportId() {
  return `imp_${crypto.randomBytes(16).toString('hex')}`;
}

function validateImportId(value) {
  return typeof value === 'string' && IMPORT_ID_RE.test(value);
}

function sameFileSnapshot(first, second) {
  const identityMatches = (!first.ino || !second.ino)
    || (first.ino === second.ino && first.dev === second.dev);
  return identityMatches
    && first.size === second.size
    && Math.trunc(first.mtimeMs) === Math.trunc(second.mtimeMs);
}

async function readAuthorizedSnapshot(resolved, roots) {
  const rootDir = roots[resolved.ref.rootId];
  let realRoot;
  let realTarget;
  try {
    [realRoot, realTarget] = await Promise.all([
      fs.promises.realpath(rootDir),
      fs.promises.realpath(resolved.absPath),
    ]);
  } catch (cause) {
    const err = new Error('导入文件在读取前已不可用');
    err.code = 'FILE_REF_VERSION_CHANGED';
    err.cause = cause;
    throw err;
  }
  if (!isPathWithin(realTarget, realRoot, { allowRoot: false })) {
    const err = new Error('导入文件不在授权目录内');
    err.code = 'FILE_REF_NOT_FOUND';
    throw err;
  }

  let handle;
  try {
    handle = await fs.promises.open(realTarget, 'r');
    const before = await handle.stat();
    if (!before.isFile() || !sameFileSnapshot(resolved.stats, before)) {
      const err = new Error('导入文件在读取前发生变化');
      err.code = 'FILE_REF_VERSION_CHANGED';
      throw err;
    }
    const buffer = await handle.readFile();
    const after = await handle.stat();
    if (buffer.length > MAX_IMPORT_BYTES || !sameFileSnapshot(before, after) || buffer.length !== after.size) {
      const err = new Error('导入文件在读取期间发生变化');
      err.code = 'FILE_REF_VERSION_CHANGED';
      throw err;
    }
    return buffer;
  } finally {
    if (handle) await handle.close();
  }
}

async function importAuthorizedImage({ fileRef, roots, client, publishClient }) {
  const resolved = await resolveFileRef(fileRef, roots);
  if (resolved.stats.size < 1 || resolved.stats.size > MAX_IMPORT_BYTES) {
    const err = new Error(`Infinite-Canvas 图片导入大小必须在 1 到 ${MAX_IMPORT_BYTES} 字节之间`);
    err.code = 'IMPORT_SIZE_LIMIT';
    throw err;
  }
  const declaredMime = getMimeType(resolved.absPath);
  if (!IMPORT_MEDIA_TYPES.has(declaredMime)) {
    const err = new Error('Infinite-Canvas 当前仅支持 JPEG、PNG、WebP 和 GIF 图片导入');
    err.code = 'UNSUPPORTED_IMPORT_TYPE';
    throw err;
  }

  const buffer = await readAuthorizedSnapshot(resolved, roots);
  let metadata;
  try {
    metadata = await sharp(buffer, {
      animated: true,
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'error',
    }).metadata();
  } catch (cause) {
    const err = new Error('导入文件不是可安全解码的受支持图片');
    err.code = 'INVALID_IMPORT_IMAGE';
    err.cause = cause;
    throw err;
  }
  const decodedMime = SHARP_FORMAT_TO_MIME.get(metadata.format);
  if (!decodedMime || decodedMime !== declaredMime) {
    const err = new Error('图片实际格式与文件扩展名不一致');
    err.code = 'IMPORT_TYPE_MISMATCH';
    throw err;
  }
  const pages = Math.max(1, Number.parseInt(metadata.pages, 10) || 1);
  const pixels = (metadata.width || 0) * (metadata.height || 0) * pages;
  if (!metadata.width || !metadata.height || pixels > MAX_IMAGE_PIXELS) {
    const err = new Error('图片解码尺寸超过安全限制');
    err.code = 'IMPORT_PIXEL_LIMIT';
    throw err;
  }

  const importId = createImportId();
  const imported = await client.importImage({
    importId,
    buffer,
    mediaType: decodedMime,
  });
  let canvasAsset = null;
  if (publishClient) {
    try {
      canvasAsset = await publishClient.uploadCanvasImage({
        buffer,
        mediaType: decodedMime,
        name: resolved.basename,
      });
    } finally {
      await client.deleteImport(importId).catch(() => {});
    }
  }
  return {
    importId,
    mediaType: decodedMime,
    size: imported.size,
    sha256: imported.sha256,
    width: metadata.width,
    height: metadata.height,
    pages,
    canvasAsset,
    staged: !publishClient,
  };
}

module.exports = {
  MAX_IMAGE_PIXELS,
  createImportId,
  validateImportId,
  readAuthorizedSnapshot,
  importAuthorizedImage,
};
