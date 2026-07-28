'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_AI_WORK_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'FileManager', 'AIWorkbench')
  : path.join(os.homedir(), '.file-manager', 'ai-workbench');

function normalizeForCompare(value) {
  const normalized = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function containsOrEquals(parent, child) {
  const parentValue = normalizeForCompare(parent);
  const childValue = normalizeForCompare(child);
  return childValue === parentValue || childValue.startsWith(`${parentValue}${path.sep}`);
}

function resolveWorkDir(workDir, projectRoot = path.join(__dirname, '..', '..')) {
  const value = String(workDir || DEFAULT_AI_WORK_DIR).trim();
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value);
}

function existingIdentity(value) {
  try {
    return fs.realpathSync.native(value);
  } catch (_) {
    return null;
  }
}

function assertSeparatedWorkDir(workDir, managedRoot, projectRoot) {
  const resolvedWorkDir = resolveWorkDir(workDir, projectRoot);
  const resolvedManagedRoot = path.resolve(managedRoot);
  const overlaps = containsOrEquals(resolvedManagedRoot, resolvedWorkDir)
    || containsOrEquals(resolvedWorkDir, resolvedManagedRoot);
  const workIdentity = existingIdentity(resolvedWorkDir);
  const rootIdentity = existingIdentity(resolvedManagedRoot);
  const identityOverlaps = workIdentity && rootIdentity
    && (containsOrEquals(rootIdentity, workIdentity) || containsOrEquals(workIdentity, rootIdentity));
  if (overlaps || identityOverlaps) {
    const err = new Error('AI 工作目录必须与文件管理根目录完全分离');
    err.code = 'AI_WORK_DIR_OVERLAPS_MANAGED_ROOT';
    throw err;
  }
  return resolvedWorkDir;
}

module.exports = {
  DEFAULT_AI_WORK_DIR,
  resolveWorkDir,
  assertSeparatedWorkDir,
};
