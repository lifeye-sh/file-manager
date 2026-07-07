const { hashPassword, loadUsers, saveUsers } = require('./services/user-service');

function printUsage() {
  console.log('用法：');
  console.log('  node add-user.js <用户名> <密码> [isAdmin]');
  console.log('示例：');
  console.log('  node add-user.js alice MyP@ssw0rd true');
  console.log('  node add-user.js bob  MyP@ssw0rd');
  process.exit(1);
}

async function main() {
  const [username, password, adminFlag] = process.argv.slice(2);

  if (!username || !password) {
    printUsage();
  }

  if (!/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(username)) {
    console.error('错误：用户名需以字母开头，3-32位，仅限字母数字和下划线');
    process.exit(1);
  }

  if (password.length < 6) {
    console.error('错误：密码至少需要6位');
    process.exit(1);
  }

  const users = loadUsers();
  if (users.find(u => u.username === username)) {
    console.error('错误：用户名已存在');
    process.exit(1);
  }

  const { hash } = hashPassword(password);
  const isAdmin = adminFlag === 'true' || adminFlag === '1';

  users.push({
    username,
    passwordHash: hash,
    isAdmin,
    createdAt: new Date().toISOString(),
  });

  await saveUsers(users);
  console.log(`用户 ${username} 已创建（admin: ${isAdmin}）`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
