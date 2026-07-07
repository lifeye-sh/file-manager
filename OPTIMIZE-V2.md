# 代码优化方案 v2

> 本文档整合 v1 的全部建议与 v2 复核新发现的问题，按严重度重新排定优先级。
> 复核基线：v1 已实施登录限流、CSRF 防护、请求体限制、安全响应头四项 P0。
> 复核结论：v1 之外仍有若干严重遗漏，其中**管理员授权缺失**与**上传 OOM** 比 v1 已做项更关键。

---

## 优先级总览

| 优先级 | 条目 | 类型 | 工作量 | 影响面 | 状态 |
|--------|------|------|--------|--------|------|
| **P0+** | A1. admin 授权中间件覆盖敏感路由 | 安全漏洞 | 20 行 | 越权/提权 | ✅ 已实施 |
| **P0+** | A2. `/api/upload` 流式解析或下调 limit | DoS 防护 | 中 | 进程 OOM | ✅ 已实施（limit 100MB + 并发上限 2） |
| **P0** | A3. CSP 安全头 | 安全基线 | 数行 | XSS 缓解 | ✅ 已实施 |
| **P0** | A4. `trust proxy` 配合反代 | 限流正确性 | 数行 | 限流失效 | ✅ 已实施 |
| **P0** | A5. Cookie 加 `Secure`（可配置） | 传输安全 | 数行 | cookie 泄露 | ✅ 已实施 |
| **P0** | A6. 默认口令改随机生成 | 弱口令 | 小 | 首登入风险 | ✅ 已实施 |
| P1 | B1. thumb 路由全异步化 | 性能 | 局部 | 大目录卡顿 | ✅ 已实施 |
| P1 | B2. browse statSync → Promise.all | 性能 | 局部 | 大目录卡顿 | ✅ 已实施 |
| P1 | B3. 文件操作 existsSync 预检改 async access | 性能 | 局部 | 并发阻塞 | ✅ 已实施 |
| P1 | B4. saveUsers 加互斥队列 | 并发安全 | 10 行 | 用户文件损坏 | ✅ 已实施 |
| P1 | B5. 前端 document mousemove/mouseup 泄漏修复 | 内存泄漏 | 局部 | 长时间使用 | ✅ 已实施 |
| P1 | B6. 前端 CSRF 403 自动刷新 token | 体验 | 小 | 过期需手动刷新 | ✅ 已实施 |
| P2 | C1. 前端 DocumentFragment 批量插入 | 性能 | 3 行 | 大目录渲染 | ✅ 已实施 |
| P2 | C2. 错误信息统一不回显内部路径 | 信息泄露 | 局部 | 攻击者侦察 | ✅ 已实施 |
| P2 | C3. sessionStore 容量上限与淘汰 | 内存 | 小 | 长期运行 | ✅ 已实施 |
| P2 | C4. authFetch Headers 简化 | 代码整洁 | 小 | 可读性 | ✅ 已实施 |
| P2 | C5. 路径穿越显式拒绝 `..` | 防御深度 | 小 | 兜底加固 | ✅ 已实施 |
| P3 | D1. 架构分层（routes/services/utils） | 可维护性 | 大 | 长期迭代 | ✅ 已实施 |
| P3 | D2. 虚拟滚动 | 极端性能 | 200 行 | 10000+ 文件 | ⏳ 未实施 |
| P3 | D3. DOM 引用惰性化 | 代码整洁 | 局部 | 可摇树 | ⏳ 未实施 |
| P3 | D4. 事件监听器 clone 反模式改 AbortController | 稳定性 | 局部 | 代码健康 | ⏳ 未实施 |
| P3 | D5. 图片预览 document 级监听器重构 | 稳定性 | 局部 | 代码健康 | ✅ 已实施（B5 同根，泄漏已修复） |

---

# 第一部分：安全（P0+ 与 P0）

## A1. 管理员授权中间件 — P0+ 严重漏洞

**现状**：以下路由注释标注“admin only”但代码无任何 `req.user.isAdmin` 校验，任何已登录用户（含通过 `add-user` 创建的普通账号）可调用：

| 路由 | 位置 | 风险 |
|------|------|------|
| `POST /api/auth/add-user` | server.js:519 | 普通用户可创建新用户并设 `isAdmin: true`，直接提权 |
| `POST /api/auth/delete-user` | server.js:551 | 可删除他人账号 |
| `GET /api/auth/users` | server.js:481 | 可枚举所有用户名/创建时间 |
| `POST /api/config` | server.js:776 | 可改 `root` 为 `C:\\` 越权读整盘；改 `whitelist=[]` 放开外网 |
| `GET /api/config` | server.js:766 | 泄露 root/port/bind/whitelist |

**方案**：新增 `requireAdmin` 中间件，套用到上述五条路由。

```js
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

// 仅 admin 可访问
app.get('/api/auth/users', requireAdmin, (req, res) => { ... });
app.post('/api/auth/add-user', requireAdmin, (req, res) => { ... });
app.post('/api/auth/delete-user', requireAdmin, (req, res) => { ... });
app.get('/api/config', requireAdmin, (_req, res) => { ... });
app.post('/api/config', requireAdmin, (req, res) => { ... });
```

注意 `req.user.isAdmin` 字段在 `createSession` 时只存了 `username`，需在 `requireAdmin` 里 `loadUsers().find(u => u.username === req.user.username)` 取 `isAdmin`，或在 `validateSession` 时一并存入 session。

---

## A2. `/api/upload` 流式解析或下调 limit — P0+ DoS

**现状**：

```js
// server.js:1023
app.post('/api/upload', express.raw({ type: 'multipart/form-data', limit: '2gb' }), ...);
```

整个 multipart body 缓冲进单个 Buffer，`parseMultipart` 再切片到 `files[].buffer`。多个并发上传即可吃光 RAM 进程崩溃。

**短期方案**（不改依赖）：下调 limit 并限制并发。

```js
const uploadLimit = '100mb';
let uploadInProgress = 0;
const UPLOAD_CONCURRENCY = 2;

app.post('/api/upload', express.raw({ type: 'multipart/form-data', limit: uploadLimit }), (req, res, next) => {
  if (uploadInProgress >= UPLOAD_CONCURRENCY) {
    return res.status(503).json({ error: '上传并发数过多，请稍后重试' });
  }
  uploadInProgress++;
  res.on('finish', () => { uploadInProgress--; });
  next();
}, (req, res) => { ... });
```

**长期方案**：改用 `busboy` 流式解析，边读边写盘，内存仅缓冲单文件元数据。

```js
const Busboy = require('busboy');
app.post('/api/upload', (req, res) => {
  const bb = Busboy({ headers: req.headers, limits: { fileSize: 100 * 1024 * 1024 } });
  bb.on('file', (name, file, info) => {
    const dest = path.join(uploadDir, info.filename);
    file.pipe(fs.createWriteStream(dest));
  });
  bb.on('finish', () => res.json({ success: true }));
  req.pipe(bb);
});
```

---

## A3. Content-Security-Policy — P0

**现状**：已设 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`X-XSS-Protection`、`Permissions-Policy`，但缺 CSP。v1 OPTIMIZE 第 7 条原文点名缺 CSP，未落地。

**方案**：自托管文件管理器至少需要放宽图片与媒体源。

```js
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data: blob:; " +
    "media-src 'self' blob:; " +
    "style-src 'self' 'unsafe-inline'; " +   // 内联样式必需
    "script-src 'self'; " +
    "frame-src 'self' https://mozilla.github.io; " +  // pdf.js
    "connect-src 'self'"
  );
  next();
});
```

注意 pdf.js viewer 当前从 `mozilla.github.io` iframe 加载，对应 `frame-src` 须放行；如改自托管则去掉。

---

## A4. `trust proxy` 配合反向代理 — P0

**现状**：server.js:421 `req.ip || req.socket.remoteAddress`。frp/nginx 反代后所有请求 `req.ip` 都是代理 IP，登录限流退化为单一全局计数，合法用户互相挤兑。

**方案**：在 frp 部署链路下显式信任代理头。

```js
// 信任本机回环与 frp VPS 出口 IP（按实际部署调整）
app.set('trust proxy', ['loopback', '182.92.67.143']);
// 或更宽松：信任所有代理（适合多级反代）
// app.set('trust proxy', true);
```

同时在 frpc.toml 确保 `proxyProtocolVersion = "v2"`（已配置），frp 服务端透传 PROXY protocol 后 Express 才能拿到真实 IP。

---

## A5. Cookie 加 `Secure` — P0

**现状**：`setAuthCookie`（server.js:318）与 `setCsrfCookie`（server.js:328）都未设 `Secure`。frp 反代即使前端 HTTPS，到 node 这段也是明文，cookie 在内网链路裸传。

**方案**：做成配置开关，HTTPS 反代场景下开启。

```js
const COOKIE_SECURE = savedConfig.cookieSecure !== false; // 默认 true，开发环境显式设 false

function setAuthCookie(res, token) {
  const parts = [
    'auth_token=' + token,
    'Path=/', 'HttpOnly', 'SameSite=Strict',
    'Max-Age=' + (SESSION_MAX_AGE / 1000),
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
```

config.json 增加 `"cookieSecure": false` 字段供本地开发关闭。

进阶：用 `__Host-` 前缀（`__Host-auth_token`）获得更严格前缀防护——需 Path=/、Secure、无 Domain，目前条件已满足。

---

## A6. 默认口令改随机生成 — P0

**现状**：server.js:208 `hashPassword('a1030293')` 首次启动写入 users.json。用户不改密即外网暴露可凭弱口令登入。

**方案**：

```js
function createDefaultAdmin() {
  const tempPassword = crypto.randomBytes(12).toString('base64url');
  const { hash } = hashPassword(tempPassword);
  const users = [{
    username: 'yuming',
    passwordHash: hash,
    isAdmin: true,
    mustChangePassword: true,   // 标记首次登录强制改密
    createdAt: new Date().toISOString(),
  }];
  saveUsers(users);
  console.log('========================================');
  console.log('[auth] 默认管理员账号: yuming');
  console.log('[auth] 临时密码（请记录后立即登录修改）:', tempPassword);
  console.log('========================================');
}
```

并在登录成功时检查 `mustChangePassword`，前端引导到改密页。

---

# 第二部分：性能（P1）

## B1. thumb 路由全异步化

**现状**：每次生成缩略图都全表扫描 `.thumbcache` 并 sync 删文件。

| 调用 | 位置 | 性质 |
|------|------|------|
| `fs.statSync(filePath)` | 684 | 热路径 |
| `fs.statSync(cacheFile)` | 700 | 热路径 |
| `fs.existsSync(cacheFile)` | 709 | 热路径 |
| `fs.readdirSync(THUMB_CACHE_DIR)` | 726 | **最严重**：缓存膨胀后阻塞全局 |
| `fs.unlinkSync(...)` | 729 | 在 readdirSync 循环内 sync 删除 |
| `fs.renameSync(tmpFile, cacheFile)` | 753 | 阻塞事件循环 |

**方案**：全部改 `fs.promises.*`。

```js
let stats;
try { stats = await fs.promises.stat(filePath); } catch { return res.status(404)... }
if (!stats.isFile()) return res.status(404)...
if (stats.size > THUMB_MAX_INPUT_SIZE) return res.status(400)...

const hash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 16);
const cacheKey = `${hash}_${String(stats.mtimeMs)}`;
const cacheFile = path.join(THUMB_CACHE_DIR, `${cacheKey}.webp`);

const serveCachedFile = async () => {
  const cacheStats = await fs.promises.stat(cacheFile);
  res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': cacheStats.size, 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(cacheFile).pipe(res);
};

try { await fs.promises.access(cacheFile); return await serveCachedFile(); } catch {}

// 清理旧缓存（异步，不阻塞响应）
fs.promises.readdir(THUMB_CACHE_DIR).then(files => {
  return Promise.all(files.filter(f => f.startsWith(hash + '_') && f !== path.basename(cacheFile))
    .map(f => fs.promises.unlink(path.join(THUMB_CACHE_DIR, f)).catch(() => {})));
}).catch(() => {});

const tmpFile = cacheFile + '.tmp';
sharp(filePath, { animated: false })
  .resize(THUMB_WIDTH, undefined, { withoutEnlargement: true, fit: 'inside' })
  .webp({ quality: 80 })
  .toFile(tmpFile, async (err) => {
    if (err) { try { await fs.promises.unlink(tmpFile); } catch {} return res.status(500)... }
    try { await fs.promises.rename(tmpFile, cacheFile); }
    catch (e) { return res.status(500)... }
    await serveCachedFile();
  });
```

---

## B2. `/api/browse` statSync → Promise.all

**现状**：server.js:588-601 `entries.map` 内 `fs.statSync` 同步阻塞，1000 文件即冻结所有并发请求。

```js
// 优化后
const result = await Promise.all(entries.map(async (entry) => {
  let entryStats = null;
  try { entryStats = await fs.promises.stat(path.join(dirPath, entry.name)); }
  catch (_) {}
  return {
    name: entry.name,
    type: entry.isDirectory() ? 'directory' : 'file',
    size: entryStats?.size || 0,
    mtime: entryStats?.mtime.toISOString() || null,
    birthtime: entryStats?.birthtime.toISOString() || null,
  };
}));
const filtered = result.filter(e => e.mtime !== null);
```

---

## B3. 文件操作 existsSync 预检改 async access

`/api/mkdir`、`/api/rename`、`/api/delete`、`/api/move`、`/api/save` 都有 `fs.existsSync` sync 预检。统一改：

```js
async function pathExists(p) {
  try { await fs.promises.access(p); return true; }
  catch { return false; }
}

if (await pathExists(newPath)) return res.status(409).json({ error: '文件夹已存在' });
```

---

## B4. saveUsers 加互斥队列

**现状**：server.js:204 `fs.writeFileSync` 在并发 add-user/delete-user/change-password 下可能写出残缺文件。

```js
let userWriteQueue = Promise.resolve();
function saveUsers(users) {
  userWriteQueue = userWriteQueue.then(() =>
    fs.promises.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf-8')
  ).catch(err => console.error('[auth] saveUsers failed:', err.message));
  return userWriteQueue;
}
```

注意调用处需改为 `await saveUsers(users)`。

---

## B5. 前端 document mousemove/mouseup 泄漏修复 — P1

**现状**：app.js:1050/1060 每次 `renderImagePreview` 都在 `document` 上 `addEventListener('mousemove'/'mouseup', ...)`，闭包持有 `dragging/posX/posY/img/wrapper`。`closePreview` 只 `removeEventListener('resize')`，不动这两条。开图次数越多，document 上死监听器越多。

**方案**：改在 `wrapper` 上注册 mousemove/mouseup，或用 AbortController 一次性管理。

```js
let previewListeners = null;

function clearPreviewListeners() {
  if (previewListeners) { previewListeners.abort(); previewListeners = null; }
}

function renderImagePreview(entry) {
  clearPreviewListeners();
  previewListeners = new AbortController();
  const { signal } = previewListeners;

  // mousemove/mouseup 改用 signal 注册到 document（仍需全局拖拽）
  document.addEventListener('mousemove', handler, { signal });
  document.addEventListener('mouseup', handler, { signal });
  // closePreview 内调用 clearPreviewListeners()
}
```

或在 wrapper 解绑时一并清理：

```js
const cleanup = () => {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  window.removeEventListener('resize', onResize);
};
// 存入 state._imageNav.cleanup = cleanup;  closePreview 调用
```

---

## B6. 前端 CSRF 403 自动刷新 token — P1

**现状**：`authFetch` 只处理 401，CSRF token 失效（403）后用户必须手动刷新页面。

**方案**：

```js
async function authFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  let res = await _origFetch(url, await applyAuth(options, method));

  // 401：会话过期 → 跳登录
  if (res.status === 401) { /* 现有逻辑 */ }

  // 403：CSRF 失效 → 刷一次 token 重试一次
  if (res.status === 403 && ['POST','PUT','PATCH','DELETE'].includes(method) && _csrfToken) {
    const newToken = await fetchCsrfToken();
    if (newToken) {
      res = await _origFetch(url, await applyAuth(options, method));   // 重试一次
    }
  }
  return res;
}

async function applyAuth(options, method) {
  const opts = { ...options, credentials: options.credentials || 'same-origin' };
  if (['POST','PUT','PATCH','DELETE'].includes(method)) {
    opts.headers = new Headers(opts.headers || {});
    if (_csrfToken) opts.headers.set('X-CSRF-Token', _csrfToken);
  }
  return opts;
}
```

---

# 第三部分：稳健性优化（P2）

## C1. 前端 DocumentFragment 批量插入

app.js:362-490 每张卡片单独 `appendChild`，1000 文件触发 1000 次回流。

```js
function renderFileList(entries) {
  dom.fileList.innerHTML = '';
  if (entries.length === 0) { ... return; }
  const frag = document.createDocumentFragment();
  entries.forEach((entry) => {
    const card = document.createElement('div');
    // ... 构建 card
    frag.appendChild(card);
  });
  dom.fileList.appendChild(frag);   // 单次回流
  ...
}
```

零风险、3 行改动、纯收益。

---

## C2. 错误信息统一不回显内部路径

`err.message` 直接拼到响应：`mkdir`(928)、`rename`(954)、`delete`(970)、`move`(999)、`save`(1016)、`upload`(1047)。`err.message` 常含绝对路径或权限原因。

**方案**：返回通用文案，`err.message` 仅写日志。

```js
fs.mkdir(newPath, { recursive: true }, (err) => {
  if (err) {
    console.error('[mkdir]', newRelPath, err);    // 服务端日志完整
    return res.status(500).json({ error: '创建文件夹失败' });  // 客户端通用
  }
  res.json({ success: true });
});
```

---

## C3. sessionStore 容量上限与淘汰

`sessionStore` 无上限。攻击者可持有大量未过期会话（24h TTL）撑大内存。

```js
const MAX_SESSIONS = 1000;
function createSession(username) {
  if (sessionStore.size >= MAX_SESSIONS) {
    // 淘汰最早过期的
    let oldest = null, oldestKey = null;
    for (const [k, s] of sessionStore) {
      if (!oldest || s.expiresAt < oldest) { oldest = s.expiresAt; oldestKey = k; }
    }
    if (oldestKey) sessionStore.delete(oldestKey);
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessionStore.set(token, { username, expiresAt: Date.now() + SESSION_MAX_AGE });
  return token;
}
```

或更简单：定期 `setInterval` 中按 `expiresAt` 排序砍掉超量部分。

---

## C4. authFetch Headers 简化

app.js:60-78 现有逻辑绕，含死代码。

```js
function authFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const opts = { ...options, credentials: options.credentials || 'same-origin' };
  if (['POST','PUT','PATCH','DELETE'].includes(method)) {
    opts.headers = new Headers(opts.headers || {});
    if (_csrfToken) opts.headers.set('X-CSRF-Token', _csrfToken);
  }
  return _origFetch(url, opts).then(async (res) => {
    if (res.status === 401) {
      try { if ((await res.clone().json()).code === 'UNAUTHORIZED') redirectToLogin(); } catch {}
    }
    return res;
  });
}
```

---

## C5. 路径穿越显式拒绝 `..`

`safePath` 已通过 `path.resolve + 前缀比对` 兜底防穿越，但 `safeName` 仅 strip 危险字符未拒绝 `..`。建议显式拒绝：

```js
function sanitizeName(name) {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '').trim();
  if (cleaned === '..' || cleaned === '.' || cleaned === '') return null;
  return cleaned;
}
// 调用处：const safeName = sanitizeName(newName); if (!safeName) return res.status(400)...
```

---

# 第四部分：可维护性与极端场景（P3）

## D1. 架构分层

当前 server.js 820+ 行，认证、文件操作、配置、上传解析全混在一起。拆分建议：

```
server.js                  # 入口，仅 ~60 行
├── config/
│   └── index.js           # 配置加载/保存/验证
├── middleware/
│   ├── auth.js            # 认证 + session + admin
│   ├── csrf.js
│   ├── whitelist.js
│   ├── security-headers.js
│   └── error-handler.js
├── routes/
│   ├── auth.js            # /api/auth/*
│   ├── browse.js          # /api/browse, /api/file, /api/thumb
│   ├── config-api.js      # /api/config
│   └── file-ops.js        # mkdir, rename, delete, move, save, upload
├── services/
│   ├── user-service.js    # 用户 CRUD
│   └── thumbnail.js       # 缩略图生成
└── utils/
    ├── mime.js
    ├── path-utils.js       # safePath/tryDecode/sanitizeName
    └── multipart.js
```

收益：可测试、可复用、新增功能只加路由文件不碰已有代码。

## D2. 文件列表虚拟滚动

10000+ 文件时渲染卡顿。实现高度估计 + 可视窗口渲染（IntersectionObserver），仅渲染可视 + 上下缓冲行。对当前规模（百级别文件）收益有限，超过 5000 文件值得投入。

## D3. DOM 引用惰性化

app.js dom 对象 78 个引用在模块顶层一次性 `$()` 求值，不可摇树。批量重命名专用 7 个引用中 4 个只用一次。改为惰性查询缓存：

```js
let _cached = {};
function dom(key, sel) {
  if (!_cached[key]) _cached[key] = $(sel);
  return _cached[key];
}
```

## D4. 事件监听器 clone 反模式

`replaceWith(cloneNode(true))` 共 3 处（previewEdit ×2 在 1309/1397，dialogConfirm 在 2034）。改用 AbortController 管理生命周期，或在 close 时手动 `removeEventListener`。

订正 v1 描述：批量重命名专用引用实为 7 个（v1 称“38 个”系夸大）；dom 对象实为 78 个引用跨 77 行（v1 称“138 行”系行数引用数混淆）。结论方向正确，数字需订正。

## D5. 图片预览 document 级监听器重构

与 B5 同根，拆为独立项是因为 B5 是泄漏（功能正确），D5 是后续重构机会——把图片预览的拖拽缩放改为将监听器挂到 `wrapper` 上随 DOM 销毁自动回收，避免依赖 manual cleanup。

---

# 附录：v1 已实施项复核结论

| v1 条目 | 状态 | 复核结论 |
|---------|------|----------|
| 4. 登录限流 | ✅ 已实施 | 中间件顺序、计数/锁定逻辑正确；Set-Cookie 改 appendHeader 后无覆盖问题。遗留问题：反代下 req.ip 失效（见 A4） |
| 5. CSRF 防护 | ✅ 已实施 | 双重提交、crumb cookie 非 HttpOnly、login/logout 排除均合理。前端需补 403 自动刷 token（见 B6） |
| 6. 请求体限制 | ✅ 已实施 | express.json/urlencoded 10mb 正确；upload 路由 2gb 见 A2 单独风险 |
| 7. 安全响应头 | ⚠️ 部分 | 4 项已设 + Permissions-Policy 额外加项；缺 CSP 见 A3 |

---

# 实施顺序建议

**第一波（P0+ 与 P0，预计 1-2 小时）**

1. A1 admin 中间件 — 20 行，最严重漏洞
2. A3 CSP — 数行
3. A4 trust proxy — 数行
4. A5 Cookie Secure — 数行
5. A6 默认口令随机化 — 小

**第二波（P0+ 重度，单独排期）**

- A2 upload 改流式 — 需引入 busboy 或下 limit + 并发控制

**第三波（P1 性能，随下次迭代）**

- B1/B2/B3 同步 → 异步
- B4 saveUsers 互斥
- B5 前端监听器泄漏
- B6 前端 403 自动刷 token

**第四波（P2-P3 视需要推进）**

- C1-C5 稳健性
- D1-D5 可维护性与极端场景

强烈建议先做 A1（admin 授权缺失是当前真正的安全洞，比已完成的 CSRF/限流更关键）。A2 单独排期是因为流式落地需要测试，可先用 C2 长期方案前的“下调 limit + 限并发”过渡。