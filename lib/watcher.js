const fs = require('fs');
const path = require('path');

let watcher = null;
let listeners = new Set();
let pending = new Map(); // dirPath -> timer

function start(rootDir) {
  if (watcher) stop();
  try {
    watcher = fs.watch(rootDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const dirPath = path.dirname(path.join(rootDir, filename));
      schedule(dirPath.replace(/\\/g, '/'));
    });
  } catch (err) {
    console.error('[watcher] Failed to start:', err.message);
  }
}

function schedule(dirPath) {
  if (pending.has(dirPath)) clearTimeout(pending.get(dirPath));
  pending.set(dirPath, setTimeout(() => {
    pending.delete(dirPath);
    emit(dirPath);
  }, 2000));
}

function emit(dirPath) {
  listeners.forEach((fn) => {
    try { fn(dirPath); } catch (_) {}
  });
}

function stop() {
  if (watcher) { watcher.close(); watcher = null; }
  pending.forEach((t) => clearTimeout(t));
  pending.clear();
}

function onChange(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

module.exports = { start, stop, onChange };
