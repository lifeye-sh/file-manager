# Web File Manager

基于 Web 的文件管理器，支持多级目录浏览、文件列表、多媒体文件在线预览。

## 功能

- 多级目录树浏览（懒加载），树与文件列表联动
- 图片显示缩略图（服务端生成 WebP，原体积 1/50~1/100），视频自动生成封面
- 图片全屏预览：← → 翻看文件夹内所有图片，滚轮缩放/拖拽平移，R 键旋转（自适应窗口），双击还原
- 视频、音频、文本（可编辑保存）、Markdown、PDF 在线预览
- 文件操作：新建文件夹、重命名、删除、移动、上传、批量重命名/移动/删除
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
| POST | `/api/mkdir` | 创建文件夹 `{"path":"...","name":"..."}` |
| POST | `/api/rename` | 重命名 `{"path":"...","newName":"..."}` |
| POST | `/api/delete` | 删除文件/文件夹 `{"path":"..."}` |
| POST | `/api/move` | 移动文件/文件夹 `{"path":"...","targetDir":"..."}` |
| POST | `/api/save` | 保存文本文件 `{"path":"...","content":"..."}` |
| POST | `/api/upload` | 上传文件（multipart） |
| GET | `/api/config` | 获取完整配置 |
| POST | `/api/config` | 更新配置 `{"root":"...","port":8080,"bind":["..."],"whitelist":["..."]}` |

## 支持的文件类型

| 类型 | 扩展名 | 预览方式 |
|------|--------|----------|
| 图片 | jpg, png, gif, webp, svg, bmp, ico | 全屏浏览 + 翻页 + 旋转 + 缩略图 |
| 视频 | mp4, webm, ogg, mov, avi, mkv | HTML5 播放器 + 封面 |
| 音频 | mp3, wav, flac, aac, m4a, opus | HTML5 播放器 |
| 文本 | txt, md, json, js, py, html, css 等 | 行号代码查看 |
| PDF | pdf | PDF.js 在线查看 |

## 快捷键

| 快捷键 | 说明 |
|--------|------|
| ← → | 全屏浏览时切换上/下一张图片 |
| R | 全屏浏览时旋转图片 90° |
| Esc | 关闭当前弹窗/菜单 |
| Ctrl+S | 文本编辑时保存 |
| Ctrl+Click | 多选文件 |
| 拖拽框选 | 鼠标拖拽矩形区域批量选中 |
| 双击 | 打开文件夹 / 预览文件 / 还原图片缩放 |
| 滚轮 | 全屏浏览时缩放图片 |
| 长按（触屏） | 弹出右键菜单 |

## 目录结构

```
file-manager/
├── server.js          # Express 服务端
├── package.json
├── .gitignore
├── config.json        # 用户配置（自动生成，不提交）
├── .thumbcache/       # 图片缩略图缓存（自动生成）
├── README.md
└── public/
    ├── index.html     # 前端页面
    ├── style.css      # 样式
    └── app.js         # 前端逻辑
```
