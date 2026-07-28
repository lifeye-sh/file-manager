// AI workbench storage helpers: manages the AI workbench directory tree
// and JSON persistence for workflows / node-defs / history.
// workDir is resolved dynamically from config.json; resolution + mkdir
// results are cached by config.json mtime so hot-path reads don't re-stat.
const fs = require('fs');
const path = require('path');
const { isValidAiId, requireAiId } = require('../../utils/identifiers');
const { DEFAULT_AI_WORK_DIR, resolveWorkDir } = require('./work-dir-policy');

const ROOT_DIR = path.join(__dirname, '..', '..');
const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');

// --- workDir resolution cache (keyed by config.json mtime) ---
let _cfgMtime = null;
let _workDir = DEFAULT_AI_WORK_DIR;
let _resolved = null;       // resolved absolute workDir
let _dirs = null;            // { root, workflows, nodeDefs, results, logs, jobs }
let _historyFilePath = null; // absolute path to history.json
let _dirsEnsured = false;    // whether ensureDirs ran for current _resolved

function _readWorkDirFresh() {
  try {
    const stat = fs.statSync(CONFIG_FILE);
    const mtime = stat.mtimeMs;
    if (_cfgMtime === mtime && _resolved) return; // cache hit
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const cfg = JSON.parse(raw);
    _workDir = (cfg.aiWorkbench && cfg.aiWorkbench.workDir) || DEFAULT_AI_WORK_DIR;
    _resolved = _resolve(_workDir);
    _dirs = {
      root: _resolved,
      workflows: path.join(_resolved, 'workflows'),
      nodeDefs: path.join(_resolved, 'node-defs'),
      results: path.join(_resolved, 'results'),
      logs: path.join(_resolved, 'logs'),
      presets: path.join(_resolved, 'presets'),
      jobs: path.join(_resolved, 'jobs'),
    };
    _historyFilePath = path.join(_resolved, 'history.json');
    _dirsEnsured = false; // new workDir -> need ensureDirs
    _cfgMtime = mtime;
  } catch (_) {
    _workDir = DEFAULT_AI_WORK_DIR;
    _resolved = resolveWorkDir(_workDir, ROOT_DIR);
    _dirs = {
      root: _resolved,
      workflows: path.join(_resolved, 'workflows'),
      nodeDefs: path.join(_resolved, 'node-defs'),
      results: path.join(_resolved, 'results'),
      logs: path.join(_resolved, 'logs'),
      presets: path.join(_resolved, 'presets'),
      jobs: path.join(_resolved, 'jobs'),
    };
    _historyFilePath = path.join(_resolved, 'history.json');
    _dirsEnsured = false;
    _cfgMtime = null;
  }
}

function _resolve(wd) {
  return resolveWorkDir(wd, ROOT_DIR);
}

function _getWorkDir() {
  _readWorkDirFresh();
  return _workDir;
}

function _getDirs() {
  _readWorkDirFresh();
  return _dirs;
}

function _historyFile() {
  _readWorkDirFresh();
  return _historyFilePath;
}

// Initial snapshots (used at startup, before any mutation)
_readWorkDirFresh();
const DIRS = _dirs;
const HISTORY_FILE = _historyFilePath;

function ensureDirs() {
  _readWorkDirFresh();
  if (_dirsEnsured) return; // already prepared for this workDir
  const d = _dirs;
  try {
    for (const key of Object.keys(d)) {
      fs.mkdirSync(d[key], { recursive: true });
    }
    _dirsEnsured = true;
  } catch (err) {
    console.error(`[ai] Failed to create directory structure under "${d.root}": ${err.message}`);
  }
  try {
    if (!fs.existsSync(_historyFilePath)) {
      fs.writeFileSync(_historyFilePath, JSON.stringify({ tasks: [] }, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error(`[ai] Failed to initialize history file "${_historyFilePath}": ${err.message}`);
  }
}

// Force re-resolution on next ensureDirs (called after settings save changes workDir)
function invalidateWorkDir() {
  _cfgMtime = null;
  _resolved = null;
  _dirsEnsured = false;
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch (_) { return fallback; }
}

function writeJSONAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

// Generic list/get/save/delete — dynamically resolved directory so workDir changes take effect
function _dir(key) { return _getDirs()[key]; }
function listDir(key) {
  ensureDirs();
  const dir = _dir(key);
  const out = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const data = readJSON(path.join(dir, f), null);
      if (data) out.push(data);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[ai] Failed to list "${dir}": ${err.message}`);
    }
  }
  return out;
}
function getDoc(key, id) {
  if (!isValidAiId(id)) return null;
  ensureDirs();
  return readJSON(path.join(_dir(key), id + '.json'), null);
}
function saveDoc(key, doc) {
  requireAiId(doc && doc.id);
  ensureDirs();
  writeJSONAtomic(path.join(_dir(key), doc.id + '.json'), doc);
}
function deleteDoc(key, id) {
  if (!isValidAiId(id)) return false;
  try { fs.unlinkSync(path.join(_dir(key), id + '.json')); return true; }
  catch (_) { return false; }
}

const workflows = {
  list: () => listDir('workflows'),
  get: (id) => getDoc('workflows', id),
  save: (doc) => saveDoc('workflows', doc),
  remove: (id) => deleteDoc('workflows', id),
};
const nodeDefs = {
  list: () => listDir('nodeDefs'),
  get: (id) => getDoc('nodeDefs', id),
  save: (doc) => saveDoc('nodeDefs', doc),
  remove: (id) => deleteDoc('nodeDefs', id),
};
// Shared presets (keyed by name; filename sanitized)
function _safeName(n) { return String(n).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80); }
const presets = {
  list: () => {
    ensureDirs();
    const dir = _dir('presets');
    const out = [];
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const data = readJSON(path.join(dir, f), null);
        if (data) out.push(data);
      }
    } catch (_) {}
    return out;
  },
  get: (name) => { ensureDirs(); return readJSON(path.join(_dir('presets'), _safeName(name) + '.json'), null); },
  save: (doc) => { ensureDirs(); writeJSONAtomic(path.join(_dir('presets'), _safeName(doc.name) + '.json'), doc); },
  remove: (name) => { try { fs.unlinkSync(path.join(_dir('presets'), _safeName(name) + '.json')); return true; } catch (_) { return false; } },
};

const jobs = {
  list: () => listDir('jobs'),
  get: (id) => getDoc('jobs', id),
  save: (doc) => saveDoc('jobs', doc),
  remove: (id) => deleteDoc('jobs', id),
};

// Task history (history.json) — index of task executions
function loadHistory() {
  ensureDirs();
  return readJSON(_historyFile(), { tasks: [] });
}
function saveHistory(history) {
  ensureDirs();
  writeJSONAtomic(_historyFile(), history);
}
function pruneHistory(history) {
  const { isTerminal } = require('./task-state');
  let terminalCount = 0;
  history.tasks = history.tasks.filter(record => {
    if (!isTerminal(record.status)) return true;
    terminalCount += 1;
    return terminalCount <= 200;
  });
  return history;
}
function addTaskRecord(record) {
  requireAiId(record && record.id, 'task');
  const h = loadHistory();
  h.tasks.unshift(record);
  saveHistory(pruneHistory(h));
}
function updateTaskRecord(id, patch) {
  requireAiId(id, 'task');
  const h = loadHistory();
  const idx = h.tasks.findIndex(t => t.id === id);
  if (idx === -1) { h.tasks.unshift(patch); }
  else { h.tasks[idx] = { ...h.tasks[idx], ...patch }; }
  saveHistory(pruneHistory(h));
}
function transitionTaskRecord(id, nextStatus, patch = {}) {
  const { assertTransition } = require('./task-state');
  const current = getTaskRecord(id);
  if (!current) {
    const err = new Error(`AI task not found: ${id}`);
    err.code = 'TASK_NOT_FOUND';
    throw err;
  }
  assertTransition(current.status, nextStatus);
  updateTaskRecord(id, { ...patch, id, status: nextStatus });
  return getTaskRecord(id);
}
function getTaskRecord(id) {
  if (!isValidAiId(id, 'task')) return null;
  return loadHistory().tasks.find(t => t.id === id) || null;
}

function genId(prefix) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${rand}`;
}

module.exports = {
  ensureDirs, DIRS, ROOT_DIR,
  _getDirs, _historyFile, invalidateWorkDir,
  workflows, nodeDefs, presets, jobs,
  loadHistory, saveHistory, addTaskRecord, updateTaskRecord, transitionTaskRecord, getTaskRecord,
  readJSON, writeJSONAtomic, genId,
};
