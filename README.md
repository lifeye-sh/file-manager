# File Manager

基于 Web 的文件管理器，Liquid Glass 深色主题，支持多级目录浏览、缩略图网格、多媒体预览、拖拽移动、WebSocket 实时推送。

## 功能

- **玻璃质感 UI** — iOS 26 Liquid Glass 设计风格，纯黑深色系，backdrop-filter 毛玻璃效果，响应式布局
- **多级目录树** — 懒加载树与文件网格联动，面包屑导航 + Hash 路由支持浏览器前进后退
- **缩略图网格** — 图片服务端生成 256px WebP 缩略图并缓存，视频自动提取封面帧
- **懒加载** — 首屏 60 张卡片，滚动到接近底部自动加载下一批，IntersectionObserver 监测
- **图片全屏** — ← → 翻看目录内所有图片，滚轮缩放/拖拽平移，R 键旋转，双击还原
- **多媒体预览** — 视频、音频、文本（可编辑保存）、Markdown、PDF 在线预览
- **文件操作** — 新建文件夹、重命名、删除、移动、上传、批量重命名/移动/删除
- **拖拽移动** — 单文件或多选文件拖到文件夹或面包屑上直接移动
- **键盘操作** — Delete 键删除选中文件（带确认弹窗）、Shift+Click 范围选择、Ctrl+Click 多选、拖拽框选
- **实时推送** — WebSocket 监听目录变更，自动刷新当前视图
- **在线设置** — 根目录、端口、绑定地址、IP 白名单均可通过 Web 页面修改
- **配置加密** — config.json 使用 AES-256-GCM 加密存储（config.json.enc）
- **安全控制** — IP 白名单支持 CIDR，多地址绑定

## 快速启动

```bash
cd file-manager
npm install
node server.js
```

打开浏览器访问 `http://localhost:3000`

## 命令行参数

```
node server.js --root=/path/to/dir --port=8080 --bind=127.0.0.1
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--root` | 管理的根目录路径 | config 或当前目录 |
| `--port` | 服务端口 | config 或 3000 |
| `--bind` | 绑定地址，多个用逗号分隔 | config 或 0.0.0.0 |

优先级：命令行参数 > config.json.enc > 默认值

## 配置文件

配置通过 AES-256-GCM 加密存储为 `config.json.enc`，密钥由本机 hostname 派生，仅本机可解密。

首次运行时若存在旧版 `config.json` 明文文件，会自动读取并迁移为加密格式。

可通过 Web 设置页修改（齿轮图标）。

```json
{
  "root": "E:\\Files",
  "port": 3000,
  "bind": ["127.0.0.1", "192.168.1.100"],
  "whitelist": ["127.0.0.1", "192.168.1.0/24"]
}
```

| 字段 | 说明 |
|------|------|
| `root` | 管理的根目录绝对路径 |
| `port` | 服务端口（修改后需重启） |
| `bind` | 监听地址数组，`0.0.0.0` 表示所有网卡（修改后需重启） |
| `whitelist` | IP 白名单，支持 CIDR，留空允许所有。本地 IP 始终允许 |

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/browse?path=<path>` | 列出目录内容 |
| GET | `/api/file?path=<path>` | 获取文件（支持 Range 请求） |
| GET | `/api/thumb?path=<path>` | 获取图片缩略图（256px WebP，自动缓存） |
| POST | `/api/mkdir` | 创建文件夹 |
| POST | `/api/rename` | 重命名 |
| POST | `/api/delete` | 删除文件/文件夹 |
| POST | `/api/move` | 移动文件/文件夹 |
| POST | `/api/save` | 保存文本文件内容 |
| POST | `/api/upload` | 上传文件（multipart） |
| GET | `/api/config` | 获取配置（不含密钥） |
| POST | `/api/config` | 更新配置 |
| WS | `/` | WebSocket 目录变更推送 |

## 支持的文件类型

| 类型 | 扩展名 | 预览方式 |
|------|--------|----------|
| 图片 | jpg, png, gif, webp, bmp | 全屏浏览 + 翻页 + 旋转 + 缩略图 |
| 视频 | mp4, webm, ogg, mov, avi, mkv | HTML5 播放器 + 封面帧 |
| 音频 | mp3, wav, flac, aac, m4a, opus | HTML5 播放器 |
| 文本 | txt, md, json, js, py, html, css 等 | 行号代码查看 + 在线编辑 |
| PDF | pdf | PDF.js 在线查看 |

## 快捷键

| 快捷键 | 说明 |
|--------|------|
| ← → | 全屏浏览时切换上/下一张图片 |
| R | 全屏浏览时旋转图片 90° |
| Delete | 删除选中文件（弹窗确认） |
| Esc | 关闭当前弹窗/菜单 |
| Ctrl+S | 文本编辑时保存 |
| Ctrl+Click | 多选/取消选中文件 |
| Shift+Click | 范围选择（从上次点击到当前项） |
| 拖拽框选 | 鼠标拖拽矩形区域批量选中 |
| 拖拽到文件夹 | 移动文件到目标文件夹 |
| 双击 | 打开文件夹 / 预览文件 / 还原图片缩放 |
| 滚轮 | 全屏浏览时缩放图片 |
| 长按 | 触屏设备弹出右键菜单 |

## 目录结构

```
file-manager/
├── server.js              # 入口：HTTP 服务 + WebSocket
├── package.json
├── .thumbcache/           # 缩略图缓存（256px WebP）
├── config.json.enc       # 加密配置
├── README.md
├── lib/
│   ├── config.js          # 配置加载/加密存储
│   ├── whitelist.js       # IP 白名单 + CIDR
│   ├── safePath.js        # 路径安全校验
│   ├── thumbnail.js       # 缩略图生成（sharp）
│   ├── mime.js            # MIME 类型映射
│   ├── rateLimit.js       # 通用频率限制
│   └── watcher.js         # fs.watch 目录监听
├── routes/
│   └── api.js             # 全部 API 路由
└── public/
    ├── index.html         # 前端页面
    ├── style.css          # Liquid Glass 样式
    └── app.js             # 前端逻辑
```
