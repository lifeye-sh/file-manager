# AI 多媒体工作台 需求文档

> 版本：v1.0  日期：2026-07-08
> 状态：需求定义阶段（待评审 → 设计 → 实现）

---

## 1. 概述

在现有 Web 文件管理器基础上新增「AI 多媒体工作台」模块，后台对接本地部署的 ComfyUI，让用户通过可视化节点画布编排 AI 多媒体处理流程，并以任务管理器串行执行，最终把结果落回文件管理器根目录。

工作台与文件管理器共用同一套用户认证、CSRF、白名单等安全基础设施，作为新页面挂载在现有应用下。

### 1.1 核心价值

- 让非技术用户也能编排 ComfyUI 工作流（无需理解 ComfyUI 原生 UI）
- 把一次性的 ComfyUI 工作流封装成可复用、可组合的「自定义节点」
- 全过程可视化、可观测、可回溯（日志 + 结果留存）

### 1.2 范围

**包含**：画布编辑、节点系统、连接编排、工作流保存/加载、任务拆解与串行执行、ComfyUI 对接、实时状态推送、结果保存与展示、执行日志。

**不包含**：ComfyUI 本身的安装与模型管理、节点级别的并行执行、GPU 调度优化、工作流版本管理（v1 暂不做）、多用户协同编辑同一画布。

---

## 2. 术语定义

| 术语 | 含义 |
|------|------|
| 画布（Canvas） | 一个可视化节点图，用户编排节点与连接的工作区 |
| 节点（Node） | 画布上的一个处理单元，有输入/输出端口 |
| 通用节点 | 内置的简单数据输入节点（图片/视频/文本/整数/小数） |
| 自定义节点 | 对应一个完整 ComfyUI 工作流的节点，由用户上传 JSON 生成 |
| 输出节点 | 终端节点，收集最终结果并展示/保存 |
| 端口（Port） | 节点上的输入或输出连接点 |
| 连接（Edge/Link） | 两个节点端口之间的数据流向 |
| 工作流（Workflow） | 保存后的画布，可重复加载执行 |
| 任务（Task） | 一次工作流执行实例，由若干子任务串行组成 |
| 子任务（Step） | 任务序列中的一次 ComfyUI 调用（对应一个自定义节点） |
| 工作流定义（WorkflowDef） | 自定义节点的定义，包含 ComfyUI prompt 模板与端口声明 |

---

## 3. 功能需求

### 3.1 画布管理

**FR-1.1 创建画布**
- 用户可在工作台页面新建空白画布
- 画布默认名称「未命名工作流 N」，可重命名
- 同一时刻一个用户编辑一个画布

**FR-1.2 画布操作**
- 无限平移、滚轮缩放（与现有图片预览缩放体验一致）
- 框选多个节点、批量移动、批量删除
- 复制 / 粘贴节点（含端口值，不含连接）
- 撤销 / 重做（Undo/Redo，最多 50 步）

**FR-1.3 画布校验**
- 执行前自动校验：
  - 无环（DAG）
  - 无悬空连接（每个连接两端必须有节点）
  - 每个输入端口最多一条入边
  - 输出节点至少一个
- 校验失败时高亮问题节点/连接并给出提示

### 3.2 节点系统

#### 3.2.1 通用节点（内置）

| 节点类型 | 输入端口 | 输出端口 | 说明 |
|----------|----------|----------|------|
| 图片输入 | 无 | image | 从文件管理器选一个图片文件作为数据源 |
| 视频输入 | 无 | video | 从文件管理器选一个视频文件 |
| 文本输入 | 无 | text | 多行文本框，输出字符串 |
| 整数输入 | 无 | int | 数值输入框，可设 min/max/默认值 |
| 小数输入 | 无 | float | 数值输入框，可设 min/max/step/默认值 |
| 输出节点 | image 或 video 或 text（任一） | 与输入同类型 | 透传节点：把输入**原样作为输出**，可继续向下游连接；同时保存并展示该输入。便于在链路中间「留痕」后再继续处理 |

> 输出节点不再是纯终端节点。典型用法：`自定义节点A → 输出节点（留痕中间结果）→ 自定义节点B → 输出节点（最终结果）`。一个画布可有多个输出节点，每个都保存自己的输入并向下游透传。

**FR-2.1** 通用节点的值在节点卡片内直接编辑：
- 图片/视频输入：显示「选择文件」按钮，点击弹出文件选择器，选择器提供两个来源 Tab：
  - **文件管理器**：浏览 file-manager 根目录，按类型过滤（图片/视频）
  - **历史任务结果**：浏览 `.aiworkbench/results/` 下各任务的产物，按任务分组展示，带任务名、时间、缩略图；可直接选用某个历史任务的输出文件
  - 选中后显示相对路径（相对 file-manager root）、来源标记（文件管理器 / 任务:task_XXX）与缩略图
- 文本输入：节点内嵌 textarea
- 整数/小数输入：节点内嵌 number input

**FR-2.1a 跨任务复用**
- 图片/视频输入引用历史任务结果时，记录的是文件相对路径（如 `.aiworkbench/results/task_xxx/xxx.webp`），与引用文件管理器文件在数据模型上无差异
- 若引用的结果文件已被自动清理（见 7 节 `keepResultsDays`），执行前校验阶段报错「输入文件不存在」并提示用户重选

**FR-2.2** 通用节点的输出端口类型固定，连接时需类型匹配（见 3.3）。

#### 3.2.2 自定义节点

**FR-3.1 创建自定义节点**
- 用户上传 ComfyUI 导出的 **API 格式 workflow JSON**（非 UI 格式）
- 系统自动解析并生成节点定义，包含：
  - 节点名称（用户可改）
  - 输入端口列表
  - 输出端口列表
  - ComfyUI prompt 模板（带占位符的 JSON）

**FR-3.2 自动解析规则**
对上传的 JSON 中每个节点（key 为节点 id，value 含 `class_type` 与 `inputs`）：

> **输入端口识别规则**：只有值为 `%参数名%` 占位符的字段才会暴露为输入端口；其他所有字面量（模型名、步数、采样器、提示词正文等）都作为**固定值**留在 prompt 模板里，不暴露为端口。

1. **输入端口识别**：
   - `inputs` 中值为**数组** `[node_id, output_index]` 的字段 → ComfyUI 内部连接，保留在模板中，不暴露
   - `inputs` 中值为字符串且匹配 `%参数名%`（如 `%prompt%`、`%seed%`）→ 暴露为输入端口
     - 端口名 = 占位符里的参数名（`%prompt%` → 端口名 `prompt`）
     - 同名占位符出现在多个字段时合并为同一个端口（一处输入喂多处）
     - 端口类型按参数名推断：含 image/img/photo → image；video → video；seed/steps/width/height/batch 等数字类 → int；cfg/denoise/strength/scale 等 → float；其余 → text
     - 加载类节点（LoadImage/VHS_LoadVideo）的文件字段即便用占位符也按 image/video 类型
   - 其他字面量（含普通字符串、数字、布尔）→ 固定值，保留在模板，不暴露

2. **输出端口识别**：
   - 找出未被任何其他节点作为输入引用的「输出类」节点（`SaveImage` / `PreviewImage` / `VHS_VideoCombine` 等）→ 暴露为 image / video 输出端口
   - 端口名取 `class_type` 可读化命名（如 `SaveImage → 输出图片`）
   - 若有多个输出节点，生成多个输出端口

3. **占位符替换**：
   - prompt 模板中，被识别为端口的字段值替换为占位符 `{{参数名}}`
   - 固定字面量保留原值，执行时直接发给 ComfyUI
   - 执行时由任务管理器把 `{{参数名}}` 替换为实际值

**FR-3.3 自定义节点编辑**
- 上传后用户可：
  - 重命名节点显示名
  - 隐藏/显示某些输入端口（被隐藏的端口使用字面量默认值）
  - 为每个端口设置默认值（用户未连接时的 fallback）
  - 调整端口顺序
- 修改后重新生成 prompt 模板

**FR-3.4 自定义节点库**
- 上传过的自定义节点定义保存到「节点库」，可在任意画布中重复拖入
- 节点库全局共享（所有用户可见可用）
- 支持删除自定义节点定义（不影响已使用它的画布，但已用的会标记为「定义缺失」）

**FR-3.5 ComfyUI 节点类型白名单**
- 解析时校验 `class_type`，若引用了 ComfyUI 未安装的自定义节点，在执行时报错并提示节点名

### 3.3 连接系统

**FR-4.1 连接规则**
- 从输出端口拖拽到输入端口建立连接
- 类型必须兼容：
  - `image` → `image`
  - `video` → `video`
  - `text` → `text`
  - `int` → `int`（int 可传入 float 端口，反之不行）
  - `float` → `float`
- 每个输入端口同时只能有 **一条** 入边（新连接覆盖旧连接）
- 输出端口可有多条出边（广播）

**FR-4.2 连接可视化**
- 连线为贝塞尔曲线，随端口类型着色（image=粉、video=绿、text=青、int/float=蓝）
- 选中连接高亮，可 Delete 删除
- 拖拽中显示临时连线，松开在无效端口上时自动取消并提示原因

### 3.4 工作流保存与加载

**FR-5.1 保存**
- 保存画布为工作流，持久化内容：
  - 画布元数据（名称、作者、创建/更新时间）
  - 节点列表（类型、位置、端口值、自定义节点定义 id 引用）
  - 连接列表
- 保存位置：`<file-manager root>/.aiworkbench/workflows/<id>.json`
- 文件名用 id，元数据中存名称

**FR-5.2 加载**
- 工作台首页列出所有已保存工作流（名称、缩略图、更新时间）
- 点击加载到画布
- 引用的自定义节点定义若已删除，节点显示「定义缺失」状态，可重新绑定或删除

**FR-5.3 另存为 / 复制**
- 已加载工作流可「另存为」生成新 id

**FR-5.4 删除**
- 可删除已保存工作流（仅删除定义文件，不影响已生成的结果文件）

### 3.5 任务管理器

**FR-6.1 任务拆解**
- 用户点击「执行」后，任务管理器：
  1. 对画布做拓扑排序，得到节点执行顺序
  2. 过滤出**自定义节点**（产生 ComfyUI 调用）和**输出节点**（结果回收 + 透传）作为子任务；通用输入节点只提供数据，不产生子任务
  3. 生成串行子任务序列：`Step 1 → Step 2 → ... → Step N`
- 每个自定义节点子任务对应一次 ComfyUI 调用
- 每个输出节点子任务对应一次「结果回收 + 透传」（下载上游输出、保存到结果目录、把输入值透传给下游），不调用 ComfyUI

**FR-6.2 数据传递**
- 执行第一个自定义节点前，先解析所有上游通用输入节点的值：
  - 图片/视频 → 文件管理器内的相对路径
  - 文本/整数/小数 → 字面量值
- 每个自定义节点执行时：
  - 收集所有输入端口的当前值（来自上游连接的输出 or 节点默认值）
  - 用值替换 prompt 模板中的占位符
  - 提交给 ComfyUI
  - 拿到输出（图片/视频文件名）作为该节点的输出值
  - 下游节点通过连接拿到这些输出值

**FR-6.3 串行执行**
- 子任务严格按顺序执行，前一个完成才开始下一个
- 任意子任务失败 → 立即停止整个任务，标记失败节点，后续子任务标为「已跳过」
- 执行中不可编辑画布（只读模式）

**FR-6.3a 任务队列**
- 提交执行后任务进入全局队列，状态为 `queued`
- 受 `maxConcurrentTasks`（v1 默认 1）限制，队列中最多 N 个任务同时 `running`，其余排队
- 排队中的任务可被 `cancelled`（见 6.3b）
- 队列变化时通过 WebSocket 广播 `queue:update` 事件，前端实时显示「待执行: M | 当前执行: task_XXX (step K/N)」

**FR-6.3b 任务控制**
- **取消（cancel）**：仅对 `queued` 任务有效。从队列移除，状态置 `cancelled`，不消耗 ComfyUI 资源
- **暂停（pause）**：仅对 `running` 任务有效。当前正在执行的子任务**继续跑完**，之后不启动下一个子任务，状态置 `paused`。ComfyUI 本身不支持 mid-step 暂停，因此暂停只在子任务边界生效
- **恢复（resume）**：仅对 `paused` 任务有效。从断点继续执行下一个子任务，状态置 `running`
- **终止（terminate）**：对 `running` 或 `paused` 任务有效。调用 ComfyUI `/interrupt` 中断当前执行，状态置 `terminating` → `aborted`，已完成子任务的结果保留
- 暂停/终止/恢复/取消均通过 WebSocket 推送对应状态事件，前端画布状态徽标同步更新

**FR-6.4 ComfyUI 输入文件上传**
- 图片/视频输入若引用的是 file-manager 内的文件：
  - 执行前通过 ComfyUI `/upload/image`（或 `/upload/video`）接口上传到 ComfyUI 的 input 目录
  - 拿到 ComfyUI 侧的文件名，填入 prompt
  - 同一文件在任务内只上传一次（按路径 + mtime 缓存）
- 若 ComfyUI 与 file-manager 共享同一磁盘，可优化为直接传路径（v2）

**FR-6.5 结果回收**
- 输出节点收到上游传来的 image/video 结果（ComfyUI 侧的文件名）：
  - 通过 ComfyUI `/view` 或 `/api/view` 下载结果文件
  - 保存到 `<file-manager root>/.aiworkbench/results/<task_id>/`
  - 文件名规则：`<workflow名>_<输出端口名>_<时间戳>.<扩展名>`
  - 保存成功后在工作台结果区展示，并可通过文件管理器直接浏览

### 3.6 实时反馈（WebSocket）

**FR-7.1 连接**
- 工作台页面通过 WebSocket 连接 `/api/ai/ws`（复用现有 express + ws 依赖）
- 连接时携带 session cookie 鉴权
- 断线自动重连（指数退避，最多 5 次）

**FR-7.2 推送事件**
执行期间服务端推送以下事件：

| 事件 | 时机 | payload |
|------|------|---------|
| `queue:update` | 队列变化（入队/出队/完成） | `{ pendingCount, runningTasks: [{taskId, stepIndex, stepTotal}] }` |
| `task:queued` | 任务进入队列 | `{ taskId, workflowName, position }` |
| `task:started` | 任务开始执行 | `{ taskId, workflowName, steps: [{id, name, index}] }` |
| `task:paused` | 任务被暂停 | `{ taskId, atStep }` |
| `task:resumed` | 任务被恢复 | `{ taskId, resumeFromStep }` |
| `task:cancelled` | 排队任务被取消 | `{ taskId }` |
| `task:terminating` | 终止请求已下发 | `{ taskId }` |
| `task:aborted` | 终止完成 | `{ taskId, completedSteps }` |
| `step:queued` | 子任务排队 | `{ taskId, stepIndex, nodeName }` |
| `step:running` | 子任务开始执行 | `{ taskId, stepIndex, nodeName }` |
| `step:progress` | ComfyUI 进度回调 | `{ taskId, stepIndex, value, max, nodeLabel }` |
| `step:log` | 子任务日志行 | `{ taskId, stepIndex, level, message, ts }` |
| `step:completed` | 子任务完成 | `{ taskId, stepIndex, outputs: {...} }` |
| `step:failed` | 子任务失败 | `{ taskId, stepIndex, error, logs: [...] }` |
| `step:skipped` | 因上游失败跳过 | `{ taskId, stepIndex, reason }` |
| `task:completed` | 全部完成 | `{ taskId, results: [{port, file, url}] }` |
| `task:failed` | 任务终止 | `{ taskId, failedStep, error }` |

**FR-7.3 画布同步**
- 前端收到事件后实时更新画布上对应节点的状态徽标：
  - ⏳ 排队 / ▶ 运行中 / ✅ 完成 / ❌ 失败 / ⤵ 已跳过
- 节点卡片下方滚动显示最新 3 行日志

**FR-7.4 日志面板**
- 画布右侧/底部可展开「执行日志」面板：
  - 实时滚动显示所有 step 的日志（带时间戳、级别、step 名）
  - 支持按 step 过滤、按级别过滤
  - 支持复制、下载为 txt
  - 任务结束后保留，直到用户关闭或开始新任务

### 3.7 执行日志持久化

**FR-8.1 日志存储**
- 每次任务执行生成一份完整日志，保存到：
  `<file-manager root>/.aiworkbench/logs/<task_id>.log`
- 内容：任务元数据 + 每个 step 的全部日志行 + 最终结果摘要 + 错误堆栈
- 格式：纯文本，每行 `[ISO时间] [LEVEL] [step N:节点名] 消息`

**FR-8.2 任务历史**
- 工作台有「任务历史」入口，列出最近 N 次执行（默认 50）：
  - 工作流名、开始时间、耗时、状态、结果缩略图
  - 每行操作按钮（按状态显示）：
    - completed：「下载结果」「查看日志」
    - failed / aborted：「查看日志」
    - queued：「取消」
    - running / paused：「暂停/恢复」「终止」
- 历史索引存于 `.aiworkbench/history.json`

**FR-8.3 任务详情视图**
- 点击任务列表中任意一条任务，打开「任务详情」面板（右侧抽屉或独立页），分三区：
  - **输入资源**：列出本次任务所有通用输入节点提供的文件与参数
    - 图片/视频：显示缩略图 + 文件相对路径 + 「下载」「在文件管理器中打开」
    - 文本/整数/小数：显示值
    - 每个资源标注来自的节点 id 与节点名
  - **生成结果**：列出所有输出节点保存的产物
    - 图片：缩略图 + 文件名 + 保存路径 + 「下载」「在文件管理器中打开」「预览」
    - 视频：缩略图 + 文件名 + 保存路径 + 「下载」「预览」
    - 文本：截断预览 + 「下载」「查看全文」
    - 多个结果可「全部下载（zip）」
  - **执行日志**：完整日志查看
    - 与 3.7 FR-7.4 日志面板同款（时间戳、级别、step 名、过滤、复制）
    - 「下载日志」按钮：下载 `<task_id>.log` 原文件
- 三区内容均支持下载；下载走 file-manager 现有的 `/api/file` 接口（复用认证与 Range 支持）
- 任务详情对 completed / failed / aborted / cancelled 任务可读，对 queued / running / paused 显示实时进度而非历史快照

### 3.8 ComfyUI 对接

**FR-9.1 配置**
- 设置页新增「AI 工作台」分区：
  - ComfyUI 地址（默认 `http://127.0.0.1:8188`）
  - 连接超时（默认 5s）、执行超时（默认 600s）
  - 测试连接按钮（调用 `/system_stats` 验证可达）
- 配置存入 `config.json` 的 `aiWorkbench` 字段，热更新生效

**FR-9.2 调用接口**
- `POST /prompt` — 提交工作流，拿 `prompt_id`
- `GET /history/<prompt_id>` — 拉取执行结果与输出文件列表
- `GET /system_stats` — 健康检查
- `POST /upload/image` / `/upload/video` — 上传输入文件
- `GET /view?filename=...&type=output` — 下载结果文件
- **WebSocket `/ws`** — 订阅 ComfyUI 执行进度与完成事件（服务端作为 ComfyUI ws 客户端，把进度转发给前端）

**FR-9.3 执行流程**
每个子任务：
1. 准备 prompt（占位符替换 + 输入文件上传后的文件名回填）
2. `POST /prompt` 拿 `prompt_id`
3. 通过 ComfyUI WebSocket 监听 `progress` / `executing` / `executed` / `execution_error` 事件
4. 收到 `executed` → 从 `/history/<prompt_id>` 拉输出文件列表
5. 下载输出文件到结果目录
6. 完成，进入下一个子任务

**FR-9.4 错误识别**
- ComfyUI 返回 `execution_error` 或 `/prompt` 直接 400 → 子任务失败
- 网络超时 / 连接断开 → 子任务失败，错误消息标注「ComfyUI 不可达」
- prompt 中引用了未安装的 `class_type` → 错误消息含节点名

### 3.9 权限

**FR-10.1** 所有登录用户可用工作台、可创建/编辑/删除工作流、可上传自定义节点、可执行。
**FR-10.2** 工作流与自定义节点定义全局共享（不按用户隔离）。
**FR-10.3** 未登录访问工作台页面 → 重定向到 login（复用现有 authMiddleware）。
**FR-10.4** 所有工作台 API 复用现有 CSRF + 认证中间件，WebSocket 在握手时验证 session cookie。

---

## 4. 数据模型

### 4.1 工作流文件 `<root>/.aiworkbench/workflows/<id>.json`

```json
{
  "id": "wf_20260708_abc123",
  "name": "图生图示例",
  "createdAt": "2026-07-08T10:00:00Z",
  "updatedAt": "2026-07-08T10:30:00Z",
  "author": "yuming",
  "nodes": [
    {
      "id": "n1",
      "type": "image-input",
      "x": 120, "y": 200,
      "data": { "path": "photos/cat.jpg" }
    },
    {
      "id": "n2",
      "type": "custom",
      "defId": "def_20260708_xyz",
      "x": 420, "y": 180,
      "data": {
        "portValues": { "seed": 42, "steps": 20 },
        "hiddenPorts": ["debug"]
      }
    },
    {
      "id": "n3",
      "type": "output",
      "x": 720, "y": 200,
      "data": { "portType": "image" }
    }
  ],
  "edges": [
    { "id": "e1", "from": "n1.out", "to": "n2.image", "type": "image" },
    { "id": "e2", "from": "n2.output_image", "to": "n3.in", "type": "image" }
  ]
}
```

### 4.2 自定义节点定义 `<root>/.aiworkbench/node-defs/<id>.json`

```json
{
  "id": "def_20260708_xyz",
  "name": "图生图-SD1.5",
  "createdAt": "...",
  "author": "yuming",
  "comfyuiPromptTemplate": {
    "3": { "class_type": "KSampler", "inputs": { "seed": "{{seed}}", "steps": "{{steps}}", "cfg": 7, ... } },
    "4": { "class_type": "LoadImage", "inputs": { "image": "{{image}}" } },
    "5": { "class_type": "SaveImage", "inputs": { "filename_prefix": "aiwb" } }
  },
  "ports": {
    "inputs": [
      { "name": "image", "type": "image", "default": null },
      { "name": "seed", "type": "int", "default": 42 },
      { "name": "steps", "type": "int", "default": 20 },
      { "name": "prompt_text", "type": "text", "default": "a cute cat" }
    ],
    "outputs": [
      { "name": "output_image", "type": "image", "sourceNode": "5", "sourceOutput": 0 }
    ]
  }
}
```

### 4.3 任务历史 `<root>/.aiworkbench/history.json`

```json
{
  "tasks": [
    {
      "id": "task_20260708_001",
      "workflowId": "wf_20260708_abc123",
      "workflowName": "图生图示例",
      "startedAt": "...", "finishedAt": "...",
      "status": "completed",   // queued | running | paused | terminating | aborted | cancelled | completed | failed
      "queuePosition": 0,
      "currentStep": null,
      "durationMs": 12345,
      "stepCount": 2,
      "failedStep": null,
      "inputs": [
        { "nodeId": "n1", "nodeName": "图片输入", "type": "image", "path": "photos/cat.jpg" },
        { "nodeId": "n2", "nodeName": "整数输入", "type": "int", "value": 42 }
      ],
      "results": [
        { "port": "output_image", "nodeId": "n3", "nodeName": "输出节点", "type": "image", "file": ".aiworkbench/results/task_20260708_001/图生图_output_image_100000.webp" }
      ],
      "logFile": ".aiworkbench/logs/task_20260708_001.log"
    }
  ]
}
```

### 4.4 配置扩展 `config.json`

```json
{
  "aiWorkbench": {
    "enabled": true,
    "comfyuiUrl": "http://127.0.0.1:8188",
    "connectTimeoutMs": 5000,
    "execTimeoutMs": 600000,
    "maxConcurrentTasks": 1,
    "keepResultsDays": 30
  }
}
```

---

## 5. API 接口

> 所有非 ws 接口走现有 `/api`，复用 CSRF + 认证中间件。

### 5.1 工作流 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/workflows` | 列出所有工作流（元数据） |
| GET | `/api/ai/workflows/:id` | 取单个工作流完整定义 |
| POST | `/api/ai/workflows` | 新建工作流 |
| PUT | `/api/ai/workflows/:id` | 更新工作流 |
| DELETE | `/api/ai/workflows/:id` | 删除工作流 |

### 5.2 自定义节点定义

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/node-defs` | 列出所有自定义节点定义 |
| GET | `/api/ai/node-defs/:id` | 取单个定义 |
| POST | `/api/ai/node-defs` | 上传 ComfyUI JSON 并解析，返回生成的定义 |
| PUT | `/api/ai/node-defs/:id` | 更新名称/端口/默认值 |
| DELETE | `/api/ai/node-defs/:id` | 删除定义 |

### 5.3 执行与历史

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/tasks` | 触发执行，body 为 `{ workflowId }`，返回 `{ taskId, queuePosition }` |
| GET | `/api/ai/tasks` | 列出任务历史与队列中任务 |
| GET | `/api/ai/tasks/queue` | 仅取当前队列状态：`{ pendingCount, running: [...], queued: [...] }` |
| GET | `/api/ai/tasks/:id` | 取任务详情（含结果文件 URL） |
| GET | `/api/ai/tasks/:id/log` | 取完整日志文本 |
| GET | `/api/ai/tasks/:id/results.zip` | 打包下载该任务全部结果文件（zip） |
| POST | `/api/ai/tasks/:id/cancel` | 取消排队中的任务（queued → cancelled） |
| POST | `/api/ai/tasks/:id/pause` | 暂停运行中任务（running → paused，子任务边界生效） |
| POST | `/api/ai/tasks/:id/resume` | 恢复暂停任务（paused → running） |
| POST | `/api/ai/tasks/:id/terminate` | 终止运行/暂停任务（调用 ComfyUI /interrupt，→ aborted） |

### 5.4 文件选择辅助

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/file-picker?path=&type=image` | 复用现有 browse，但按类型过滤，供节点内文件选择器调用 |
| GET | `/api/ai/result-picker?type=image` | 列出历史任务结果，按任务分组，供图片/视频输入「历史任务结果」Tab 调用 |

### 5.5 WebSocket

| 路径 | 说明 |
|------|------|
| `/api/ai/ws` | 单连接，按 `taskId` 订阅事件。客户端发 `{op:"subscribe", taskId:"..."}`，服务端推 3.7 节事件 |

### 5.6 配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/config` | 取 aiWorkbench 配置（admin） |
| POST | `/api/ai/config` | 更新配置（admin，含「测试连接」标志） |
| POST | `/api/ai/config/test` | 测试 ComfyUI 可达性，返回 `{ ok, version, latencyMs }` |

---

## 6. 前端交互

### 6.1 页面结构

- 新页面 `/ai-workbench.html`（侧边栏加入口）
- 三栏布局：
  - **左**：节点库面板（通用节点 + 已上传自定义节点），拖拽到画布
  - **中**：画布（SVG/Canvas 渲染节点与连线，可平移缩放）
  - **右**：可折叠面板（执行日志 / 任务历史 / 节点属性编辑切换）

### 6.2 节点卡片

- 标题栏：节点名 + 类型徽标 + 删除按钮
- 中间：端口列表（左侧输入端口，右侧输出端口，圆点 + 类型色 + 名称）
- 底部：内联编辑区（通用节点显示输入控件，自定义节点显示端口默认值 + 隐藏开关）
- 状态徽标（执行期间右上角）：⏳▶✅❌⤵

### 6.3 执行控制栏

- 顶部工具条：「执行」「保存」「另存为」「重命名」「清空选择」
- 队列状态条（工具条下方常驻）：
  - 「待执行：M」显示全局排队任务数
  - 「当前执行：task_XXX · 步骤 K/N · 节点名」显示运行中任务进度
  - 无任务时显示「空闲」
- 运行中任务显示按钮：「暂停」「终止」
- 暂停中任务显示按钮：「恢复」「终止」
- 排队中任务（在任务历史/队列面板中）显示按钮：「取消」
- 执行时画布只读；任务运行/暂停期间禁止编辑该画布

### 6.4 结果展示

- 任务完成后在画布右下角弹出结果卡片：
  - 图片：缩略图 + 「在文件管理器中打开」「下载」按钮
  - 视频：缩略图 + 播放按钮（点击在工作台内预览）
  - 文本：截断显示 + 「查看全文」

### 6.5 任务详情视图

- 从任务列表点击任意任务打开详情抽屉（右侧滑出），三个 Tab：
  - **输入资源**：列出所有输入节点的资源（缩略图/值 + 路径 + 「下载」/「在文件管理器中打开」）
  - **生成结果**：列出所有输出节点产物（缩略图/预览 + 路径 + 「下载」/「预览」/「在文件管理器中打开」）+ 顶部「全部下载（zip）」
  - **执行日志**：完整日志查看（带过滤、复制、「下载日志」）
- 下载按钮统一调用 `/api/file?path=...` 复用现有文件下载（认证 + Range）；zip 下载调用 `/api/ai/tasks/:id/results.zip`
- 运行中/排队中任务点开详情时，三 Tab 切换为实时视图（输入资源已确定、结果与日志随执行滚动）

---

## 7. 非功能需求

| 项 | 要求 |
|----|------|
| 性能 | 画布流畅渲染 ≥100 个节点；WebSocket 日志推送延迟 < 200ms |
| 并发 | `maxConcurrentTasks=1`（v1 严格串行，避免 GPU 抢占） |
| 可靠性 | 任务执行中服务重启 → 任务标记为 aborted，前端提示并允许重新执行 |
| 安全 | 复用现有认证/CSRF/白名单；上传的 ComfyUI JSON 严格校验结构；prompt 占位符注入做转义防 JSON 破坏 |
| 存储 | results 目录按 `keepResultsDays` 自动清理（定时任务，默认 30 天） |
| 兼容 | 不破坏现有文件管理器功能；工作台模块可独立开关（`aiWorkbench.enabled`） |
| 浏览器 | 与现有前端一致（现代 Chrome/Firefox/Edge） |

---

## 8. 错误处理与边界情况

### 8.1 错误分级

| 场景 | 处理 |
|------|------|
| ComfyUI 不可达 | 任务开始前测试连接，失败则不进入执行，提示用户检查配置 |
| 输入文件在 file-manager 中不存在 | 子任务失败，日志记录路径 |
| ComfyUI 执行报错（缺模型/缺节点） | 子任务失败，把 ComfyUI 错误原文写入日志，画布标红该节点 |
| 网络中断 | WebSocket 重连，任务在服务端继续执行；前端重连后追不上进度时拉 `/tasks/:id` 补齐 |
| 占位符未提供值（既无连接又无默认值） | 校验阶段报错，不允许执行 |
| 画布有环 | 校验阶段报错，高亮成环节点 |

### 8.2 边界情况

- **空画布执行**：禁止，提示「至少需要一个输出节点」
- **只有通用节点没有自定义节点**：允许，输出节点直接显示输入文件（用于预览链路）
- **多个输出节点**：并行收集所有输出，全部保存
- **同一文件被多个图片输入引用**：只上传 ComfyUI 一次
- **自定义节点定义被删除但被工作流引用**：工作流加载时标红「定义缺失」，不可执行
- **ComfyUI 输出多个文件**（如 SaveImage 输出多张）：输出端口值为数组，下游输出节点逐个保存
- **大视频上传 ComfyUI**：走流式上传，显示进度
- **任务超时**：达到 `execTimeoutMs` 后标记失败并中止

---

## 9. 实现分层建议

> 给后续设计/实现阶段的指引，非需求本身。

```
routes/ai-workbench.js      # 工作流/节点定义/任务/配置 REST 路由
services/ai/
  ├── comfyui-client.js     # 封装 ComfyUI REST + WS 调用
  ├── prompt-builder.js     # 占位符替换 + 输入文件上传回填
  ├── workflow-parser.js    # 上传 JSON 自动解析为节点定义
  ├── task-manager.js       # 拓扑排序 + 串行执行调度
  └── ws-bus.js             # 前端 WebSocket 推送 + ComfyUI WS 转发
public/ai-workbench.html
public/ai-workbench.js      # 画布编辑器 + 节点/连线渲染 + ws 客户端
public/ai-workbench.css
```

任务管理器用内存队列 + 单 worker（v1），任务历史与日志落磁盘。

---

## 10. 验收标准（闭环检查清单）

- [ ] 可上传 ComfyUI API JSON 自动生成自定义节点，端口识别正确
- [ ] 可拖拽通用/自定义/输出节点到画布并连线
- [ ] 图片/视频输入可从文件管理器或历史任务结果中选择文件
- [ ] 输出节点透传：输入既被保存展示，也能继续向下游连接
- [ ] 连接类型校验生效，环路检测生效
- [ ] 工作流可保存、加载、另存为、删除
- [ ] 点击执行后任务进入队列，任务管理器按拓扑序串行调用 ComfyUI
- [ ] 顶部常驻显示「待执行数」与「当前执行任务号 + 步骤进度」
- [ ] 排队任务可取消，运行任务可暂停/恢复/终止，状态通过 WebSocket 实时同步
- [ ] 每个子任务状态、进度、日志通过 WebSocket 实时显示在画布与日志面板
- [ ] 任意子任务失败立即停止，失败节点标红，后续标为已跳过
- [ ] 成功结果保存到 `.aiworkbench/results/<task_id>/` 并在工作台展示
- [ ] 完整日志保存到 `.aiworkbench/logs/<task_id>.log`，可在任务历史查看
- [ ] 任务列表中完成任务可下载结果、查看日志；点击任务打开详情视图（输入资源/生成结果/执行日志三 Tab，均可下载，支持结果全部下载 zip）
- [ ] ComfyUI 不可达时给出清晰提示，不产生僵尸任务
- [ ] 未登录用户无法访问工作台
- [ ] 现有文件管理器功能不受影响

---

## 11. 后续版本规划（不在 v1 范围）

- v2：节点级并行执行、ComfyUI 与 file-manager 共享磁盘的零拷贝优化
- v2：工作流版本管理、diff、回滚
- v3：节点输出缓存（相同输入复用结果）、批量执行（对一组输入文件跑同一工作流）
- v3：节点市场（分享自定义节点定义）
- v4：多用户隔离与协作编辑