# frp 内网穿透部署指南

为 `file-manager` 项目提供 frp (Fast Reverse Proxy) 内网穿透方案，让外网用户可以访问部署在内网的 Web 文件管理器。

---

## 一、架构概览

```
┌──────────────┐         ┌──────────────────┐         ┌────────────────┐
│  外网用户     │ ───→   │  Linux VPS       │  ───→  │  Windows 内网   │
│  (浏览器)    │        │  (frps 服务端)    │ 隧道   │  (frpc 客户端)   │
│              │        │  端口: 8080/7000  │        │  web: 3000      │
└──────────────┘         └──────────────────┘         └────────────────┘

访问方式: http://你的域名:8080 或 http://VPS公网IP:8080
```

- **frps**: 运行在公网 VPS 上，接收外部请求
- **frpc**: 运行在内网 Windows 机器上，与 frps 建立加密隧道
- 数据流: 外网 → VPS:8080 → 加密隧道 → 内网:3000

---

## 二、版本信息

使用 **frp v0.69.1**（2026-06-01 发布），TOML 配置格式。

下载地址: https://github.com/fatedier/frp/releases/latest

---

## 三、服务端部署 (Linux VPS)

### 3.1 下载并安装

```bash
# SSH 登录到 VPS
ssh root@你的VPS公网IP

# 下载最新版本（替换为实际链接）
wget https://github.com/fatedier/frp/releases/download/v0.69.1/frp_0.69.1_linux_amd64.tar.gz

# 解压
tar -xzf frp_0.69.1_linux_amd64.tar.gz
cd frp_0.69.1_linux_amd64

# 目录内容说明
# frps        - 服务端程序
# frpc        - 客户端程序（服务器不需要，可删除）
# frps.toml   - 服务端配置模板
# frpc.toml   - 客户端配置模板
```

### 3.2 配置 frps.toml

将本项目 `frp/frps.toml` 复制到 VPS 上，或用以下最小配置：

```toml
bindPort = 7000

[auth]
method = "token"
token = "你的强密码_至少32位"

vhostHTTPPort = 8080

[webServer]
addr = "0.0.0.0"
port = 7500
user = "admin"
password = "你的Dashboard密码"

[log]
to = "./frps.log"
level = "info"
maxDays = 7
```

> 将 token 替换为你自己生成的强密码，建议使用 `openssl rand -hex 32` 生成

### 3.3 开放防火墙端口

```bash
# 如果使用 ufw
ufw allow 7000/tcp   # frps 通信端口
ufw allow 8080/tcp   # HTTP 转发端口
ufw allow 7500/tcp   # Dashboard 端口（可选，建议仅内网）

# 如果使用 firewalld (CentOS)
firewall-cmd --permanent --add-port=7000/tcp
firewall-cmd --permanent --add-port=8080/tcp
firewall-cmd --permanent --add-port=7500/tcp
firewall-cmd --reload

# 如果使用阿里云/腾讯云等，还需要在**安全组**中放行以上端口
```

### 3.4 启动服务端

```bash
# 前台运行（测试用）
./frps -c ./frps.toml

# 后台运行
nohup ./frps -c ./frps.toml > frps.log 2>&1 &

# 验证是否启动成功
curl http://localhost:7500
```

### 3.5 设置 systemd 开机自启（推荐）

```bash
sudo tee /etc/systemd/system/frps.service << 'EOF'
[Unit]
Description=frp Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/frp_0.69.1_linux_amd64
ExecStart=/root/frp_0.69.1_linux_amd64/frps -c /root/frp_0.69.1_linux_amd64/frps.toml
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable frps
sudo systemctl start frps

# 查看状态
sudo systemctl status frps

# 查看日志
sudo journalctl -u frps -f
```

---

## 四、客户端部署 (Windows 内网)

### 4.1 下载并解压

1. 打开 https://github.com/fatedier/frp/releases/latest
2. 下载 `frp_0.69.1_windows_amd64.zip`
3. 解压到任意目录，例如 `C:\frp\`

目录中需要的文件：
- `frpc.exe` - 客户端程序
- `frpc.toml` - 客户端配置（使用本项目提供的）

### 4.2 配置 frpc.toml

使用本项目 `frp/frpc.toml`，重点修改以下项：

```toml
serverAddr = "你的VPS公网IP"    # ← 必填
serverPort = 7000

[auth]
method = "token"
token = "你的强密码_至少32位"    # ← 必须与服务端一致

[[proxies]]
name = "file-manager-web"
type = "http"
localIP = "127.0.0.1"
localPort = 3000                  # ← 你的 file-manager 运行端口
customDomains = ["你的域名"]       # ← 可选，没有域名可删除此行
```

### 4.3 启动客户端

```powershell
# 方式1: 命令行直接运行
cd C:\frp
.\frpc.exe -c .\frpc.toml

# 方式2: 创建启动脚本 start.bat
@echo off
cd /d C:\frp
frpc.exe -c frpc.toml
pause
```

### 4.4 设置开机自启 (Windows)

**方法1: 使用 NSSM (推荐)**

```powershell
# 下载 NSSM: https://nssm.cc/download
# 以管理员身份运行:
nssm install frpc
# 在弹出的窗口中:
#   Path: C:\frp\frpc.exe
#   Arguments: -c C:\frp\frpc.toml
#   Start directory: C:\frp
nssm start frpc
```

**方法2: 使用任务计划程序**

```powershell
# 以管理员身份运行:
schtasks /create /tn "frpc" /tr "C:\frp\frpc.exe -c C:\frp\frpc.toml" /sc onstart /ru SYSTEM
```

---

## 五、验证连通性

### 5.1 查看 Dashboard

打开浏览器访问 `http://你的VPS_IP:7500`，输入 Dashboard 的用户名密码。

在 Dashboard 中可以看到：
- 客户端连接状态
- 代理状态（是否 online）
- 实时流量统计

### 5.2 测试访问

```bash
# 从外网或 VPS 上测试
curl http://你的VPS_IP:8080

# 看到 file-manager 的 HTML 响应即为成功
```

### 5.3 故障排查

```bash
# 查看服务端日志
journalctl -u frps -f

# 检查端口是否在监听
netstat -tlnp | grep -E '7000|8080|7500'

# 测试客户端连接（在 VPS 上）
telnet 你的VPS_IP 7000

# 确认 file-manager 在内网正常运行（在 Windows 上）
curl http://127.0.0.1:3000
```

---

## 六、进阶配置

### 6.1 绑定自己的域名

1. 在 DNS 服务商添加 A 记录，将你的域名指向 VPS IP
2. 修改 `frpc.toml` 中的 `customDomains` 为你的域名
3. 重启 frpc

外网用户就可以通过 `http://你的域名:8080` 访问了。

### 6.2 启用 HTTPS (推荐)

**方法1: frp 内置自动 HTTPS**

在 `frps.toml` 中添加：
```toml
vhostHTTPSPort = 8443
```

在 `frpc.toml` 中修改代理类型：
```toml
[[proxies]]
name = "file-manager-web"
type = "https"            # 改为 https
localIP = "127.0.0.1"
localPort = 3000
customDomains = ["你的域名"]
# frp 会自动申请 Let's Encrypt 证书
```

**方法2: Nginx 反代（更灵活）**

```nginx
server {
    listen 80;
    server_name 你的域名;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name 你的域名;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:6000;  # 假设 frp TCP 映射到 6000
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 6.3 加密隧道传输

在 `frps.toml` 和 `frpc.toml` 中都添加：

```toml
[transport]
tcpMux = true
```

这启用 TCP 多路复用，减少连接数并增加安全性。

---

## 七、安全建议

1. **Token 必须复杂**: 至少 32 位随机字符串，防止暴力破解
2. **限制 Dashboard 访问**: Dashboard 端口 (7500) 建议只对本地开放，或加防火墙规则
3. **开启白名单**: 在 `frps.toml` 中配置 `allowPorts` 限制客户端可用的远程端口
4. **定期更新**: frp 更新频繁，关注 https://github.com/fatedier/frp/releases
5. **日志监控**: 定期检查 frps.log，关注异常连接
6. **HTTPS 加固**: 生产环境务必启用 HTTPS，避免明文传输

---

## 八、常用命令速查

```bash
# 服务端 (Linux)
sudo systemctl start frps       # 启动
sudo systemctl stop frps        # 停止
sudo systemctl restart frps     # 重启
sudo systemctl status frps      # 查看状态
sudo journalctl -u frps -f      # 实时日志
sudo journalctl -u frps -n 50   # 最近50行日志

# 客户端 (Windows)
frpc.exe -c frpc.toml           # 启动
nssm start frpc                 # 启动服务
nssm stop frpc                  # 停止服务
nssm restart frpc               # 重启服务
```

---

## 配置文件位置

本项目提供的配置文件：
- `frp/frps.toml` - Linux VPS 服务端配置
- `frp/frpc.toml` - Windows 客户端配置

将这两个文件中的占位符替换为实际值即可使用。
