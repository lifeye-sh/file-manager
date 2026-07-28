# File Manager 完整安装说明（Windows）

本文适用于从全新 Windows 环境安装 File Manager、Infinite Canvas Sidecar、
固定版本的 Infinite Canvas 上游，以及连接本机或局域网中的 ComfyUI。

## 1. 运行架构

完整调试栈包含以下进程：

| 服务 | 默认地址 | 用途 |
|---|---|---|
| File Manager | `http://127.0.0.1:3000` | 登录、文件授权、任务队列和浏览器入口 |
| Sidecar | `http://127.0.0.1:7862` | 校验固定上游、受控文件导入 |
| Infinite Canvas 上游 | `http://127.0.0.1:7863` | 画布界面和上游 API |
| ComfyUI | 默认 `http://127.0.0.1:8870` | AI 工作流执行 |

浏览器只应访问 File Manager。端口 `7862` 和 `7863` 仅绑定环回地址，并要求
启动器生成的临时网关令牌，不应通过防火墙、frp 或反向代理公开。

## 2. 系统要求

- Windows 10 或 Windows 11。
- PowerShell 5.1 或更高版本。
- Git。
- Node.js 20 或更高版本（包含 npm）。
- Python 3.10 至 3.13。
- 已安装并可访问的 ComfyUI。
- 可访问 GitHub，用于获取项目代码和固定版本的 Infinite Canvas 压缩包。

检查环境：

```powershell
git --version
node --version
npm --version
py --version
```

如果存在多个 Python，请记录：

```powershell
py -0p
```

## 3. 获取项目

选择一个不用于管理用户文件的代码目录：

```powershell
cd D:\filemanager
git clone https://github.com/lifeye-sh/file-manager.git
cd .\file-manager
```

如果下载的是 GitHub ZIP，请解压后进入包含 `package.json` 和 `server.js` 的目录。

安装 Node.js 依赖：

```powershell
npm install
```

确认依赖完整：

```powershell
npm ls --depth=0
```

## 4. 创建 Python 虚拟环境

在项目根目录创建独立虚拟环境，避免系统 Python 和其他 AI 项目的依赖互相污染：

```powershell
py -3 -m venv .venv
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
```

激活后，`python` 应指向项目中的 `.venv`：

```powershell
(Get-Command python).Source
python --version
```

预期路径类似：

```text
D:\filemanager\file-manager\.venv\Scripts\python.exe
```

安装 Sidecar 依赖：

```powershell
python -m pip install --upgrade pip
python -m pip install `
  -r .\integrations\infinite-canvas\sidecar\requirements.txt
```

验证：

```powershell
python -c "import fastapi, uvicorn; print('Sidecar dependencies OK')"
```

> 每次打开新的 PowerShell 窗口后，都需要重新执行
> `.\.venv\Scripts\Activate.ps1`，再启动完整调试栈。

## 5. 下载并校验固定版本的 Infinite Canvas

项目不会跟随 Infinite Canvas 的 `main` 分支。必须使用
`integrations/infinite-canvas/upstream.json` 中记录的固定提交和 SHA-256。

在项目根目录、已激活虚拟环境的 PowerShell 中执行：

```powershell
$manifest = Get-Content -Raw `
  .\integrations\infinite-canvas\upstream.json |
  ConvertFrom-Json

$runtimeBase = Join-Path $env:LOCALAPPDATA 'FileManager\Infinite-Canvas'
$archive = Join-Path $runtimeBase "$($manifest.pinnedCommit).zip"
$extractBase = Join-Path $runtimeBase "upstream-archive-$($manifest.pinnedCommit)"
$sourceDir = Join-Path $extractBase $manifest.archiveRoot

New-Item -ItemType Directory -Force `
  -Path $runtimeBase, $extractBase |
  Out-Null

if (-not (Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest `
    -Uri "$($manifest.repository)/archive/$($manifest.pinnedCommit).zip" `
    -OutFile $archive
}

$actualHash = (
  Get-FileHash -LiteralPath $archive -Algorithm SHA256
).Hash.ToLowerInvariant()

if ($actualHash -ne $manifest.archiveSha256) {
  throw "Infinite Canvas archive SHA-256 mismatch. Actual: $actualHash Expected: $($manifest.archiveSha256)"
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'main.py'))) {
  Expand-Archive `
    -LiteralPath $archive `
    -DestinationPath $extractBase `
    -Force
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'main.py'))) {
  throw "Infinite Canvas main.py was not found under: $sourceDir"
}

Write-Host "Verified Infinite Canvas source: $sourceDir"
```

不要在 SHA-256 不匹配时继续安装。应删除损坏的下载文件后重新下载，并确认
`upstream.json` 来自可信项目提交。

## 6. 安装 Infinite Canvas 上游依赖

继续使用同一个虚拟环境：

```powershell
python -m pip install -r "$sourceDir\requirements.txt"
```

当前固定上游通常需要：

- FastAPI
- Uvicorn
- Requests
- Pydantic
- python-multipart
- HTTPX
- Pillow

验证主要模块：

```powershell
python -c "import fastapi, uvicorn, requests, pydantic, multipart, httpx, PIL; print('Infinite Canvas dependencies OK')"
```

## 7. 配置 ComfyUI 地址

### ComfyUI 与 File Manager 在同一台机器

```text
http://127.0.0.1:8870
```

### ComfyUI 在局域网的另一台机器

例如：

```text
http://192.168.3.34:8870
```

远程 ComfyUI 必须监听可被局域网访问的地址，并在 Windows 防火墙中允许对应端口。
从 File Manager 机器检查：

```powershell
$comfyUiUrl = 'http://192.168.3.34:8870'
Invoke-RestMethod "$comfyUiUrl/system_stats" -TimeoutSec 10
```

如果这里无法连接，先修复 ComfyUI 的监听地址、主机防火墙或网络路由，再启动
Infinite Canvas。不要把 File Manager 的 `127.0.0.1` 当作另一台机器。

## 8. 配置文件管理目录

运行配置保存在 Git 忽略的 `config.json` 中。建议明确设置托管目录，并确保
AI 工作目录不在托管目录内部：

```json
{
  "root": "D:\\ManagedFiles",
  "port": 3000,
  "bind": ["127.0.0.1"],
  "whitelist": [],
  "trustedProxies": ["loopback", "127.0.0.1"],
  "aiWorkbench": {
    "enabled": true,
    "comfyuiUrl": "http://127.0.0.1:8870",
    "connectTimeoutMs": 5000,
    "execTimeoutMs": 1800000,
    "maxConcurrentTasks": 1,
    "keepResultsDays": 30,
    "workDir": "C:\\Users\\YOUR_USER\\AppData\\Local\\FileManager\\AIWorkbench",
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

注意：

- `root` 是用户能够浏览和操作的文件根目录。
- `aiWorkbench.workDir` 用于任务、日志、工作流和结果元数据。
- 两个目录不得相同，也不得互相包含。
- `config.json`、`users.json`、`.env`、日志和运行结果不得提交到 Git。
- 默认只绑定 `127.0.0.1`。需要局域网访问时，必须先规划防火墙、可信代理、
  IP 白名单和 HTTPS，再修改监听地址。

## 9. 启动完整调试栈

确认虚拟环境仍处于激活状态：

```powershell
(Get-Command python).Source
```

本机 ComfyUI：

```powershell
.\integrations\infinite-canvas\start-debug-stack.ps1 `
  -ComfyUiUrl 'http://127.0.0.1:8870'
```

远程 ComfyUI：

```powershell
.\integrations\infinite-canvas\start-debug-stack.ps1 `
  -ComfyUiUrl 'http://192.168.3.34:8870'
```

也可以使用：

```powershell
.\start-ai.bat
```

`start-ai.bat` 使用脚本中配置的 ComfyUI 地址。需要其他地址时，建议直接执行
PowerShell 启动命令。

启动器会：

1. 停止 PID 文件中记录的旧调试进程。
2. 创建临时的随机网关令牌。
3. 仅对本次 File Manager 进程强制启用环回 Infinite Canvas 网关，不改写
   `config.json`。
4. 启动 Sidecar、固定上游和 File Manager。
5. 等待三个服务和 Express 网关配置通过健康检查。
6. 将 PID 和日志写入 `%LOCALAPPDATA%\FileManager\Infinite-Canvas`。

成功后访问：

```text
http://127.0.0.1:3000
```

Infinite Canvas 入口：

```text
http://127.0.0.1:3000/ai-workbench.html
```

不要直接使用 `http://127.0.0.1:7862` 或 `http://127.0.0.1:7863`。直接访问返回
未授权是正常的安全行为。

### 从局域网中的另一台机器访问

远程浏览器只能访问 File Manager 网关，不能访问或转发 `7862`、`7863`。在服务端
使用以下命令启动：

```powershell
.\integrations\infinite-canvas\start-debug-stack.ps1 `
  -ComfyUiUrl 'http://192.168.3.34:8870' `
  -FileManagerBindAddress '0.0.0.0'
```

查询服务端局域网 IPv4 地址：

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.AddressState -eq 'Preferred'
  } |
  Select-Object InterfaceAlias, IPAddress
```

然后在远程机器访问：

```text
http://<File Manager 服务端局域网 IP>:3000/ai-workbench.html
```

安全要求：

- Windows 防火墙只允许可信局域网来源访问 TCP `3000`。
- 不要为 `7862`、`7863` 创建防火墙放行、端口映射或 frp 隧道。
- 必须先通过 File Manager 登录；直接访问上游返回
  `GATEWAY_AUTH_REQUIRED` 是预期行为。
- 如果 `config.json` 配置了 `whitelist`，需要加入远程客户端 IP。
- 该 HTTP 调试方式仅适合可信局域网；跨互联网访问应使用经过安全评审的 HTTPS
  反向代理或 VPN。

## 10. 首次登录

当 `users.json` 不存在时，File Manager 会生成临时管理员账号。完整调试栈使用
隐藏进程，因此临时密码位于：

```text
%LOCALAPPDATA%\FileManager\Infinite-Canvas\file-manager.out.log
```

查看日志：

```powershell
Get-Content `
  (Join-Path $env:LOCALAPPDATA 'FileManager\Infinite-Canvas\file-manager.out.log')
```

使用日志中显示的用户名和临时密码登录，并立即修改密码。不要把密码复制到
README、脚本、`config.json`、工作流 JSON 或 Git。

## 11. 健康检查

File Manager：

```powershell
Invoke-WebRequest `
  -UseBasicParsing `
  'http://127.0.0.1:3000/api/csrf-token'
```

ComfyUI：

```powershell
Invoke-RestMethod `
  'http://127.0.0.1:8870/system_stats' `
  -TimeoutSec 10
```

Sidecar 和上游必须通过 File Manager 的已登录页面检查，因为它们受网关令牌和
会话保护。登录后打开 Infinite Canvas，确认画布出现且浏览器控制台没有连接错误。

## 12. 停止服务

```powershell
.\integrations\infinite-canvas\stop-debug-stack.ps1
```

该脚本只停止运行目录中 PID 文件记录的调试进程。

## 13. 日志位置

```text
%LOCALAPPDATA%\FileManager\Infinite-Canvas\sidecar.out.log
%LOCALAPPDATA%\FileManager\Infinite-Canvas\sidecar.err.log
%LOCALAPPDATA%\FileManager\Infinite-Canvas\upstream.out.log
%LOCALAPPDATA%\FileManager\Infinite-Canvas\upstream.err.log
%LOCALAPPDATA%\FileManager\Infinite-Canvas\file-manager.out.log
%LOCALAPPDATA%\FileManager\Infinite-Canvas\file-manager.err.log
```

查看最近错误：

```powershell
$base = Join-Path $env:LOCALAPPDATA 'FileManager\Infinite-Canvas'
Get-Content (Join-Path $base 'sidecar.err.log') -Tail 50
Get-Content (Join-Path $base 'upstream.err.log') -Tail 50
Get-Content (Join-Path $base 'file-manager.err.log') -Tail 50
```

## 14. 常见故障

### `ModuleNotFoundError: No module named 'uvicorn'`

原因：启动器调用的 Python 没有安装 Sidecar 依赖。

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install `
  -r .\integrations\infinite-canvas\sidecar\requirements.txt
```

确认 `(Get-Command python).Source` 指向 `.venv\Scripts\python.exe`。

### `FileNotFoundError ... upstream-archive-<commit>`

原因：固定版本的 Infinite Canvas 尚未下载或没有解压到规定的运行目录。

重新执行“下载并校验固定版本的 Infinite Canvas”章节。不要将任意 `main`
分支副本改名后放入该目录。

### `ModuleNotFoundError` 出现在 `upstream-runner.py`

原因：Sidecar 依赖已安装，但固定上游的依赖尚未安装。

```powershell
python -m pip install -r "$sourceDir\requirements.txt"
```

### `A debug stack process exited before becoming healthy`

这是汇总错误，不是根因。查看同一错误输出中 `sidecar.err`、`upstream.err` 和
`file-manager.err` 的第一段异常，或读取日志文件。

### `INFINITE_CANVAS_DISABLED`

不要单独执行 `npm start` 来启动完整调试栈。先停止旧进程，再使用项目启动器，
确保 Express、Sidecar 和固定上游共享同一组临时运行配置：

```powershell
.\integrations\infinite-canvas\stop-debug-stack.ps1
.\integrations\infinite-canvas\start-debug-stack.ps1 `
  -ComfyUiUrl 'http://127.0.0.1:8870'
```

成功启动后，`file-manager.out.log` 中应包含
`Infinite Canvas gateway: enabled`。

### ComfyUI 连接失败

- 本机 ComfyUI 使用 `127.0.0.1`。
- 远程 ComfyUI 使用真实局域网 IP。
- 确认 ComfyUI 监听外部地址。
- 检查 Windows 防火墙和端口。
- 先用 `/system_stats` 测试，不要直接尝试生成任务。

### 端口 `3000`、`7862` 或 `7863` 被占用

先使用项目停止脚本：

```powershell
.\integrations\infinite-canvas\stop-debug-stack.ps1
```

检查监听进程：

```powershell
netstat -ano |
  Select-String ':3000|:7862|:7863'
```

确认 PID 确实属于旧 File Manager 调试栈后，再由管理员决定是否停止；不要盲目
终止其他应用。

### PowerShell 禁止运行脚本

仅对当前窗口放开：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

不需要修改整台机器的永久执行策略。

### `npm` 或 Node.js 模块错误

```powershell
npm install
npm ls --depth=0
```

## 15. 更新项目

停止调试栈并备份 `config.json`、`users.json` 和 AI 工作目录，然后：

```powershell
git pull --ff-only
npm install
.\.venv\Scripts\Activate.ps1
python -m pip install `
  -r .\integrations\infinite-canvas\sidecar\requirements.txt
```

如果 `upstream.json` 中的提交或哈希发生变化，重新执行固定上游下载、校验和依赖
安装步骤。不要静默复用旧上游，也不要直接跟随 `main`。

更新后运行：

```powershell
npm test
npm run test:sidecar
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .agents\skills\file-manager-dev-agent\scripts\verify-project.ps1
```

## 16. 备份与回滚

建议备份：

- `config.json`
- `users.json`
- `%LOCALAPPDATA%\FileManager\AIWorkbench`
- 托管文件根目录

回滚 Infinite Canvas 时：

1. 停止调试栈。
2. 在配置中关闭 `aiWorkbench.infiniteCanvas.enabled`。
3. 启动普通 File Manager。
4. 使用 `/ai-workbench-legacy.html` 访问旧工作台。

不要在没有备份时删除 `%LOCALAPPDATA%\FileManager` 或托管文件根目录。

## 17. 生产部署提醒

`start-debug-stack.ps1` 面向本机开发和验收，不是生产启动器。当前版本的会话
Cookie `Secure` 标志在服务端固定为 `false`；在修复并验证该限制前，不应将本项目
直接暴露到公网。

规划生产部署时至少还需要：

- HTTPS 反向代理。
- 可生效且经过测试的安全 Cookie 和可信代理配置。
- 最小化 IP 白名单。
- 防火墙禁止公网访问 `7862`、`7863` 和 ComfyUI。
- 独立、随机、已轮换的 frp token 与 Dashboard 密码。
- 定期备份用户、配置、任务元数据和托管文件。
- 重新确认 Infinite Canvas 及依赖项目的许可证和分发义务。
