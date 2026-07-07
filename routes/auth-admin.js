const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const {
  loadUsers,
  saveUsers,
  hashPassword,
  verifyPassword,
} = require('../services/user-service');

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: '需要管理员权限', code: 'FORBIDDEN' });
  }
  next();
}

router.get('/users', requireAdmin, (req, res) => {
  const users = loadUsers();
  const safeUsers = users.map(u => ({
    username: u.username,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
  }));
  res.json({ users: safeUsers });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const username = req.user.username;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '请填写当前密码和新密码' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: '新密码至少需要6位' });
  }

  const users = loadUsers();
  const userIndex = users.findIndex(u => u.username === username);
  if (userIndex === -1) return res.status(404).json({ error: '用户不存在' });

  if (!verifyPassword(currentPassword, users[userIndex].passwordHash)) {
    return res.status(401).json({ error: '当前密码错误' });
  }

  const { hash } = hashPassword(newPassword);
  users[userIndex].passwordHash = hash;
  if (users[userIndex].mustChangePassword) users[userIndex].mustChangePassword = false;
  await saveUsers(users);

  res.json({ success: true, message: '密码已更新' });
});

router.post('/add-user', requireAdmin, async (req, res) => {
  const { username, password, isAdmin } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '请填写用户名和密码' });
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(username)) {
    return res.status(400).json({ error: '用户名需以字母开头，3-32位，仅限字母数字和下划线' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少需要6位' });
  }

  const users = loadUsers();
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  const { hash } = hashPassword(password);
  users.push({
    username,
    passwordHash: hash,
    isAdmin: !!isAdmin,
    createdAt: new Date().toISOString(),
  });
  await saveUsers(users);

  console.log(`[auth] User created: ${username} (admin: ${!!isAdmin})`);
  res.json({ success: true, username, isAdmin: !!isAdmin });
});

router.post('/delete-user', requireAdmin, async (req, res) => {
  const { username } = req.body;
  const requestingUser = req.user.username;

  if (username === requestingUser) {
    return res.status(400).json({ error: '不能删除自己的账号' });
  }

  const users = loadUsers();
  const newUsers = users.filter(u => u.username !== username);
  if (newUsers.length === users.length) {
    return res.status(404).json({ error: '用户不存在' });
  }

  await saveUsers(newUsers);
  console.log(`[auth] User deleted: ${username}`);
  res.json({ success: true });
});

module.exports = router;
