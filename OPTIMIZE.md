# 代码优化方案

## 一、server.js — 后端

### 1. 架构分层 — 优先

> 当前问题：单个文件 820+ 行，认证、文件操作、配置管理、上传解析全部混在一起，难以测试和维护。

**方案**: 拆分为模块化结构

```
server.js                  # 入口：组装中间件和路由，仅 ~60 行
├── config/
│   └── index.js           # 配置加载/保存/验证（从 server.js 抽离）
├── middleware/
│   ├── auth.js            # 认证中间件 + session 管理
│   ├── whitelist.js       # IP 白名单中间件
│   └── error-handler.js   # 统一错误处理中间件
├── routes/
│   ├── auth.js            # /api/auth/* 路由
│   ├── browse.js          # /api/browse, /api/file, /api/thumb
│   ├── config-api.js      # /api/config
│   └── file-ops.js        # mkdir, rename, delete, move, save, upload
├── services/
│   ├── user-service.js    # 用户 CRUD（loadUsers/saveUsers/verifyPassword）
│   └── thumbnail.js       # 缩略图生成逻辑（从 server.js 抽离）
└── utils/
    ├── mime.js            # MIME 类型映射
    ├── path-utils.js      # safePath/tryDecode
    └── multipart.js       # multipart 解析器
```

**收益**: 可测试、可复用、新增功能只需加路由文件不碰已有代码。

---

### 2. 异步 — 优先

> 当前问题：大量 `fs.statSync`、`fs.existsSync`、`fs.readdirSync` 同步调用阻塞事件循环。浏览一个有 1000 个文件的大目录时，所有并发请求都会被阻塞。

**方案**: 全面换成异步 API，敏感路径使用 `fs.promises` 或 `require('fs/promises')`。

```js
// 当前：同步（阻塞）
entries.map(entry => {
  entryStats = fs.statSync(path.join(dirPath, entry.name));
});

// 优化：异步并行
const result = await Promise.all(entries.map(async (entry) => {
  let entryStats = null;
  try {
    entryStats = await fs.promises.stat(path.join(dirPath, entry.name));
  } catch (_) {}
  return { name: entry.name, type: ..., size: entryStats?.size || 0, ... };
}));
```

具体改动点：

**`/api/browse`**: `statSync` + `readdir` 回调 → `fs.promises.stat` + `fs.promises.readdir` + `Promise.all`

**`/api/thumb`**: `statSync`、`existsSync`、`readdirSync`、`unlinkSync` → 全改 async

**`/api/config POST`**: `fs.statSync` → `fs.promises.stat`

**`/api/save`**: `fs.existsSync` + `fs.writeFile` 回调 → `fs.promises.access` + `fs.promises.writeFile`

**`/api/rename`**: `fs.existsSync` × 2 + `fs.rename` 回调 → `fs.promises.access` + `fs.promises.rename`

**`/api/delete`、`/api/move`**: 同理。

另外 `loadUsers` / `saveUsers` 虽然 I/O 量小，但在高并发下 `writeFileSync` 仍有风险，建议加 `writeFile` 并使用简单的互斥锁。

```js
let userWriteQueue = Promise.resolve();
function saveUsers(users) {
  userWriteQueue = userWriteQueue.then(() =>
    fs.promises.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf-8')
  );
}
```

**收益**: 目录浏览速度提升 5-10 倍，高并发下不再阻塞。

---

### 3. `/api/browse` 目录信息缓存 — 可选

> 当前问题：同一目录每次请求都重新 stat 所有文件。如果用户来回切换目录，浪费大量 I/O。

**方案**: 在内存中缓存目录列表（Map），键为目录路径 + mtime，值 { entries, timestamp }。TTL 设为 5 秒，超过则刷新。

```js
const browseCache = new Map();
const BROWSE_CACHE_TTL = 5000;

// 在 /api/browse 中：
const cacheKey = `${dirPath}|${stats.mtimeMs}`;
const cached = browseCache.get(cacheKey);
if (cached && Date.now() - cached.ts < BROWSE_CACHE_TTL) {
  return res.json(cached.data);
}
// ... 读取并存入缓存
```

**收益**: 频繁切换目录时几乎零延迟。

---

### 4. 登录暴力破解防护 — 优先

> 当前问题：`/api/auth/login` 无任何限流，外网暴露后可以被无限重试。

**方案**: 基于 IP + 用户名的内存计数限流。

```js
const loginAttempts = new Map(); // key: ip:username, value: { count, lockUntil }

function checkLoginRateLimit(ip, username) {
  const key = `${ip}:${username}`;
  const record = loginAttempts.get(key);
  if (record && record.lockUntil > Date.now()) {
    return { blocked: true, retryAfter: Math.ceil((record.lockUntil - Date.now()) / 1000) };
  }
  return { blocked: false };
}

function recordLoginAttempt(ip, username) {
  const key = `${ip}:${username}`;
  const record = loginAttempts.get(key) || { count: 0, firstAttempt: Date.now() };
  record.count++;
  if (record.count >= 5) record.lockUntil = Date.now() + 300000; // 锁定5分钟
  loginAttempts.set(key, record);
}
```

在 `/api/auth/login` 中使用：
```js
const limit = checkLoginRateLimit(clientIP, username);
if (limit.blocked) {
  return res.status(429).json({ error: `尝试次数过多，请 ${limit.retryAfter} 秒后重试` });
}
// ... 验证密码
if (!user || !verifyPassword(...)) {
  recordLoginAttempt(clientIP, username);
  return res.status(401)...
}
// 登录成功时清除这个 key 的计数
loginAttempts.delete(`${clientIP}:${username}`);
```

**收益**: 防止暴力破解，外网安全的关键防线。

---

### 5. CSRF 防护 — 优先

> 当前问题：所有 POST API（config/save/mkdir/rename/delete/move/upload/auth）完全没有 CSRF 保护。通过 frp 暴露到公网后，恶意网站可以伪造请求。

**方案**: 使用 `SameSite=Strict` cookie + 自定义 header 双重验证。生成一个 CSRF token 存入 cookie（非 HttpOnly），前端读取后通过 `X-CSRF-Token` header 回传，后端校验。

或者，由于当前所有 POST 请求都走 `Content-Type: application/json`（不是 `application/x-www-form-urlencoded`），Browser 默认的 CORS preflight 已经有保护。最简方案是确保 `SameSite=Strict` 且依赖 CORS 保护。

建议一步到位：在 auth cookie 设置中加入 `SameSite=Strict`（当前是 `Lax`，对外网访问 Lax 不够安全），并添加 CSRF token 验证。

**收益**: 关键安全修复，尤其是文件删除和配置修改操作。

---

### 6. 请求体大小限制 — 优先

> 当前问题：`express.json()` 和 `express.urlencoded()` 没有设置 `limit`，默认无限制。攻击者可以发送超大 JSON 耗尽内存。

```js
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
```

---

### 7. helmet 安全头 — 可选

> 当前问题：缺少 Content-Security-Policy、X-Content-Type-Options、X-Frame-Options 等安全头。

**方案**: 不引入依赖，手动设置：

```js
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // 现代浏览器已废弃，显式关闭
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
```

---

## 二、public/app.js — 前端

### 8. DOM 引用集中初始化 — 可选

> 当前问题：`dom` 对象 138 行，全部在模块顶层用 `$()` / `$$()` 查询。page load 时一次性全部抓取，即使某些元素尚未渲染也会返回 null，且不可摇树。

**方案**: 保留 `$` / `$$` 工具函数，但移除 `dom` 对象，改为在使用处惰性获取。对热路径（如 `fileList`、`breadcrumb`）可以缓存一次。

```js
// 惰性获取 + 缓存（仅对频繁访问的元素）
let _cached = {};
function dom(key, sel) {
  if (!_cached[key]) _cached[key] = $(sel);
  const el = _cached[key];
  if (!el) _cached[key] = $(sel); // retry if DOM changed
  return _cached[key];
}
```

更简单的方案：保持 `dom` 对象但只保留确实在多个函数中使用的元素，删除只用了一两次的（如 `batchRenameMode`、`batchRenameArgs` 等 38 个批量重命名专用 DOM 引用）。

---

### 9. 事件监听器泄漏 — 优先

> 当前问题：多处使用 `replaceWith(cloneNode(true))` 来解绑事件（如 `dom.previewEdit`），这是反模式，且 clone 后重新 `$('#preview-edit')` 查询容易遗漏。

**方案**: 使用 `AbortController` 管理生命周期。

```js
let editController = null;

function enterEdit() {
  editController?.abort();
  editController = new AbortController();
  const { signal } = editController;

  saveBtn.addEventListener('click', saveEdit, { signal });
  cancelBtn.addEventListener('click', exitEdit, { signal });
  textarea.addEventListener('keydown', handleKeydown, { signal });
}

function exitEdit() {
  editController?.abort();
  editController = null;
}
```

不改当前复杂代码，也可以简单把 `dom.previewEdit` 的单次监听改为事件委托到父容器上，避免 clone。

---

### 10. 文件列表虚拟滚动 — 可选

> 当前问题：文件夹有 10000+ 文件时，渲染 10000 个 DOM 卡片的卡顿明显。虽然多数场景文件数不大，但作为通用工具应当容纳极端情况。

**方案**: 实现简单的高度估计 + 可视窗口渲染。

```js
const ROW_HEIGHT = 180; // 估计每行卡片高度
const BUFFER = 3;       // 上下缓冲行数

function renderFileListVirtual(entries) {
  const totalHeight = Math.ceil(entries.length / columnsPerRow) * ROW_HEIGHT;
  // 用 IntersectionObserver 或 scroll 事件确定可视范围
  // 只渲染 startIndex 到 endIndex 的条目
}
```

对于现有规模（百级别文件），当前方案够用。如果文件数经常超过 5000，值得投入。

---

## 三、public/style.css — 样式

### 11. CSS 变量统一定义 — 低优先

当前 OK，没有重复定义。唯一建议：用 `@layer` 管理级联优先级，方便后续迭代。

---

## 四、综合安全加固 — 优先

| 项 | 当前状态 | 建议 |
|----|---------|------|
| 密码存储 | PBKDF2-SHA256 ✅ | 建议升级到 Argon2id（需 native 模块，可不做） |
| Session 存储 | 服务端内存 | 重启丢失可接受，但应考虑 token 黑名单机制（logout 时标记） |
| CSRF | 无保护 ❌ | 见第5条 |
| 请求体限制 | 无限制 ❌ | 见第6条 |
| 安全响应头 | 缺失 ❌ | 见第7条 |
| 登录限流 | 无 ❌ | 见第4条 |
| 密码复杂度 | 仅 ≥6 位 | 建议 8 位+，包含大小写字母和数字 |
| 用户文件并发写 | 无锁 ❌ | `saveUsers` 加互斥队列（见第2条） |

---

## 五、优先级排序建议

| 优先级 | 条目 | 工作量 | 影响面 |
|--------|------|--------|--------|
| P0 | 4. 登录限流 | 30 行 | 外网安全 |
| P0 | 5. CSRF 防护 | 50 行 | 外网安全 |
| P0 | 6. 请求体大小限制 | 2 行 | 防 DoS |
| P1 | 2. 同步 I/O → 异步 | 全文件改动 | 性能 + 并发 |
| P1 | 7. 安全响应头 | 10 行 | 安全基线 |
| P2 | 1. 架构分层 | 一次性重写 | 可维护性 |
| P2 | 9. 事件监听器泄漏 | 局部改动 | 稳定性 |
| P3 | 3. 目录缓存 | 20 行 | 大目录性能 |
| P3 | 10. 虚拟滚动 | 200 行 | 极端场景 |
| P3 | 8. DOM 引用优化 | 局部改动 | 代码整洁 |

P0 涉及外网暴露后的安全底线，强烈建议立即实施。P1 可随下次迭代一起做。P2-P3 视实际需要逐步推进。
