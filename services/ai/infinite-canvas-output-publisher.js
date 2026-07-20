'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { fileVersion } = require('../file-ref-service');
const { isPathWithin } = require('../../utils/path-utils');

const MAX_OUTPUTS = 16;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);
const VIDEO_TYPES = new Map([
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/quicktime', 'mov'],
]);

function collectOutputRefs(value, refs = [], seen = new Set(), depth = 0) {
  if (depth > 12 || refs.length >= MAX_OUTPUTS || value === null || value === undefined) return refs;
  if (typeof value === 'string') {
    if ((value.startsWith('/output/') || value.startsWith('/assets/')
      || value.startsWith('/api/storage-files/output/')) && !seen.has(value)) {
      seen.add(value);
      refs.push(value);
    }
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectOutputRefs(item, refs, seen, depth + 1);
    return refs;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectOutputRefs(item, refs, seen, depth + 1);
  }
  return refs;
}

function hasMp4Signature(buffer) {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

function hasWebmSignature(buffer) {
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

async function validateMedia(buffer, declaredType) {
  if (IMAGE_TYPES.has(declaredType)) {
    try {
      const metadata = await sharp(buffer, { animated: false, limitInputPixels: 100_000_000 }).metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > 100_000_000) throw new Error('invalid dimensions');
      return { mediaType: declaredType, ext: IMAGE_TYPES.get(declaredType), width: metadata.width, height: metadata.height };
    } catch (err) {
      const error = new Error('Infinite-Canvas 返回了无效图片');
      error.code = 'INVALID_CANVAS_OUTPUT_MEDIA';
      throw error;
    }
  }
  if (declaredType === 'video/mp4' && hasMp4Signature(buffer)) return { mediaType: declaredType, ext: 'mp4' };
  if (declaredType === 'video/webm' && hasWebmSignature(buffer)) return { mediaType: declaredType, ext: 'webm' };
  if (declaredType === 'video/quicktime' && hasMp4Signature(buffer)) return { mediaType: declaredType, ext: 'mov' };
  const error = new Error('Infinite-Canvas 返回了不受支持或签名不匹配的媒体');
  error.code = 'INVALID_CANVAS_OUTPUT_MEDIA';
  throw error;
}

async function ensurePublishParent(rootDir) {
  const realRoot = await fs.promises.realpath(path.resolve(rootDir));
  const parent = path.join(realRoot, 'AI-Canvas');
  try {
    await fs.promises.mkdir(parent);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const stat = await fs.promises.lstat(parent);
  const realParent = await fs.promises.realpath(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isPathWithin(realParent, realRoot, { allowRoot: false })) {
    const error = new Error('AI-Canvas 发布目录不安全');
    error.code = 'UNSAFE_CANVAS_OUTPUT_DIR';
    throw error;
  }
  return { realRoot, parent: realParent };
}

async function publishCanvasOutputs({ taskId, result, client, rootDir }) {
  const refs = collectOutputRefs(result);
  if (!refs.length) return [];
  const { realRoot, parent } = await ensurePublishParent(rootDir);
  const finalDir = path.join(parent, taskId);
  const stagingDir = path.join(parent, `.${taskId}.staging-${crypto.randomBytes(8).toString('hex')}`);
  if (!isPathWithin(finalDir, realRoot, { allowRoot: false })
      || !isPathWithin(stagingDir, realRoot, { allowRoot: false })) {
    const error = new Error('AI-Canvas 发布路径越界');
    error.code = 'UNSAFE_CANVAS_OUTPUT_DIR';
    throw error;
  }
  await fs.promises.mkdir(stagingDir);
  const published = [];
  let totalBytes = 0;
  try {
    for (let index = 0; index < refs.length; index += 1) {
      const downloaded = await client.downloadCanvasOutput(refs[index], MAX_OUTPUT_BYTES);
      totalBytes += downloaded.buffer.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        const error = new Error('Infinite-Canvas 输出总大小超限');
        error.code = 'CANVAS_OUTPUT_TOTAL_TOO_LARGE';
        throw error;
      }
      const media = await validateMedia(downloaded.buffer, downloaded.contentType);
      const filename = `output-${String(index + 1).padStart(2, '0')}.${media.ext}`;
      const stagingFile = path.join(stagingDir, filename);
      await fs.promises.writeFile(stagingFile, downloaded.buffer, { flag: 'wx' });
      const stats = await fs.promises.stat(stagingFile);
      published.push({
        port: 'canvas',
        type: media.mediaType.startsWith('image/') ? 'image' : 'video',
        mediaType: media.mediaType,
        sourceRef: downloaded.sourcePath,
        fileRef: {
          rootId: 'main',
          path: path.relative(realRoot, path.join(finalDir, filename)).split(path.sep).join('/'),
          version: fileVersion(stats),
        },
        size: stats.size,
        width: media.width,
        height: media.height,
      });
    }
    await fs.promises.rename(stagingDir, finalDir);
    return published;
  } catch (err) {
    await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

module.exports = {
  collectOutputRefs,
  validateMedia,
  publishCanvasOutputs,
  MAX_OUTPUTS,
  MAX_OUTPUT_BYTES,
  MAX_TOTAL_BYTES,
};
