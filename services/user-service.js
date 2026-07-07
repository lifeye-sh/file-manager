const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', 'users.json');
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 1000;

const sessionStore = new Map();

// PBKDF2 password hashing
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return { salt, hash: salt + ':' + hash };
}

function verifyPassword(password, storedHash) {
  const parts = storedHash.split(':');
  if (parts.length < 2) return false;
  const [salt, hash] = parts;
  const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return hash === verify;
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
      return data.users || [];
    }
  } catch (_) {}
  return [];
}

let userWriteQueue = Promise.resolve();
function saveUsers(users) {
  userWriteQueue = userWriteQueue.then(async () => {
    await fs.promises.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf-8');
  }).catch(err => {
    console.error('[auth] saveUsers failed:', err.message);
    throw err;
  });
  return userWriteQueue;
}

async function createDefaultAdmin() {
  const tempPassword = crypto.randomBytes(12).toString('base64url');
  const { hash } = hashPassword(tempPassword);
  const users = [{
    username: 'yuming',
    passwordHash: hash,
    isAdmin: true,
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
  }];
  await saveUsers(users);
  console.log('========================================');
  console.log('[auth] Default admin user created: yuming');
  console.log('[auth] Temporary password (record and change on first login):', tempPassword);
  console.log('========================================');
}

function createSession(username, isAdmin) {
  if (sessionStore.size >= MAX_SESSIONS) {
    let oldestKey = null;
    let oldestExpires = Infinity;
    for (const [token, session] of sessionStore) {
      if (session.expiresAt < oldestExpires) {
        oldestExpires = session.expiresAt;
        oldestKey = token;
      }
    }
    if (oldestKey) sessionStore.delete(oldestKey);
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessionStore.set(token, { username, isAdmin: !!isAdmin, expiresAt: Date.now() + SESSION_MAX_AGE });
  return token;
}

function validateSession(token) {
  if (!token) return null;
  const session = sessionStore.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessionStore.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_MAX_AGE;
  return session;
}

function destroySession(token) {
  if (token) sessionStore.delete(token);
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessionStore) {
    if (now > session.expiresAt) sessionStore.delete(token);
  }
}, 5 * 60 * 1000);

module.exports = {
  hashPassword,
  verifyPassword,
  loadUsers,
  saveUsers,
  createDefaultAdmin,
  createSession,
  validateSession,
  destroySession,
  SESSION_MAX_AGE,
};
