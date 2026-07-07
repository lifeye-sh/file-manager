# Web 文件管理器

基于 Node.js + Express 的 Web 文件管理器，支持目录浏览、文件预览、多媒体播放、缩略图生成、上传下载、增删改查，并内置用户认证与访问控制。可通过 frp 实现内网穿透，从外网安全访问本地文件。

---

## 目录

1. [功能特性](#功能特性)
2. [技术栈](#技术栈)
3. [目录结构](#目录结构)
4. [快速开始](#快速开始)
5. [配置说明](#配置说明)
6. [用户管理](#用户管理)
7. [API 接口](#api-接口)
8. [frp 内网穿透](#frp-内网穿透)
9. [安全说明](#安全说明)
10. [常见问题](#常见问题)

---

## 功能特性

- **目录浏览**：异步读取目录，文件夹与文件分离排序，显示大小与修改时间
- **文件预览**：图片、视频、音频、PDF、文本文件在线预览
- **缩略图**：图片自动生成 256px WebP 缩略图并缓存（依赖 sharp）
- **文件操作**：新建文件夹、重命名、删除、移动、保存文本文件
- **文件上传**：multipart 上传，带并发限制与请求体大小限制
- **用户认证**：基于 session + HttpOnly Cookie，PBKDF2-SHA256 密码哈希
- **密码修改**：登录后可在侧边栏点击“改密”修改当前账号密码
- **访问控制**：管理员与普通用户分离、IP 白名单、登录限流
- **CSRF 防护**：双 Cookie 提交模式（csrf_token + X-CSRF-Token）
- **安全响应头**：CSP、X-Frame-Options、Referrer-Policy 等

---

## 技术栈

- **后端**：Node.js 20+，Express 4
- **依赖**：
  - `express` — Web 框架
  - `sharp` — 图片缩略图（可选，未安装则缩略图接口不可用）
- **前端**：原生 HTML/CSS/JavaScript，无构建步骤
- **穿透**：frp v0.69+

---

## 目录结构

```
E:\AIAgents\claude\story2\file-manager/
├── server.js                  # 入口，仅负责装配中间件与路由
├── add-user.js                # 命令行添加用户脚本
├── config.json                # 运行时配置文件
├── users.json                 # 用户数据（自动创建）
├── .thumbcache/               # 缩略图缓存目录（自动创建）
├── package.json
├── public/                    # 前端静态资源
│   ├── index.html
│   ├── login.html
│   ├── app.js
│   └── style.css
├── config/                    # 配置加载模块
│   └── index.js
├── middleware/                # Express 中间件
│   ├── auth.js
│   ├── csrf.js
│   ├── security-headers.js
│   └── whitelist.js
├── routes/                    # 路由模块
│   ├── auth.js
│   ├── auth-admin.js
│   ├── browse-router.js
│   ├── browse.js
│   ├── config-api.js
│   ├── file-ops.js
│   └── thumb.js
├── services/                  # 业务逻辑
│   ├── thumbnail.js
│   └── user-service.js
└── utils/                     # 工具函数
    ├── cookies.js
    ├── mime.js
    └── path-utils.js
```

---

## 快速开始

### 1. 安装依赖

```powershell
cd E:\AIAgents\claude\story2\file-manager
npm install
```

### 2. 启动服务

```powershell
npm start
# 或
node server.js
```

首次启动会自动创建管理员账号 `yuming`，并在控制台打印临时密码。

### 3. 访问

```
http://localhost:3000
http://127.0.0.1:3000
```

用用户名 `yuming` 和临时密码登录，首次登录建议立即修改密码。

### 4. 指定根目录与端口

```powershell
node server.js --root="D:\MyFiles" --port=8080
```

或在 `config.json` 中修改 `root` 与 `port`。

---

## 配置说明

`config.json` 示例：

```json
{
  "root": "E:\\AIHuman",
  "port": 3000,
  "bind": ["0.0.0.0"],
  "whitelist": [],
  "cookieSecure": false,
  "trustedProxies": ["loopback", "127.0.0.1"]
}
```

| 字段 | 说明 |
|------|------|
| `root` | 文件根目录 |
| `port` | 监听端口 |
| `bind` | 监听地址数组，`0.0.0.0` 表示所有网卡 |
| `whitelist` | IP 白名单数组，空数组表示允许所有 |
| `cookieSecure` | Cookie 是否加 `Secure` 标志，HTTPS 反代场景建议 `true` |
| `trustedProxies` | Express `trust proxy` 配置，影响 `req.ip` 取值 |

配置修改后**需要重启服务**才能生效（除 `root` 与 `whitelist` 可通过 `/api/config` 热更新外）。

---

## 用户管理

### 命令行添加用户

```powershell
cd E:\AIAgents\claude\story2\file-manager
node add-user.js <用户名> <密码> [是否管理员]

# 示例
node add-user.js alice MyP@ssw0rd true   # 管理员
node add-user.js bob  MyP@ssw0rd        # 普通用户
```

用户名规则：字母开头，3-32 位，仅允许字母、数字、下划线。密码至少 6 位。

### 在页面修改密码

登录后，在左侧边栏用户名旁点击 **“改密”** 按钮，输入当前密码和新密码即可修改。修改成功后系统会提示并自动退出，需使用新密码重新登录。

### 通过 API 管理用户

登录管理员账号后，可调用以下接口：

- `GET /api/auth/users` — 列出所有用户
- `POST /api/auth/add-user` — 添加用户
- `POST /api/auth/delete-user` — 删除用户
- `POST /api/auth/change-password` — 修改当前用户密码

---

## API 接口

### 认证相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/csrf-token` | 获取 CSRF token（登录页自动调用） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/session` | 检查当前会话 |
| GET | `/api/auth/users` | 列出用户（admin） |
| POST | `/api/auth/add-user` | 添加用户（admin） |
| POST | `/api/auth/delete-user` | 删除用户（admin） |
| POST | `/api/auth/change-password` | 修改密码 |

### 文件操作

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/browse?path=` | 浏览目录 |
| GET | `/api/file?path=` | 下载/预览文件（支持 Range） |
| GET | `/api/thumb?path=` | 获取图片缩略图 |
| POST | `/api/mkdir` | 新建文件夹 |
| POST | `/api/rename` | 重命名 |
| POST | `/api/delete` | 删除文件/文件夹 |
| POST | `/api/move` | 移动文件/文件夹 |
| POST | `/api/save` | 保存文本文件 |
| POST | `/api/upload` | 上传文件 |

### 配置管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 获取配置（admin） |
| POST | `/api/config` | 修改配置（admin） |

---

## frp 内网穿透

项目已提供 frp v0.69+ 配置文件示例，分别位于：

- **服务端**：`frp/frps.toml`（部署在 Linux VPS）
- **客户端**：`frp/frpc.toml`（部署在 Windows 内网机器）

### 部署步骤

1. 在 VPS 上运行 frps：
   ```bash
   frps -c frps.toml
   ```

2. 在 Windows 内网机器运行 frpc：
   ```powershell
   frpc.exe -c frpc.toml
   ```

3. 将 frpc.toml 中的 `customDomains` 替换为你的域名，并解析到 VPS IP。

4. 外网通过 `http://你的域名:8099` 访问。

> 注意：当前 frps.toml 中 `vhostHTTPPort = 8099`，请与 frpc.toml 中的访问端口保持一致。

---

## 安全说明

- **默认管理员密码随机生成**，首次启动请查看控制台并立即修改。
- **管理员权限隔离**：敏感接口（用户管理、配置管理）仅管理员可访问。
- **登录限流**：同一 IP + 用户名 5 次失败锁定 5 分钟。
- **CSRF 防护**：除登录/登出外，所有状态变更请求需携带 `X-CSRF-Token` 头。
- **Cookie 安全**：默认开启 `HttpOnly`、`SameSite=Strict`、`Secure`（取决于 `cookieSecure`）。
- **路径安全**：所有文件操作经过 `safePath` 校验，禁止目录穿越。
- **CSP**：通过响应头限制外部资源加载，降低 XSS 风险。

---

## 常见问题

### 登录按钮无反应

- 检查浏览器 Console 是否有 CSP 报错。
- 检查是否使用了可能注入页面的浏览器扩展（如翻译插件），尝试无痕窗口。
- 确认 `config.json` 中 `cookieSecure` 与当前访问协议匹配：HTTP 访问时应为 `false`。

### 外网无法访问

- 检查 frpc 与 frps 是否都已启动并连接成功。
- 检查 VPS 防火墙是否放行 frp 通信端口（7000）和 HTTP 端口（8099）。
- 检查 `trustedProxies` 是否正确配置，否则限流会失效。

### 缩略图不生成

- 确认已安装 sharp：`npm install sharp`。
- 检查 `.thumbcache` 目录是否有写入权限。

---

## 快捷键

| 快捷键 | 说明 |
|--------|------|
| ← → | 全屏浏览时切换上/下一张图片 |
| R | 全屏浏览时旋转图片 90° |
| Esc | 关闭当前弹窗/菜单 |
| Ctrl+S | 文本编辑时保存 |
| Ctrl+Click | 多选文件 |
| 双击 | 打开文件夹 / 预览文件 / 还原图片缩放 |
| 滚轮 | 全屏浏览时缩放图片 |

---

## 许可证

本项目为内部使用工具，未指定开源许可证。
