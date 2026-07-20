const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-manager-session-'));
process.env.FILE_MANAGER_USERS_FILE = path.join(testDir, 'users.json');
const users = require('../services/user-service');

test.after(() => fs.rmSync(testDir, { recursive: true, force: true }));

function writeUsers(records) {
  fs.writeFileSync(users.USERS_FILE, JSON.stringify({ users: records }, null, 2));
}

test('sessions are invalidated after password, role, or existence changes', () => {
  const firstHash = users.hashPassword('password-one').hash;
  const baseUser = {
    username: 'alice',
    passwordHash: firstHash,
    isAdmin: false,
    createdAt: new Date().toISOString(),
  };

  writeUsers([baseUser]);
  const passwordToken = users.createSession('alice', false);
  assert.ok(users.validateSession(passwordToken));
  writeUsers([{ ...baseUser, passwordHash: users.hashPassword('password-two').hash }]);
  assert.equal(users.validateSession(passwordToken), null);

  writeUsers([baseUser]);
  const roleToken = users.createSession('alice', false);
  writeUsers([{ ...baseUser, isAdmin: true }]);
  assert.equal(users.validateSession(roleToken), null);

  writeUsers([baseUser]);
  const deletedToken = users.createSession('alice', false);
  writeUsers([]);
  assert.equal(users.validateSession(deletedToken), null);
});
