# File Manager

全新环境部署请先阅读：[Windows 完整安装说明](INSTALL.md)。

基于 Node.js、Express 和原生浏览器 JavaScript 的安全文件管理器，提供目录浏览、媒体预览、文件操作、用户认证、AI 工作流，以及通过受控网关嵌入的 Infinite Canvas。

## 主要能力

- 浏览托管根目录中的文件和文件夹。
- 图片缩略图、图片/音视频、文本、Markdown 和 PDF 预览。
- 上传、下载、新建目录、保存文本、重命名、移动和删除。
- 管理员与普通用户身份、会话失效、CSRF 防护和 IP 白名单。
- 版本化 AI 工作流、持久化任务队列、并发限制、取消和结果归档。
- Infinite Canvas 同源嵌入、认证 HTTP/WebSocket 网关和 ComfyUI 执行。
- 旧 AI 工作台回退入口，便于迁移和故障回滚。

## 环境要求

- Node.js 20+
- Python 3.10+（Infinite Canvas Sidecar）
- 可访问的 ComfyUI 实例
- Windows PowerShell（项目自带的调试栈脚本）

安装依赖：

```powershell
npm install
```

## 启动

仅启动文件管理器：

```powershell
npm start
```

或双击 `start.bat`。

启动文件管理器、Infinite Canvas Sidecar 和固定版本的上游：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\integrations\infinite-canvas\start-debug-stack.ps1 `
  -ComfyUiUrl http://192.168.3.34:8870
```

也可以双击 `start-ai.bat`。该入口调用同一个 PowerShell 启动器，由启动器生成仅存在于进程环境中的随机网关令牌，并在返回前执行健康检查。

可信局域网访问时，仅将 File Manager 网关监听到所有网卡：

```powershell
.\integrations\infinite-canvas\start-debug-stack.ps1 `
  -ComfyUiUrl 'http://192.168.3.34:8870' `
  -FileManagerBindAddress '0.0.0.0'
```

远程浏览器访问 `http://<服务端局域网 IP>:3000/ai-workbench.html`。不要开放或转发
`7862`、`7863`；详细的防火墙、白名单和安全要求见完整安装说明。

默认访问地址：

```text
http://127.0.0.1:3000
```

停止 Infinite Canvas 调试栈：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\integrations\infinite-canvas\stop-debug-stack.ps1
```

## 配置

运行配置保存在被 Git 忽略的 `config.json` 中。示例：

```json
{
  "root": "E:\\ManagedFiles",
  "port": 3000,
  "bind": ["127.0.0.1"],
  "whitelist": [],
  "trustedProxies": ["loopback", "127.0.0.1"],
  "aiWorkbench": {
    "enabled": true,
    "comfyuiUrl": "http://192.168.3.34:8870",
    "connectTimeoutMs": 5000,
    "execTimeoutMs": 1800000,
    "maxConcurrentTasks": 1,
    "keepResultsDays": 30,
    "workDir": "C:\\Users\\<user>\\AppData\\Local\\FileManager\\AIWorkbench",
    "infiniteCanvas": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:7862",
      "upstreamBaseUrl": "http://127.0.0.1:7863",
      "allowExecution": true,
      "requestTimeoutMs": 5000
    }
  }
}
```

AI 工作目录必须与文件管理托管根目录完全分离。服务端会同时检查规范化路径和已有目录的真实文件系统身份，拒绝重叠目录。

默认建议只绑定环回地址。当前版本的会话 Cookie `Secure` 标志在服务端固定为 `false`，配置文件中的同名字段不会生效，因此该调试配置不应直接暴露到公网。

## Infinite Canvas 架构

浏览器只访问 Express：

```text
Browser
  -> Express authentication / CSRF / endpoint policy
  -> project task scheduler
  -> loopback Infinite Canvas upstream
  -> configured ComfyUI
```

- Express 负责身份、文件授权、API 暴露、任务状态和结果发布。
- 原始执行接口不会通过通用代理转发，执行请求必须进入项目任务队列。
- WebSocket 仅开放经过认证的 `stats` 通道。
- 上游版本固定在 `integrations/infinite-canvas/upstream.json` 指定的提交。
- 文件导入使用受控 `fileRef` 或不透明 ID，不向浏览器或 Sidecar 提供任意主机路径。
- 旧工作台仍可通过 `/ai-workbench-legacy.html` 访问。

更详细的开发和运行说明见 [Infinite Canvas 集成文档](integrations/infinite-canvas/README.md)。

## 常用接口

认证：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/csrf-token` | 获取 CSRF 令牌 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/session` | 获取当前会话 |

文件：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/browse?path=` | 浏览目录 |
| GET | `/api/file?path=` | 预览或下载文件 |
| GET | `/api/thumb?path=` | 获取缩略图 |
| POST | `/api/upload` | 上传文件 |
| POST | `/api/mkdir` | 新建目录 |
| POST | `/api/save` | 保存文本 |
| POST | `/api/rename` | 重命名 |
| POST | `/api/move` | 移动 |
| POST | `/api/delete` | 删除 |

AI 与 Infinite Canvas：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ai/infinite-canvas/status` | Sidecar 和固定版本状态 |
| GET | `/api/ai/tasks/queue` | 项目任务队列状态 |
| POST | `/api/ai/infinite-canvas/imports` | 导入已授权文件引用 |
| GET | `/api/ai/canvas/upstream/` | Infinite Canvas 页面 |
| WS | `/api/ai/canvas/ws/stats` | 经过认证的实时状态 |

所有基于 Cookie 的状态变更请求均须携带 `X-CSRF-Token`。

## 验证

完整 Node.js 测试：

```powershell
npm test
```

Sidecar 测试：

```powershell
npm run test:sidecar
```

项目基线检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .agents\skills\file-manager-dev-agent\scripts\verify-project.ps1
```

涉及浏览器、Infinite Canvas 或 ComfyUI 的改动，还应在真实调试栈中检查登录、浏览器控制台、网络请求、WebSocket、任务状态和结果发布。

## 安全边界

- 所有文件操作必须保持在已授权托管根目录内。
- 禁止删除或替换托管根目录本身。
- 现有目标需要真实路径检查，以阻止符号链接和 Windows junction 逃逸。
- AI 输入、工作流、文件名、标识符、URL 和上游结果均视为不可信。
- Sidecar 和 Infinite Canvas 上游只绑定环回地址，并使用随机网关令牌。
- 凭据、用户数据、配置、缓存、日志和生成结果不得提交到源码仓库。

## 许可

本仓库未声明通用开源许可证。Infinite Canvas 的个人使用授权和固定上游信息记录在 `integrations/infinite-canvas/` 中；分发或部署前请重新确认各依赖和上游项目的许可义务。
