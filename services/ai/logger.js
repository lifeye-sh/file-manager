// Task execution logger: writes per-task log files and updates history.json.
const fs = require('fs');
const path = require('path');
const storage = require('./storage');

class TaskLogger {
  constructor(taskId) {
    this.taskId = taskId;
    const dirs = storage._getDirs();
    this.file = path.join(dirs.logs, `${taskId}.log`);
    this.lines = [];
  }
  append(level, step, message) {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const stepTag = step != null ? `[step ${step}]` : '';
    const line = `${ts} [${level.toUpperCase()}] ${stepTag} ${message}`;
    this.lines.push(line);
    try { fs.appendFileSync(this.file, line + '\n', 'utf-8'); } catch (_) {}
  }
  info(step, msg) { this.append('info', step, msg); }
  warn(step, msg) { this.append('warn', step, msg); }
  error(step, msg) { this.append('error', step, msg); }
  ok(step, msg) { this.append('ok', step, msg); }
  getLogText() {
    try { return fs.readFileSync(this.file, 'utf-8'); } catch (_) { return this.lines.join('\n'); }
  }
}

module.exports = { TaskLogger };