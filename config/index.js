const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (_) { /* corrupted config, use defaults */ }
  return {};
}

function saveConfig(config) {
  const current = loadConfig();
  const merged = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function normalizeBind(raw) {
  if (!raw) return ['0.0.0.0'];
  if (Array.isArray(raw)) return raw.map(s => String(s).trim()).filter(Boolean);
  return String(raw).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

const savedConfig = loadConfig();

module.exports = {
  loadConfig,
  saveConfig,
  normalizeBind,
  CONFIG_FILE,
  // Mutable runtime settings are managed in server.js, but defaults come from here
  initial: savedConfig,
};
