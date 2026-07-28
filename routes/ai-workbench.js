// AI workbench REST routes: config, node-defs, workflows, tasks.
const express = require('express');
const fs = require('fs');
const path = require('path');
const storage = require('../services/ai/storage');
const { parseWorkflow } = require('../services/ai/workflow-parser');
const { testConnection } = require('../services/ai/comfyui-client');
const taskManager = require('../services/ai/task-manager');
const taskScheduler = require('../services/ai/task-scheduler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isValidAiId } = require('../utils/identifiers');
const { normalizeFileRef, resolveFileRef } = require('../services/file-ref-service');
const { snapshotWorkflowInputs } = require('../services/ai/workflow-inputs');
const canonicalWorkflow = require('../services/ai/canonical-workflow');
const {
  InfiniteCanvasClient,
  normalizeSidecarUrl,
  upstream: infiniteCanvasUpstream,
} = require('../services/ai/infinite-canvas-client');
const {
  validateImportId,
  importAuthorizedImage,
} = require('../services/ai/infinite-canvas-import-service');
const {
  DEFAULT_AI_WORK_DIR,
  assertSeparatedWorkDir,
} = require('../services/ai/work-dir-policy');

const DEFAULT_AI_CONFIG = {
  enabled: true,
  comfyuiUrl: 'http://127.0.0.1:8188',
  connectTimeoutMs: 5000,
  execTimeoutMs: 600000,
  maxConcurrentTasks: 1,
  keepResultsDays: 30,
  workDir: DEFAULT_AI_WORK_DIR,
  infiniteCanvas: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:7862',
    upstreamBaseUrl: 'http://127.0.0.1:7863',
    allowExecution: false,
    requestTimeoutMs: 5000,
  },
};
const MAX_BATCH_TASKS = 100;

function sanitizeAiConfig(input) {
  const out = {};
  if (input.comfyuiUrl !== undefined) out.comfyuiUrl = String(input.comfyuiUrl).trim();
  if (input.connectTimeoutMs !== undefined) out.connectTimeoutMs = parseInt(input.connectTimeoutMs, 10) || 5000;
  if (input.execTimeoutMs !== undefined) out.execTimeoutMs = parseInt(input.execTimeoutMs, 10) || 600000;
  if (input.maxConcurrentTasks !== undefined) out.maxConcurrentTasks = Math.max(1, Math.min(8, parseInt(input.maxConcurrentTasks, 10) || 1));
  if (input.keepResultsDays !== undefined) out.keepResultsDays = parseInt(input.keepResultsDays, 10);
  if (input.enabled !== undefined) out.enabled = !!input.enabled;
  if (input.workDir !== undefined) out.workDir = String(input.workDir).trim() || DEFAULT_AI_WORK_DIR;
  if (input.defaultPreset !== undefined) out.defaultPreset = String(input.defaultPreset).trim() || '';
  if (input.infiniteCanvas !== undefined) {
    if (!input.infiniteCanvas || typeof input.infiniteCanvas !== 'object' || Array.isArray(input.infiniteCanvas)) {
      const err = new Error('infiniteCanvas 配置必须是对象');
      err.code = 'INVALID_INFINITE_CANVAS_CONFIG';
      throw err;
    }
    const sidecar = {};
    if (input.infiniteCanvas.enabled !== undefined) sidecar.enabled = Boolean(input.infiniteCanvas.enabled);
    if (input.infiniteCanvas.baseUrl !== undefined) sidecar.baseUrl = normalizeSidecarUrl(input.infiniteCanvas.baseUrl);
    if (input.infiniteCanvas.upstreamBaseUrl !== undefined) sidecar.upstreamBaseUrl = normalizeSidecarUrl(input.infiniteCanvas.upstreamBaseUrl);
    if (input.infiniteCanvas.allowExecution !== undefined) sidecar.allowExecution = Boolean(input.infiniteCanvas.allowExecution);
    if (input.infiniteCanvas.requestTimeoutMs !== undefined) {
      sidecar.requestTimeoutMs = Math.max(250, Math.min(30000, Number.parseInt(input.infiniteCanvas.requestTimeoutMs, 10) || 5000));
    }
    out.infiniteCanvas = sidecar;
  }
  return out;
}

module.exports = function ({ config }) {
  const router = express.Router();
  router.use(requireAuth);

  function currentAiConfig() {
    const saved = config.aiWorkbench || {};
    return {
      ...DEFAULT_AI_CONFIG,
      ...saved,
      infiniteCanvas: {
        ...DEFAULT_AI_CONFIG.infiniteCanvas,
        ...(saved.infiniteCanvas || {}),
      },
    };
  }

  function ensureLegacyExecutor(workflow, res) {
    const executorType = workflow && workflow.executor && workflow.executor.type || 'legacy-comfyui';
    if (executorType === 'legacy-comfyui') return true;
    res.status(409).json({
      error: 'Infinite-Canvas 执行器尚未通过隔离集成验收，当前仅允许保存和迁移预览',
      code: 'INFINITE_CANVAS_EXECUTOR_NOT_READY',
    });
    return false;
  }

  function createInfiniteCanvasClient(sidecarConfig = currentAiConfig().infiniteCanvas) {
    return new InfiniteCanvasClient({
      baseUrl: sidecarConfig.baseUrl,
      timeoutMs: sidecarConfig.requestTimeoutMs,
      gatewayToken: process.env.INFINITE_CANVAS_GATEWAY_TOKEN,
    });
  }

  function requireInfiniteCanvasEnabled(res) {
    if (currentAiConfig().infiniteCanvas.enabled) return true;
    res.status(409).json({ error: 'Infinite-Canvas sidecar 未启用', code: 'INFINITE_CANVAS_DISABLED' });
    return false;
  }

  function canvasExecutionConfig() {
    const aiConfig = currentAiConfig();
    return {
      comfyuiUrl: aiConfig.comfyuiUrl,
      infiniteCanvasBaseUrl: aiConfig.infiniteCanvas.upstreamBaseUrl,
      execTimeoutMs: aiConfig.execTimeoutMs,
      rootDir: config.rootDir,
      fileRoots: { main: config.rootDir },
    };
  }

  function enqueueCanvasExecution(kind, request, submittedBy) {
    const aiConfig = currentAiConfig();
    if (!aiConfig.infiniteCanvas.enabled || !aiConfig.infiniteCanvas.allowExecution) {
      const err = new Error('Infinite-Canvas 执行尚未启用');
      err.code = 'INFINITE_CANVAS_EXECUTION_DISABLED';
      throw err;
    }
    const workflowId = storage.genId('wf');
    const taskId = storage.genId('task');
    const workflow = canonicalWorkflow.createWorkflow({
      id: workflowId,
      name: `Infinite-Canvas ${kind}`,
      nodes: [{ id: 'canvas_request', type: 'canvas-request', data: {} }],
      edges: [],
      executor: {
        type: 'infinite-canvas',
        payloadVersion: 1,
        payload: { kind, request },
      },
    }, { id: workflowId, author: submittedBy });
    taskScheduler.enqueue(taskId, workflow, canvasExecutionConfig(), { submittedBy });
    return taskId;
  }

  async function waitForCanvasExecution(taskId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const record = storage.getTaskRecord(taskId);
      if (record && record.status === 'completed') return record.canvasResult;
      if (record && ['failed', 'aborted', 'cancelled'].includes(record.status)) {
        const err = new Error(record.error || `Infinite-Canvas 任务${record.status}`);
        err.code = 'INFINITE_CANVAS_EXECUTION_FAILED';
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const err = new Error('Infinite-Canvas 网关等待任务超时');
    err.code = 'INFINITE_CANVAS_EXECUTION_TIMEOUT';
    throw err;
  }

  function enqueueOrRespond(res, taskId, workflow, aiConfig, submittedBy) {
    try {
      taskScheduler.enqueue(taskId, workflow, aiConfig, { submittedBy });
      return true;
    } catch (err) {
      const queueFull = err.code === 'TASK_QUEUE_FULL';
      console.error(`[ai] Failed to enqueue task ${taskId}: ${err.message}`);
      res.status(queueFull ? 429 : 503).json({
        error: queueFull ? err.message : 'AI 任务暂时无法入队，请检查工作目录后重试',
        code: err.code || 'TASK_QUEUE_UNAVAILABLE',
      });
      return false;
    }
  }
  router.param('id', (req, res, next, id) => {
    const expectedPrefix = req.path.startsWith('/node-defs/') ? 'def'
      : req.path.startsWith('/workflows/') ? 'wf'
        : req.path.startsWith('/tasks/') ? 'task'
          : undefined;
    if (!isValidAiId(id, expectedPrefix)) {
      return res.status(400).json({ error: 'Invalid AI identifier', code: 'INVALID_AI_ID' });
    }
    next();
  });

  async function parseSubmittedFileRefs(body) {
    const submitted = Array.isArray(body && body.imageRefs)
      ? body.imageRefs
      : (Array.isArray(body && body.imagePaths) ? body.imagePaths : null);
    if (!submitted || !submitted.length) return null;
    const refs = submitted.map(item => normalizeFileRef(item));
    if (!refs.every(Boolean)) return null;
    try {
      const resolved = await Promise.all(refs.map(ref => resolveFileRef(ref, { main: config.rootDir })));
      return resolved.map(item => item.ref);
    } catch (_) {
      return null;
    }
  }

  function validWorkflowId(workflowId) {
    return isValidAiId(workflowId, 'wf');
  }

  // ---------- Config ----------
  router.get('/config', requireAdmin, (_req, res) => {
    res.json({
      ...currentAiConfig(),
      infiniteCanvasUpstream: {
        repository: infiniteCanvasUpstream.repository,
        pinnedCommit: infiniteCanvasUpstream.pinnedCommit,
        contractVersion: infiniteCanvasUpstream.adapterContractVersion,
      },
    });
  });
  router.post('/config', requireAdmin, (req, res) => {
    let patch;
    try {
      patch = sanitizeAiConfig(req.body || {});
      if (patch.workDir) assertSeparatedWorkDir(patch.workDir, config.rootDir);
    } catch (err) {
      return res.status(400).json({ error: err.message, code: err.code || 'INVALID_AI_CONFIG' });
    }
    const queue = taskScheduler.snapshot();
    const oldConfig = currentAiConfig();
    const oldWorkDir = oldConfig.workDir;
    if (patch.workDir && patch.workDir !== oldWorkDir && (queue.runningCount || queue.queuedCount)) {
      return res.status(409).json({ error: '任务队列非空时不能切换 AI 工作目录', code: 'TASK_QUEUE_ACTIVE' });
    }
    config.aiWorkbench = {
      ...oldConfig,
      ...patch,
      infiniteCanvas: {
        ...oldConfig.infiniteCanvas,
        ...(patch.infiniteCanvas || {}),
      },
    };
    config.saveConfig({ aiWorkbench: config.aiWorkbench });

    // Re-create directories to match new workDir (e.g. absolute path change)
    const storage = require('../services/ai/storage');
    storage.invalidateWorkDir(); // drop cached resolution so new workDir is picked up
    storage.ensureDirs();
    taskScheduler.configure(config.aiWorkbench.maxConcurrentTasks);

    res.json(config.aiWorkbench);
  });
  router.post('/config/test', requireAuth, async (req, res) => {
    const url = (req.body && req.body.comfyuiUrl) || (config.aiWorkbench && config.aiWorkbench.comfyuiUrl) || DEFAULT_AI_CONFIG.comfyuiUrl;
    const timeoutMs = (config.aiWorkbench && config.aiWorkbench.connectTimeoutMs) || 5000;
    const result = await testConnection(url, timeoutMs);
    res.json(result);
  });

  router.post('/config/test-infinite-canvas', requireAdmin, async (req, res) => {
    try {
      const patch = sanitizeAiConfig({ infiniteCanvas: req.body || {} });
      const sidecarConfig = { ...currentAiConfig().infiniteCanvas, ...patch.infiniteCanvas };
      const client = createInfiniteCanvasClient(sidecarConfig);
      res.json(await client.health());
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message, code: err.code || 'SIDECAR_HEALTH_FAILED' });
    }
  });

  router.get('/infinite-canvas/status', async (_req, res) => {
    const sidecarConfig = currentAiConfig().infiniteCanvas;
    const base = {
      enabled: sidecarConfig.enabled,
      contractVersion: infiniteCanvasUpstream.adapterContractVersion,
      upstreamCommit: infiniteCanvasUpstream.pinnedCommit,
    };
    if (!sidecarConfig.enabled) return res.json({ ...base, healthy: false, state: 'disabled' });
    try {
      const client = createInfiniteCanvasClient(sidecarConfig);
      res.json({ ...base, ...(await client.health()), healthy: true, state: 'ready' });
    } catch (err) {
      res.json({ ...base, healthy: false, state: 'unavailable', code: err.code || 'SIDECAR_UNAVAILABLE' });
    }
  });

  for (const [routeName, kind] of [['canvas-image-tasks', 'image'], ['canvas-comfy-tasks', 'comfy']]) {
    router.post(`/canvas/upstream/api/${routeName}`, (req, res) => {
      try {
        const taskId = enqueueCanvasExecution(kind, req.body || {}, req.user.username);
        res.json({ task_id: taskId, status: 'queued', gateway_managed: true });
      } catch (err) {
        const disabled = err.code === 'INFINITE_CANVAS_EXECUTION_DISABLED';
        res.status(disabled ? 409 : 400).json({ error: err.message, code: err.code || 'INVALID_CANVAS_TASK' });
      }
    });
    router.get(`/canvas/upstream/api/${routeName}/:taskId`, (req, res) => {
      if (!isValidAiId(req.params.taskId, 'task')) {
        return res.status(400).json({ error: 'Invalid canvas task identifier', code: 'INVALID_AI_ID' });
      }
      const record = storage.getTaskRecord(req.params.taskId);
      if (!record || record.executorType !== 'infinite-canvas') {
        return res.status(404).json({ error: '画布任务不存在', code: 'TASK_NOT_FOUND' });
      }
      const status = {
        queued: 'queued',
        running: 'running',
        paused: 'running',
        terminating: 'running',
        completed: 'succeeded',
        failed: 'failed',
        aborted: 'failed',
        cancelled: 'failed',
      }[record.status] || record.status;
      res.json({
        id: record.id,
        status,
        result: status === 'succeeded' ? record.canvasResult : null,
        error: status === 'failed' ? (record.error || `任务${record.status}`) : '',
        gateway_managed: true,
      });
    });
  }

  for (const [routeName, kind] of [['canvas-video', 'video'], ['canvas-llm', 'llm']]) {
    router.post(`/canvas/upstream/api/${routeName}`, async (req, res) => {
      try {
        const taskId = enqueueCanvasExecution(kind, req.body || {}, req.user.username);
        const result = await waitForCanvasExecution(taskId, currentAiConfig().execTimeoutMs);
        res.json(result);
      } catch (err) {
        const disabled = err.code === 'INFINITE_CANVAS_EXECUTION_DISABLED';
        res.status(disabled ? 409 : 502).json({ error: err.message, code: err.code || 'INFINITE_CANVAS_EXECUTION_FAILED' });
      }
    });
  }

  // Older Infinite-Canvas views still call these synchronous endpoints.
  // Adapt them to the same project-owned queue instead of exposing the raw
  // upstream execution API through the generic proxy.
  for (const [routeName, kind] of [['online-image', 'image'], ['image-task-query', 'image-query']]) {
    router.post(`/canvas/upstream/api/${routeName}`, async (req, res) => {
      try {
        const taskId = enqueueCanvasExecution(kind, req.body || {}, req.user.username);
        const result = await waitForCanvasExecution(taskId, currentAiConfig().execTimeoutMs);
        res.json(result);
      } catch (err) {
        const disabled = err.code === 'INFINITE_CANVAS_EXECUTION_DISABLED';
        res.status(disabled ? 409 : 502).json({ error: err.message, code: err.code || 'INFINITE_CANVAS_EXECUTION_FAILED' });
      }
    });
  }

  router.post('/infinite-canvas/imports', async (req, res) => {
    if (!requireInfiniteCanvasEnabled(res)) return;
    try {
      const result = await importAuthorizedImage({
        fileRef: req.body && req.body.fileRef,
        roots: { main: config.rootDir },
        client: createInfiniteCanvasClient(),
        publishClient: new InfiniteCanvasClient({
          baseUrl: currentAiConfig().infiniteCanvas.upstreamBaseUrl,
          timeoutMs: Math.min(currentAiConfig().execTimeoutMs, 120000),
          gatewayToken: process.env.INFINITE_CANVAS_GATEWAY_TOKEN,
        }),
      });
      res.status(201).json({ success: true, ...result });
    } catch (err) {
      const notFound = ['FILE_REF_NOT_FOUND', 'FILE_REF_NOT_FILE'].includes(err.code);
      const tooLarge = ['IMPORT_SIZE_LIMIT', 'IMPORT_PIXEL_LIMIT'].includes(err.code);
      const invalidInput = [
        'INVALID_FILE_REF', 'UNKNOWN_FILE_ROOT', 'FILE_REF_VERSION_CHANGED',
        'UNSUPPORTED_IMPORT_TYPE', 'INVALID_IMPORT_IMAGE', 'IMPORT_TYPE_MISMATCH',
      ].includes(err.code);
      const status = notFound ? 404 : tooLarge ? 413 : invalidInput ? 400 : 502;
      res.status(status).json({
        error: status === 502 ? 'Infinite-Canvas sidecar 导入失败' : err.message,
        code: err.code || 'INFINITE_CANVAS_IMPORT_FAILED',
      });
    }
  });

  router.delete('/infinite-canvas/imports/:importId', async (req, res) => {
    if (!requireInfiniteCanvasEnabled(res)) return;
    if (!validateImportId(req.params.importId)) {
      return res.status(400).json({ error: 'Invalid Infinite-Canvas import identifier', code: 'INVALID_IMPORT_ID' });
    }
    try {
      const result = await createInfiniteCanvasClient().deleteImport(req.params.importId);
      res.json({ success: true, importId: result.importId, deleted: true });
    } catch (err) {
      const notFound = err.status === 404 && err.sidecarCode === 'IMPORT_NOT_FOUND';
      res.status(notFound ? 404 : 502).json({
        error: notFound ? 'Infinite-Canvas 导入不存在' : 'Infinite-Canvas sidecar 删除导入失败',
        code: notFound ? 'IMPORT_NOT_FOUND' : (err.code || 'INFINITE_CANVAS_DELETE_FAILED'),
      });
    }
  });

  // ---------- Shared presets (team) ----------
  router.get('/presets', (req, res) => {
    const list = storage.presets.list().map(p => ({ name: p.name, updatedAt: p.updatedAt, author: p.author, isDefault: p.name === (config.aiWorkbench && config.aiWorkbench.defaultPreset) }));
    res.json({ presets: list });
  });
  router.get('/presets/:name', (req, res) => {
    const p = storage.presets.get(req.params.name);
    if (!p) return res.status(404).json({ error: '预设不存在' });
    res.json(p);
  });
  router.post('/presets', requireAdmin, (req, res) => {
    const { name, settings } = req.body;
    if (!name || !settings) return res.status(400).json({ error: '需要 name 和 settings' });
    const doc = { name, settings, updatedAt: new Date().toISOString(), author: req.user.username };
    storage.presets.save(doc);
    res.json({ success: true, name });
  });
  router.delete('/presets/:name', requireAdmin, (req, res) => {
    storage.presets.remove(req.params.name);
    // clear default if it was the default
    if (config.aiWorkbench && config.aiWorkbench.defaultPreset === req.params.name) {
      config.aiWorkbench.defaultPreset = '';
      config.saveConfig({ aiWorkbench: config.aiWorkbench });
    }
    res.json({ success: true });
  });
  router.post('/presets/default', requireAdmin, (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    config.aiWorkbench = { ...DEFAULT_AI_CONFIG, ...(config.aiWorkbench || {}) };
    config.aiWorkbench.defaultPreset = name;
    config.saveConfig({ aiWorkbench: config.aiWorkbench });
    res.json({ success: true, defaultPreset: name });
  });

  // ---------- Node definitions ----------
  router.get('/node-defs', (req, res) => {
    const list = storage.nodeDefs.list().map(d => ({
      id: d.id, name: d.name, createdAt: d.createdAt, author: d.author,
      portCount: { in: d.ports.inputs.length, out: d.ports.outputs.length },
    }));
    res.json({ defs: list });
  });
  router.get('/node-defs/:id', (req, res) => {
    const def = storage.nodeDefs.get(req.params.id);
    if (!def) return res.status(404).json({ error: '节点定义不存在' });
    res.json(def);
  });
  router.post('/node-defs', async (req, res) => {
    const { name, json } = req.body;
    if (!json) return res.status(400).json({ error: '请提供 ComfyUI workflow JSON' });
    try {
      const id = storage.genId('def');
      const def = parseWorkflow(json, { id, name: name || '未命名节点', author: req.user.username });
      storage.nodeDefs.save(def);
      res.json({ success: true, id: def.id, name: def.name, ports: def.ports });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  router.put('/node-defs/:id', (req, res) => {
    const def = storage.nodeDefs.get(req.params.id);
    if (!def) return res.status(404).json({ error: '节点定义不存在' });
    const { name, ports } = req.body;
    if (name) def.name = name;
    if (ports) def.ports = ports;
    storage.nodeDefs.save(def);
    res.json({ success: true });
  });
  router.delete('/node-defs/:id', (req, res) => {
    storage.nodeDefs.remove(req.params.id);
    res.json({ success: true });
  });

  // ---------- Workflows ----------
  router.get('/workflows', (_req, res) => {
    const list = storage.workflows.list().map(w => ({
      id: w.id, name: w.name, createdAt: w.createdAt, updatedAt: w.updatedAt, author: w.author,
      nodeCount: (w.nodes || []).length,
      schemaVersion: w.schemaVersion || 0,
      revision: w.revision || 1,
      executorType: w.executor && w.executor.type || 'legacy-comfyui',
    }));
    res.json({ workflows: list });
  });
  // Workflows whose root nodes (indegree-0) are ALL image-input.
  // Returns imageInputs list (topo order) so the client can prompt
  // the user to pick one image per slot for multi-image workflows.
  router.get('/workflows-for-images', (_req, res) => {
    const list = storage.workflows.list()
      .filter(w => !w.executor || w.executor.type === 'legacy-comfyui')
      .map(w => {
      const nodes = w.nodes || [];
      const edges = w.edges || [];
      const indeg = {};
      nodes.forEach(n => { indeg[n.id] = 0; });
      edges.forEach(e => { const dst = e.to.split('.')[0]; indeg[dst] = (indeg[dst] || 0) + 1; });
      const roots = nodes.filter(n => indeg[n.id] === 0);
      const imageInputs = roots
        .filter(n => n.type === 'image-input')
        .sort((a, b) => (a.y - b.y) || (a.x - b.x))
        .map((n, i) => ({ nodeId: n.id, label: `图片 ${i + 1}`, x: n.x, y: n.y }));
      // All roots must be image-input and there must be at least one
      const ok = roots.length > 0 && roots.every(n => n.type === 'image-input');
      return { id: w.id, name: w.name, imageInputs: ok ? imageInputs : [], ok };
      }).filter(w => w.ok).map(w => ({
      id: w.id, name: w.name, imageInputCount: w.imageInputs.length, imageInputs: w.imageInputs,
    }));
    res.json({ workflows: list });
  });
  router.get('/workflows/:id', (req, res) => {
    const w = storage.workflows.get(req.params.id);
    if (!w) return res.status(404).json({ error: '工作流不存在' });
    try {
      res.json(canonicalWorkflow.readCompatible(w));
    } catch (err) {
      res.status(422).json({ error: err.message, code: err.code || 'INVALID_WORKFLOW' });
    }
  });
  router.post('/workflows', (req, res) => {
    const { name, nodes, edges, executor } = req.body;
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return res.status(400).json({ error: '需要 nodes 与 edges 数组' });
    }
    const id = storage.genId('wf');
    try {
      const wf = canonicalWorkflow.createWorkflow(
        { id, name: name || '未命名工作流', nodes, edges, executor },
        { id, author: req.user.username },
      );
      storage.workflows.save(wf);
      res.json({ success: true, id, name: wf.name, schemaVersion: wf.schemaVersion, revision: wf.revision });
    } catch (err) {
      res.status(400).json({ error: err.message, code: err.code || 'INVALID_WORKFLOW' });
    }
  });
  router.put('/workflows/:id', (req, res) => {
    const w = storage.workflows.get(req.params.id);
    if (!w) return res.status(404).json({ error: '工作流不存在' });
    try {
      const compatible = canonicalWorkflow.readCompatible(w);
      const updated = canonicalWorkflow.updateWorkflow(compatible, req.body || {});
      storage.workflows.save(updated);
      res.json({ success: true, schemaVersion: updated.schemaVersion, revision: updated.revision });
    } catch (err) {
      res.status(400).json({ error: err.message, code: err.code || 'INVALID_WORKFLOW' });
    }
  });
  router.delete('/workflows/:id', (req, res) => {
    storage.workflows.remove(req.params.id);
    res.json({ success: true });
  });

  // ---------- Tasks ----------
  router.post('/tasks', async (req, res) => {
    const { workflowId } = req.body;
    if (!validWorkflowId(workflowId)) {
      return res.status(400).json({ error: 'Invalid workflow identifier', code: 'INVALID_AI_ID' });
    }
    const w = storage.workflows.get(workflowId);
    if (!w) return res.status(404).json({ error: '工作流不存在' });
    if (!ensureLegacyExecutor(w, res)) return;
    if (!config.aiWorkbench || config.aiWorkbench.enabled === false) {
      return res.status(400).json({ error: 'AI 工作台未启用' });
    }
    const aiConfig = {
      comfyuiUrl: (config.aiWorkbench && config.aiWorkbench.comfyuiUrl) || DEFAULT_AI_CONFIG.comfyuiUrl,
      execTimeoutMs: (config.aiWorkbench && config.aiWorkbench.execTimeoutMs) || 600000,
      rootDir: config.rootDir,
      fileRoots: { main: config.rootDir },
    };
    let executionWorkflow;
    try {
      executionWorkflow = await snapshotWorkflowInputs(w, aiConfig.fileRoots);
    } catch (err) {
      return res.status(400).json({ error: err.message, code: err.code || 'INVALID_FILE_REF' });
    }
    const taskId = storage.genId('task');
    // fire and forget — runTask updates history + live registry
    if (!enqueueOrRespond(res, taskId, executionWorkflow, aiConfig, req.user.username)) return;
    res.json({ success: true, taskId, status: 'queued' });
  });

  // Batch: submit one task per image path (right-click context menu in file manager)
  router.post('/tasks/batch', async (req, res) => {
    const { workflowId } = req.body;
    if (!validWorkflowId(workflowId)) {
      return res.status(400).json({ error: 'Invalid workflow identifier', code: 'INVALID_AI_ID' });
    }
    const imageRefs = await parseSubmittedFileRefs(req.body);
    if (imageRefs && imageRefs.length > MAX_BATCH_TASKS) {
      return res.status(400).json({ error: `单次最多提交 ${MAX_BATCH_TASKS} 个任务`, code: 'BATCH_LIMIT_EXCEEDED' });
    }
    const queue = taskScheduler.snapshot();
    if (imageRefs && queue.runningCount + queue.queuedCount + imageRefs.length > taskScheduler.MAX_QUEUED_TASKS) {
      return res.status(429).json({ error: 'AI 任务队列容量不足，请稍后重试', code: 'TASK_QUEUE_FULL' });
    }
    if (!imageRefs) return res.status(400).json({ error: '请提供有效的图片文件引用' });
    const w = storage.workflows.get(workflowId);
    if (!w) return res.status(404).json({ error: '工作流不存在' });
    if (!ensureLegacyExecutor(w, res)) return;
    if (!config.aiWorkbench || config.aiWorkbench.enabled === false) {
      return res.status(400).json({ error: 'AI 工作台未启用' });
    }
    const aiConfig = {
      comfyuiUrl: (config.aiWorkbench && config.aiWorkbench.comfyuiUrl) || DEFAULT_AI_CONFIG.comfyuiUrl,
      execTimeoutMs: (config.aiWorkbench && config.aiWorkbench.execTimeoutMs) || 600000,
      rootDir: config.rootDir,
      fileRoots: { main: config.rootDir },
    };

    const preparedWorkflows = [];
    try {
      for (const imageRef of imageRefs) {
        const wf = { ...w, nodes: w.nodes.map(n => {
          if (n.type === 'image-input') return { ...n, data: { ...n.data, fileRef: imageRef, path: undefined } };
          return n;
        })};
        preparedWorkflows.push(await snapshotWorkflowInputs(wf, aiConfig.fileRoots));
      }
    } catch (err) {
      return res.status(400).json({ error: err.message, code: err.code || 'INVALID_FILE_REF' });
    }

    const taskIds = [];
    for (const executionWorkflow of preparedWorkflows) {
      const taskId = storage.genId('task');
      taskIds.push(taskId);
      if (!enqueueOrRespond(res, taskId, executionWorkflow, aiConfig, req.user.username)) return;
    }
    res.json({ success: true, taskIds, count: taskIds.length });
  });

  // Multi-image: one task, multiple images mapped positionally to image-input nodes (in topo order)
  router.post('/tasks/with-images', async (req, res) => {
    const { workflowId } = req.body;
    if (!validWorkflowId(workflowId)) {
      return res.status(400).json({ error: 'Invalid workflow identifier', code: 'INVALID_AI_ID' });
    }
    const imageRefs = await parseSubmittedFileRefs(req.body);
    if (!imageRefs) return res.status(400).json({ error: '请提供有效的图片文件引用' });
    const w = storage.workflows.get(workflowId);
    if (!w) return res.status(404).json({ error: '工作流不存在' });
    if (!ensureLegacyExecutor(w, res)) return;
    if (!config.aiWorkbench || config.aiWorkbench.enabled === false) {
      return res.status(400).json({ error: 'AI 工作台未启用' });
    }
    // Resolve image-input nodes in topo/position order (same as /workflows-for-images)
    const indeg = {};
    (w.nodes || []).forEach(n => { indeg[n.id] = 0; });
    (w.edges || []).forEach(e => { const dst = e.to.split('.')[0]; indeg[dst] = (indeg[dst] || 0) + 1; });
    const imgNodes = (w.nodes || []).filter(n => n.type === 'image-input' && indeg[n.id] === 0)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    if (imgNodes.length !== imageRefs.length) {
      return res.status(400).json({ error: `该工作流需要 ${imgNodes.length} 张图片，收到 ${imageRefs.length} 张` });
    }
    const aiConfig = {
      comfyuiUrl: (config.aiWorkbench && config.aiWorkbench.comfyuiUrl) || DEFAULT_AI_CONFIG.comfyuiUrl,
      execTimeoutMs: (config.aiWorkbench && config.aiWorkbench.execTimeoutMs) || 600000,
      rootDir: config.rootDir,
      fileRoots: { main: config.rootDir },
    };
    // Map each path to its node positionally
    const pathById = {};
    imgNodes.forEach((n, i) => { pathById[n.id] = imageRefs[i]; });
    const wf = { ...w, nodes: w.nodes.map(n => {
      if (n.type === 'image-input' && pathById[n.id]) {
        return { ...n, data: { ...n.data, fileRef: pathById[n.id], path: undefined } };
      }
      return n;
    })};
    let executionWorkflow;
    try {
      executionWorkflow = await snapshotWorkflowInputs(wf, aiConfig.fileRoots);
    } catch (err) {
      return res.status(400).json({ error: err.message, code: err.code || 'INVALID_FILE_REF' });
    }
    const taskId = storage.genId('task');
    if (!enqueueOrRespond(res, taskId, executionWorkflow, aiConfig, req.user.username)) return;
    res.json({ success: true, taskId, count: 1, status: 'queued' });
  });

  router.get('/tasks', (_req, res) => {
    const history = storage.loadHistory().tasks;
    const live = taskManager.listLive().map(t => ({
      id: t.id, workflowId: t.workflowId, workflowName: t.workflowName,
      status: t.status, startedAt: t.startedAt, currentStep: t.currentStep,
      stepCount: t.stepCount, failedStep: t.failedStep,
    }));
    res.json({ tasks: history, live });
  });

  router.get('/tasks/queue', (_req, res) => {
    res.json(taskScheduler.snapshot());
  });

  router.get('/tasks/:id', (req, res) => {
    const live = taskManager.getLive(req.params.id);
    if (live) {
      return res.json({
        ...live, results: live.results, inputs: live.inputs,
        logFile: `logs/${live.id}.log`,
      });
    }
    const rec = storage.getTaskRecord(req.params.id);
    if (!rec) return res.status(404).json({ error: '任务不存在' });
    res.json(rec);
  });

  router.get('/tasks/:id/log', (req, res) => {
    const file = path.join(storage._getDirs().logs, `${req.params.id}.log`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: '日志不存在' });
    res.type('text/plain').send(fs.readFileSync(file, 'utf-8'));
  });

  router.get('/tasks/:id/prompt', (req, res) => {
    const file = path.join(storage._getDirs().logs, `${req.params.id}.prompt.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: '无提交的 prompt' });
    res.json(JSON.parse(fs.readFileSync(file, 'utf-8')));
  });

  router.get('/tasks/:id/results.zip', (req, res) => {
    const dir = path.join(storage._getDirs().results, req.params.id);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: '无结果文件' });
    const files = [];
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      try { if (fs.statSync(fp).isFile()) files.push({ name: f, buffer: fs.readFileSync(fp) }); } catch (_) {}
    }
    if (!files.length) return res.status(404).json({ error: '无结果文件' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.zip"`);
    res.send(makeZip(files));
  });

  router.post('/tasks/:id/terminate', (req, res) => {
    const result = taskScheduler.terminate(req.params.id);
    if (!result.accepted) return res.status(409).json({ error: '任务当前不能终止', code: 'TASK_NOT_ACTIVE' });
    res.json({ success: true, ...result });
  });

  router.post('/tasks/:id/cancel', (req, res) => {
    if (!taskScheduler.cancel(req.params.id)) {
      return res.status(409).json({ error: '只有排队中的任务可以取消', code: 'TASK_NOT_QUEUED' });
    }
    res.json({ success: true, status: 'cancelled' });
  });

  router.post('/tasks/:id/pause', (req, res) => {
    if (!taskScheduler.pause(req.params.id)) {
      return res.status(409).json({ error: '任务当前不能暂停', code: 'TASK_NOT_RUNNING' });
    }
    res.json({ success: true, status: 'pause_requested' });
  });

  router.post('/tasks/:id/resume', (req, res) => {
    if (!taskScheduler.resume(req.params.id)) {
      return res.status(409).json({ error: '任务当前不能恢复', code: 'TASK_NOT_PAUSED' });
    }
    res.json({ success: true, status: 'running' });
  });

  // Serve a file from the AI workbench workDir (results/logs/etc.).
  // Path is relative to the dynamically-resolved workDir, so it works
  // even when workDir is an absolute path outside the file-manager root.
  // For backward compat, also try <rootDir>/.aiworkbench/<path> when the
  // current workDir doesn't contain the file and path starts with .aiworkbench/.
  const { getMimeType } = require('../utils/mime');
  function _resolveAiFile(relPath, rootDir) {
    const dirs = storage._getDirs();
    const cleaned = (relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    // strip a leading ".aiworkbench/" so old stored paths still resolve
    const stripped = cleaned.replace(/^\.aiworkbench\//, '');
    const tryResolve = (base) => {
      const resolved = path.resolve(base, stripped);
      const baseNorm = path.normalize(base) + path.sep;
      if (path.normalize(resolved) === path.normalize(base)) return resolved;
      if (!path.normalize(resolved).startsWith(baseNorm)) return null;
      return resolved;
    };
    const primary = tryResolve(dirs.root);
    if (primary && fs.existsSync(primary)) return primary;
    // fallback to old default location under file-manager root
    const oldBase = path.join(rootDir, '.aiworkbench');
    const fallback = tryResolve(oldBase);
    if (fallback && fs.existsSync(fallback)) return fallback;
    return null;
  }
  router.get('/file', (req, res) => {
    const filePath = _resolveAiFile(req.query.path, config.rootDir);
    if (!filePath) return res.status(404).json({ error: '文件不存在' });
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) return res.status(404).json({ error: '文件不存在' });
      const mimeType = getMimeType(filePath);
      const fileSize = stats.size;
      const baseHeaders = { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Content-Length': chunkSize, 'Content-Type': mimeType });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...baseHeaders, 'Content-Length': fileSize, 'Content-Type': mimeType });
        fs.createReadStream(filePath).pipe(res);
      }
    });
  });

  return router;
};

// Minimal ZIP store-mode (no compression) for results download.
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8'), data = f.buffer;
    const crc = crc32(data), size = data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(size, 18); lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10); cd.writeUInt16LE(0, 12);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(size, 20); cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, end]);
}
