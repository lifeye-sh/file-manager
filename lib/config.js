const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const ENC_FILE = path.join(__dirname, '..', 'config.json.enc');

// Derive a 256-bit key from hostname + app secret
function deriveKey() {
  const hostname = require('os').hostname();
  const secret = 'fm-glass-2026-sealed';
  return crypto.createHash('sha256').update(hostname + ':' + secret).digest();
}

const ENC_ALGO = 'aes-256-gcm';

function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    tag: tag.toString('base64'),
  });
}

function decrypt(payload) {
  const key = deriveKey();
  const { iv, data, tag } = JSON.parse(payload);
  const decipher = crypto.createDecipheriv(ENC_ALGO, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  return decrypted.toString('utf-8');
}

function loadConfig() {
  // Try encrypted config first, then plaintext, then defaults
  for (const file of [ENC_FILE, CONFIG_FILE]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = file.endsWith('.enc') ? JSON.parse(decrypt(raw)) : JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) { /* try next */ }
  }
  return {};
}

function saveConfig(updates) {
  const current = loadConfig();
  const merged = { ...current, ...updates };
  const plaintext = JSON.stringify(merged, null, 2);
  fs.writeFileSync(ENC_FILE, encrypt(plaintext), 'utf-8');
  // Remove legacy plaintext if it exists
  try { if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE); } catch (_) {}
  return merged;
}

function normalizeBind(raw) {
  if (!raw) return ['0.0.0.0'];
  if (Array.isArray(raw)) return raw.map(s => String(s).trim()).filter(Boolean);
  return String(raw).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

// Mutable state — call setRoot/setPort/setBind/setWhitelist from routes
let ROOT_DIR, PORT, BIND_ADDRS, WHITELIST;

module.exports = {
  CONFIG_FILE,          // keep for backwards-compat reference
  ENC_FILE,
  loadConfig,
  saveConfig,
  normalizeBind,
  get root() { return ROOT_DIR; },
  set root(v) { ROOT_DIR = v; },
  get port() { return PORT; },
  set port(v) { PORT = v; },
  get bind() { return BIND_ADDRS; },
  set bind(v) { BIND_ADDRS = v; },
  get whitelist() { return WHITELIST; },
  set whitelist(v) { WHITELIST = v; },
};
