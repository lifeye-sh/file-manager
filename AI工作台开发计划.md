# AI 多媒体工作台 功能开发计划

> 版本：v1.0  日期：2026-07-08
> 依据：《AI工作台需求文档.md》+ 界面设计稿 `public/ai-workbench.html`
> 目标：分阶段交付，每阶段产出可独立验证的功能切片

---

## 0. 总体策略

- **前后端并行**：后端按层（ComfyUI 客户端 → 解析器 → 任务管理器 → WS 总线）推进；前端基于已有设计稿逐步接入真实接口
- **纵向切片优先**：先打通「上传一个 ComfyUI JSON → 拖到画布 → 执行 → 拿到一张结果图」的最小闭环，再补控制、详情、复用等横向能力
- **复用现有基础设施**：认证、CSRF、白名单、`/api/file` 下载、express+ws 依赖、Catppuccin 主题
- **不破坏文件管理器**：所有新代码挂在 `/api/ai/*` 与新页面，独立开关 `aiWorkbench.enabled`

---

## 1. 里程碑与阶段

| 阶段 | 名称 | 核心交付 | 依赖 |
|------|------|----------|------|
| P1 | 后端基础设施 + ComfyUI 客户端 | 配置、目录、comfyui-client、配置 API | — |
| P2 | 自定义节点定义 | JSON 解析器、节点定义 CRUD | P1 |
| P3 | 工作流 CRUD + 画布前端 | 工作流存储、画布编辑器、多标签、节点库 | P2 |
| P4 | 执行引擎 + 任务管理器 | 拓扑排序、串行执行、结果回收、任务历史、日志 | P2, P3 |
| P5 | WebSocket 实时反馈 | ws-bus、ComfyUI ws 转发、节点状态、日志流 | P4 |
| P6 | 任务控制 | 队列、暂停/恢复/终止/取消 | P5 |
| P7 | 任务详情 + 下载 | 详情抽屉三 Tab、zip/日志下载 | P4, P5 |
| P8 | 文件选择 + 历史结果复用 + 拖放 | file-picker、result-picker、拖放媒体建节点 | P3, P7 |
| P9 | 收尾与验收 | 画布校验、错误边界、自动清理、验收清单 | 全部 |

> 建议节奏：P1–P4 是最小闭环（MVP），先跑通；P5–P8 是体验完善；P9 收尾。

---

## 2. 阶段详解

### P1 · 后端基础设施 + ComfyUI 客户端

**目标**：让应用能连上本地 ComfyUI，并提供工作台配置接口。

**任务**
- `config.json` 扩展 `aiWorkbench` 字段（enabled / comfyuiUrl / 超时 / maxConcurrentTasks / keepResultsDays）
- 启动时创建目录：`.aiworkbench/{workflows,node-defs,results,logs}` + `history.json`
- `services/ai/comfyui-client.js`：封装
  - REST：`POST /prompt`、`GET /history/:id`、`GET /system_stats`、`POST /upload/image`、`POST /upload/video`、`GET /view`
  - WS：连接 ComfyUI `/ws`，转发 progress/executing/executed/execution_error 事件
  - 超时与错误归一化（不可达 → 「ComfyUI 不可达」）
- `routes/ai-workbench.js` 挂载：`GET/POST /api/ai/config`、`POST /api/ai/config/test`
- server.js 装配新路由 + ws 升级端点 `/api/ai/ws`

**交付**：管理员可在设置页测试 ComfyUI 连接并保存配置；后端能调用 ComfyUI 基础接口。

**验收**
- [ ] 配置保存后 `config/test` 返回 `{ok, version, latencyMs}`
- [ ] ComfyUI 关闭时接口返回明确错误
- [ ] `.aiworkbench` 目录结构与权限正确

---

### P2 · 自定义节点定义

**目标**：用户上传 ComfyUI API JSON，自动生成可在画布使用的自定义节点。

**任务**
- `services/ai/workflow-parser.js`：实现需求 3.2.2 的自动解析规则
  - 识别内部连接（数组值）vs 外部端口（字面量）
  - LoadImage/VHS_LoadVideo 等加载类 → image/video 端口
  - 字面量按 string/int/float → text/int/float 端口
  - 输出类节点（SaveImage/PreviewImage/VHS_VideoCombine）→ 输出端口
  - 生成带 `{{端口名}}` 占位符的 prompt 模板
- `routes/ai-workbench.js`：`GET/POST/PUT/DELETE /api/ai/node-defs`，存储到 `.aiworkbench/node-defs/<id>.json`
- 前端：节点库「＋」上传 JSON，预览解析出的端口，编辑名称/默认值/隐藏端口

**交付**：上传 ComfyUI workflow JSON 后得到一个自定义节点定义，端口与 prompt 模板正确。

**验收**
- [ ] 上传 SD1.5 图生图 JSON，正确识别 image/prompt/seed/steps 端口与 output_image 输出
- [ ] 端口默认值来自 JSON 字面量
- [ ] 隐藏端口后 prompt 仍能正确生成

---

### P3 · 工作流 CRUD + 画布前端

**目标**：可在画布上编排节点并保存，多工作流标签切换。

**任务**
- `routes/ai-workbench.js`：`GET/POST/PUT/DELETE /api/ai/workflows`，存储到 `.aiworkbench/workflows/<id>.json`
- 前端：把 `ai-workbench.html` 设计稿改造为真实应用
  - 节点库拖拽到画布生成节点（含通用节点 / 自定义节点 / 输出节点）
  - 节点卡片内联编辑（文件选择、文本、整数、小数、端口默认值）
  - 端口拖拽连线 + 类型校验 + 单输入端口约束
  - 画布平移缩放、框选、删除、撤销/重做
  - 工作流标签栏（多开、切换、关闭、未保存标记）
  - 保存 / 另存为 / 重命名
- 通用节点文件选择先接 file-picker（P8 再补 result-picker）

**交付**：能编排「图片输入 → 自定义节点 → 输出节点」并保存为工作流，重新加载后还原。

**验收**
- [ ] 工作流保存/加载/另存为/删除闭环
- [ ] 连线类型不匹配时拒绝并提示
- [ ] 多标签切换不丢失各画布状态
- [ ] 输出节点透传（输入既保存又可继续向下游连）

---

### P4 · 执行引擎 + 任务管理器

**目标**：点击执行后，按拓扑序串行调用 ComfyUI，产出结果落盘。

**任务**
- `services/ai/task-manager.js`：
  - 拓扑排序生成子任务序列（自定义节点 = ComfyUI 调用，输出节点 = 结果回收+透传）
  - 串行执行，前一步输出喂下一步输入
  - 失败即停，后续标「已跳过」
- `services/ai/prompt-builder.js`：占位符替换 + 输入文件上传 ComfyUI 后回填文件名（同文件任务内去重上传）
- 结果回收：通过 `/history` + `/view` 下载到 `.aiworkbench/results/<task_id>/`，命名规则见需求 3.5
- `routes/ai-workbench.js`：`POST /api/ai/tasks`、`GET /api/ai/tasks`、`GET /api/ai/tasks/:id`
- 日志：`services/ai/logger` 写 `.aiworkbench/logs/<task_id>.log`，更新 `history.json`
- 前端：执行按钮 + 同步阻塞式日志（此阶段先用 HTTP 轮询或单次拉取，P5 换 WS）

**交付**：一个完整工作流能跑通并生成结果文件，可在文件管理器中查看。

**验收**
- [ ] 图生图工作流跑通，结果保存到 results 目录
- [ ] 中间某步失败时停止并标红，后续跳过
- [ ] 日志文件与 history.json 记录完整
- [ ] 输入文件不重复上传

---

### P5 · WebSocket 实时反馈

**目标**：执行过程节点状态、进度、日志实时推送到前端。

**任务**
- `services/ai/ws-bus.js`：
  - 前端 `/api/ai/ws` 连接（握手验证 session cookie）
  - 按 `taskId` 订阅，服务端推送需求 3.7 的全部事件
  - 作为 ComfyUI `/ws` 客户端，把 progress/executed/error 转成 `step:progress/log/completed/failed`
- 前端：ws 客户端（断线指数退避重连）+ 画布节点状态徽标 + 右侧日志面板实时滚动 + 队列状态条
- 替换 P4 的轮询为 ws 事件

**交付**：执行时画布节点逐个亮起，日志面板逐行滚动，进度条实时更新。

**验收**
- [ ] 节点状态徽标随 step 事件切换（排队/运行/完成/失败/跳过）
- [ ] 日志面板实时滚动，延迟 < 200ms
- [ ] 断线重连后能补齐进度（拉 `/tasks/:id`）

---

### P6 · 任务控制

**目标**：任务可暂停/恢复/终止，排队任务可取消。

**任务**
- task-manager 增加状态机：queued / running / paused / terminating / aborted / cancelled / completed / failed
- 队列：`maxConcurrentTasks` 控制（v1=1 严格串行）
- 暂停在子任务边界生效；终止调 ComfyUI `/interrupt`
- `routes/ai-workbench.js`：`POST /:id/cancel`、`/pause`、`/resume`、`/terminate`、`GET /tasks/queue`
- 前端：运行中显示「暂停/终止」，暂停中显示「恢复/终止」，排队显示「取消」；ws 推送 `task:paused/resumed/cancelled/terminating/aborted` + `queue:update`

**交付**：四种控制操作均生效，状态实时同步到前端。

**验收**
- [ ] 排队任务取消后不消耗 ComfyUI 资源
- [ ] 暂停在当前子任务完成后停住，恢复从断点继续
- [ ] 终止调用 /interrupt，已完成结果保留

---

### P7 · 任务详情 + 下载

**目标**：任务列表点开看输入资源/生成结果/执行日志，均可下载。

**任务**
- 任务记录补充 `inputs` 字段（节点 id/名/类型/路径或值）
- `routes/ai-workbench.js`：`GET /:id/log`、`GET /:id/results.zip`（打包该任务 results 目录）
- 前端：任务详情抽屉三 Tab（输入资源 / 生成结果 / 执行日志）
  - 缩略图 + 下载（复用 `/api/file`）+ 在文件管理器中打开
  - 「全部下载 zip」+ 「下载日志」
- 底部任务列表 dock 接入真实数据，行操作按钮按状态显示

**交付**：完成任务可在列表下载结果与日志，点行打开详情抽屉查看三类资源。

**验收**
- [ ] 输入资源、生成结果、执行日志三 Tab 内容正确
- [ ] 单文件下载与 zip 下载均可用
- [ ] 详情对 running/paused 任务显示实时视图

---

### P8 · 文件选择 + 历史结果复用 + 拖放

**目标**：图片/视频输入可从文件管理器或历史任务结果中选择；支持拖放媒体到画布。

**任务**
- `routes/ai-workbench.js`：`GET /api/ai/file-picker`（复用 browse + 类型过滤）、`GET /api/ai/result-picker`（按任务分组列 results）
- 前端：文件选择器双 Tab（文件管理器 / 历史任务结果），选中后回填节点 path + 来源标记
- 前端：HTML5 拖放 OS 图片/视频到画布 → 在落点生成图片/视频输入节点（含真实缩略图）
- 引用结果被清理时执行前校验报错提示重选

**交付**：A 任务的结果可直接作为 B 任务的图片/视频输入；拖放媒体即建节点。

**验收**
- [ ] 选择器双 Tab 切换，历史结果按任务分组带缩略图
- [ ] 拖放图片到画布生成带缩略图的输入节点
- [ ] 跨任务复用闭环（A 输出 → B 输入 → B 执行成功）

---

### P9 · 收尾与验收

**目标**：补全校验、错误边界、自动清理，逐项过验收清单。

**任务**
- 画布执行前校验：DAG 无环、无悬空连接、单输入端口、至少一个输出节点、占位符均有值
- 错误边界：ComfyUI 不可达、输入文件不存在、缺 class_type、占位符缺失、网络中断、超时
- results 自动清理：定时任务按 `keepResultsDays` 清理（清理后引用报错已在 P8 处理）
- 占位符注入转义，防 JSON 破坏
- 工作台开关 `aiWorkbench.enabled` 关闭时隐藏入口与路由
- README 增补工作台使用说明
- 逐项核对需求文档第 10 节验收清单

**交付**：全量验收通过，可交付使用。

**验收**
- [ ] 需求文档第 10 节 12 条验收项全部通过
- [ ] 现有文件管理器功能回归无影响
- [ ] 未登录访问工作台被重定向

---

## 3. 文件结构（实现期落点）

```
routes/ai-workbench.js          # 所有 /api/ai/* REST 路由
services/ai/
  ├── comfyui-client.js         # ComfyUI REST + WS 封装
  ├── workflow-parser.js        # JSON → 节点定义
  ├── prompt-builder.js         # 占位符替换 + 输入文件上传回填
  ├── task-manager.js           # 拓扑排序 + 串行执行 + 状态机
  ├── ws-bus.js                 # 前端 ws 推送 + ComfyUI ws 转发
  └── logger.js                 # 任务日志持久化 + history.json
public/
  ├── ai-workbench.html         # 已有设计稿 → 改为真实页面
  ├── ai-workbench.js           # 画布编辑器 + ws 客户端
  └── ai-workbench.css          # 从设计稿抽出样式
```

---

## 4. 技术决策与风险

| 决策 | 选择 | 理由 |
|------|------|------|
| ComfyUI 通信 | REST + WS | 官方原生协议，无额外抽象层 |
| 任务并发 | v1 严格串行（=1） | 避免 GPU 抢占，简单可靠；v2 再放开 |
| 暂停粒度 | 子任务边界 | ComfyUI 不支持 mid-step 暂停 |
| 输入文件 | 先上传 ComfyUI | 解耦两边存储；v2 共享磁盘优化 |
| 实时推送 | 单一 ws 连接 + taskId 订阅 | 复用 ws 依赖，少连接 |
| 数据持久化 | JSON 文件 | 与项目现有风格一致，无引入数据库 |

| 风险 | 缓解 |
|------|------|
| ComfyUI 自定义节点未安装 | 执行时报错并提示节点名 |
| ComfyUI 版本差异（VHS 等插件） | parser 维护加载类/输出类节点清单，可配置扩展 |
| 大视频上传慢 | 流式上传 + 进度展示（P5） |
| ws 断线丢事件 | 重连后拉 `/tasks/:id` 补齐 |
| results 清理后引用失效 | 执行前校验提示重选 |

---

## 5. MVP 定义（P1–P4 完成时）

可演示的最小闭环：
1. 设置页配置 ComfyUI 地址并测试连通
2. 上传一个 ComfyUI 图生图 JSON，生成自定义节点
3. 画布上摆「图片输入 → 自定义节点 → 输出节点」并连线
4. 保存工作流
5. 点击执行，拿到一张生成图，保存到 results，可在文件管理器查看
6. 日志落盘，任务历史可见

P5–P8 在此基础上补实时性、可控性、可观测性与复用能力。

---

## 6. 验收门（与需求文档第 10 节对齐）

每阶段完成时更新对应勾选；P9 全部勾选即视为交付。