# Web File Manager

基于 Web 的文件管理器，支持多级目录浏览、文件列表、多媒体文件在线预览。

## 功能

- 多级目录树浏览（懒加载），树与文件列表联动
- 图片显示缩略图（服务端生成 WebP，原体积 1/50~1/100），视频自动生成封面
- 图片、视频、音频、文本、PDF 在线预览
- 文件名实时搜索过滤，支持按名称/修改时间/创建时间/大小排序
- 面包屑导航 + Hash 路由（浏览器前进后退）
- Web 页面设置（根目录、端口、绑定地址、白名单），持久化到 config.json
- IP 白名单 + 多 IP 绑定，访问安全控制
- 暗色主题，响应式布局

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
| `--root` | 管理的根目录路径 | config.json 或当前目录 |
| `--port` | 服务端口 | config.json 或 3000 |
| `--bind` | 绑定地址，多个用逗号分隔 | config.json 或 0.0.0.0 |

优先级：命令行参数 > config.json > 默认值

## 配置文件 config.json

服务首次启动时自动生成，也可通过 Web 设置页修改。

```json
{
  "root": "E:\\AIHuman",
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
| GET | `/api/config` | 获取完整配置 |
| POST | `/api/config` | 更新配置 `{"root":"...","port":8080,"bind":["..."],"whitelist":["..."]}` |

## 支持的文件类型

| 类型 | 扩展名 | 预览方式 |
|------|--------|----------|
| 图片 | jpg, png, gif, webp, svg, bmp, ico | 直接显示 + 缩略图 |
| 视频 | mp4, webm, ogg, mov, avi, mkv | HTML5 播放器 + 封面 |
| 音频 | mp3, wav, flac, aac, m4a, opus | HTML5 播放器 |
| 文本 | txt, md, json, js, py, html, css 等 | 行号代码查看 |
| PDF | pdf | PDF.js 在线查看 |

## 目录结构

```
file-manager/
├── server.js          # Express 服务端
├── package.json
├── config.json        # 用户配置（自动生成）
├── .thumbcache/       # 图片缩略图缓存（自动生成）
├── README.md
└── public/
    ├── index.html     # 前端页面
    ├── style.css      # 样式
    └── app.js         # 前端逻辑
```
