// Task manager: builds a DAG from a workflow, resolves node values,
// executes custom nodes (ComfyUI calls) and output nodes (result save +
// pass-through) in topological order, and persists progress + logs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('./storage');
const { TaskLogger } = require('./logger');
const { buildPrompt } = require('./prompt-builder');
const { queuePrompt, waitForPrompt, viewFile, interrupt, normUrl } = require('./comfyui-client');
const { normalizeFileRef, resolveFileRef } = require('../file-ref-service');
const { isTerminal } = require('./task-state');
const infiniteCanvasExecutor = require('./infinite-canvas-executor');
let _sharp = null;
try { _sharp = require('sharp'); } catch (_) { _sharp = null; }

const GENERIC_OUT = {
  'image-input': { name: 'image', type: 'image' },
  'video-input': { name: 'video', type: 'video' },
  'text-input': { name: 'text', type: 'text' },
  'int-input': { name: 'int', type: 'int' },
  'float-input': { name: 'float', type: 'float' },
};

// In-memory live task registry (for polling status while running).
const live = new Map();

function getLive(taskId) { return live.get(taskId) || null; }
function listLive() { return [...live.values()]; }

function pauseTask(taskId) {
  const t = live.get(taskId);
  if (!t || t.status !== 'running' || t.pauseRequested) return false;
  t.pauseRequested = true;
  return true;
}

function resumeTask(taskId) {
  const t = live.get(taskId);
  if (!t || (!t.pauseRequested && t.status !== 'paused')) return false;
  t.pauseRequested = false;
  if (t.resumePausedTask) {
    const resume = t.resumePausedTask;
    t.resumePausedTask = null;
    resume();
  }
  return true;
}

function terminateTask(taskId, options = {}) {
  const t = live.get(taskId);
  if (!t) return infiniteCanvasExecutor.terminateTask(taskId);
  if (isTerminal(t.status) || t.status === 'terminating') return false;
  t.terminateRequested = true;
  t.pauseRequested = false;
  if (t.status === 'running' || t.status === 'paused') {
    storage.transitionTaskRecord(taskId, 'terminating', {
      terminationRequestedAt: new Date().toISOString(),
    });
    t.status = 'terminating';
  }
  if (t.resumePausedTask) {
    const resume = t.resumePausedTask;
    t.resumePausedTask = null;
    resume();
  }
  if (t.abortController) t.abortController.abort();
  if (t.comfyuiUrl && options.allowProviderInterrupt !== false) {
    interrupt(t.comfyuiUrl).catch(err => {
      console.warn(`[ai] Failed to interrupt provider for task ${taskId}: ${err.message}`);
    });
  }
  return true;
}

const abortTask = terminateTask;

async function waitAtPauseBoundary(state, logger, stepIndex) {
  if (!state.pauseRequested || state.terminateRequested) return;
  state.status = 'paused';
  storage.transitionTaskRecord(state.id, 'paused', {
    pausedAt: new Date().toISOString(),
    currentStep: state.currentStep,
  });
  logger.info(stepIndex, '任务已在步骤边界暂停');
  await new Promise(resolve => { state.resumePausedTask = resolve; });
  if (state.terminateRequested) return;
  state.status = 'running';
  storage.transitionTaskRecord(state.id, 'running', {
    resumedAt: new Date().toISOString(),
  });
  logger.info(stepIndex, '任务已恢复');
}

// Topological sort of workflow nodes by edge dependencies.
// Returns { order: [nodeId...], nodeMap, edgesIn: { nodeId: [edge...] } }
function buildGraph(workflow) {
  const nodeMap = {};
  for (const n of workflow.nodes) nodeMap[n.id] = n;
  const edgesIn = {}; // target nodeId -> edges feeding it
  const edgesOut = {}; // source nodeId -> edges leaving it
  for (const e of workflow.edges) {
    const [srcNode] = e.from.split('.');
    const [dstNode] = e.to.split('.');
    (edgesIn[dstNode] = edgesIn[dstNode] || []).push(e);
    (edgesOut[srcNode] = edgesOut[srcNode] || []).push(e);
  }
  // Kahn's algorithm
  const indeg = {};
  for (const n of workflow.nodes) indeg[n.id] = 0;
  for (const e of workflow.edges) indeg[e.to.split('.')[0]]++;
  const queue = workflow.nodes.filter(n => indeg[n.id] === 0).map(n => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const e of (edgesOut[id] || [])) {
      const dst = e.to.split('.')[0];
      indeg[dst]--;
      if (indeg[dst] === 0) queue.push(dst);
    }
  }
  if (order.length !== workflow.nodes.length) {
    throw new Error('画布存在环路，无法执行');
  }
  return { order, nodeMap, edgesIn, edgesOut };
}

function validateWorkflow(workflow) {
  if (!workflow.nodes || workflow.nodes.length === 0) throw new Error('画布为空');
  const hasOutput = workflow.nodes.some(n => n.type === 'output');
  if (!hasOutput) throw new Error('至少需要一个输出节点');
  // every edge must reference existing nodes/ports
  // (port-level validation done here lightly)
  const nodeIds = new Set(workflow.nodes.map(n => n.id));
  for (const e of workflow.edges) {
    if (!nodeIds.has(e.from.split('.')[0]) || !nodeIds.has(e.to.split('.')[0])) {
      throw new Error('存在悬空连接');
    }
  }
}

// Resolve the output value of a generic input node.
function resolveGenericValue(node) {
  const spec = GENERIC_OUT[node.type];
  if (!spec) return null;
  if (node.type === 'image-input' || node.type === 'video-input') {
    const data = node.data || {};
    return { kind: 'file', fileRef: normalizeFileRef(data.fileRef || data.path), type: spec.type };
  }
  return { kind: 'literal', value: node.data && node.data.value, type: spec.type };
}

// Get the resolved value feeding a target port (e.g. "n4.image").
function getValueForPort(values, edgesIn, targetNodeId, targetPort) {
  const edges = edgesIn[targetNodeId] || [];
  const edge = edges.find(e => e.to.split('.')[1] === targetPort);
  if (!edge) return undefined;
  const [srcNode, srcPort] = edge.from.split('.');
  const srcOut = values[srcNode];
  if (!srcOut || !srcOut.outputs) return undefined;
  return srcOut.outputs[srcPort];
}

async function runLegacyTask(taskId, workflow, config) {
  const logger = new TaskLogger(taskId);
  const wfName = workflow.name || '未命名工作流';
  const startedAt = new Date().toISOString();
  const state = {
    id: taskId, workflowId: workflow.id, workflowName: wfName,
    status: 'running', startedAt, currentStep: 0, stepCount: 0,
    failedStep: null, results: [], inputs: [], comfyuiUrl: normUrl(config.comfyuiUrl),
    execStartedAt: null, execFinishedAt: null, execDurationMs: null,
    terminateRequested: false, pauseRequested: false, resumePausedTask: null,
    abortController: new AbortController(),
  };
  live.set(taskId, state);
  const existingRecord = storage.getTaskRecord(taskId);
  if (existingRecord && existingRecord.status === 'queued') {
    storage.transitionTaskRecord(taskId, 'running', { startedAt });
  } else if (existingRecord && existingRecord.status === 'running') {
    storage.updateTaskRecord(taskId, { startedAt: existingRecord.startedAt || startedAt });
  } else if (!existingRecord) {
    storage.addTaskRecord({
      id: taskId, workflowId: workflow.id, workflowName: wfName,
      startedAt, finishedAt: null, status: 'running',
      currentStep: 0, stepCount: 0, failedStep: null,
      inputs: [], results: [], logFile: `logs/${taskId}.log`,
    });
  } else {
    live.delete(taskId);
    throw new Error(`任务 ${taskId} 不能从状态 ${existingRecord.status} 开始执行`);
  }

  logger.info(null, `开始执行工作流「${wfName}」`);
  const uploadCache = new Map();
  const ctx = {
    rootDir: config.rootDir,
    fileRoots: config.fileRoots || { main: config.rootDir },
    comfyuiUrl: normUrl(config.comfyuiUrl),
    uploadCache,
    log: (m) => logger.info(null, m),
  };

  try {
    validateWorkflow(workflow);
    const { order, nodeMap, edgesIn } = buildGraph(workflow);

    // Resolve generic input node values upfront.
    const values = {}; // nodeId -> { outputs: { portName: value } }
    for (const id of order) {
      const node = nodeMap[id];
      if (GENERIC_OUT[node.type]) {
        const spec = GENERIC_OUT[node.type];
        values[id] = { outputs: { [spec.name]: resolveGenericValue(node) } };
        // record input resources
        if (node.type === 'image-input' || node.type === 'video-input') {
          state.inputs.push({
            nodeId: id,
            nodeName: node.type,
            type: spec.type,
            fileRef: values[id].outputs[spec.name].fileRef,
          });
        } else {
          state.inputs.push({ nodeId: id, nodeName: node.type, type: spec.type, value: node.data && node.data.value });
        }
      }
    }

    // Steps = custom + image-process + output nodes in topo order.
    const steps = order.filter(id => ['custom','image-process','output'].includes(nodeMap[id].type));
    state.stepCount = steps.length;
    state.steps = steps.map((id, i) => {
      const n = nodeMap[id];
      const name = n.type === 'custom' ? (storage.nodeDefs.get(n.data && n.data.defId) || {}).name || '自定义节点'
        : n.type === 'image-process' ? '图片处理' : '输出节点';
      return { index: i, nodeId: id, nodeType: n.type, nodeName: name, status: 'queued' };
    });
    logger.info(null, `共 ${steps.length} 个执行步骤`);

    for (let i = 0; i < steps.length; i++) {
      await waitAtPauseBoundary(state, logger, i);
      if (state.terminateRequested) {
        logger.warn(i, `任务被请求终止`);
        throw new Error('任务被终止');
      }
      const node = nodeMap[steps[i]];
      state.currentStep = i + 1;
      if (state.steps[i]) state.steps[i].status = 'running';
      storage.updateTaskRecord(taskId, { currentStep: state.currentStep, steps: state.steps });

      if (node.type === 'custom') {
        const def = storage.nodeDefs.get(node.data && node.data.defId);
        if (!def) throw new Error(`自定义节点定义缺失: ${node.data && node.data.defId}`);
        logger.info(i, `步骤 ${i + 1}/${steps.length}: 执行自定义节点「${def.name}」`);

        // Collect input port values: upstream connection → node override → port default
        const portValues = {};
        for (const port of def.ports.inputs) {
          let v = getValueForPort(values, edgesIn, node.id, port.name);
          if (v === undefined) {
            const override = node.data && node.data.portValues && node.data.portValues[port.name];
            v = override !== undefined ? override : port.default;
          }
          portValues[port.name] = v;
        }

        const prompt = await buildPrompt(def, portValues, { ...ctx, log: (m) => logger.info(i, m) });
        // persist the submitted prompt JSON for later inspection in task details
        state.prompts = state.prompts || [];
        state.prompts.push({ step: i, nodeName: def.name, prompt });
        const dirs = storage._getDirs();
        try { fs.writeFileSync(path.join(dirs.logs, `${taskId}.prompt.json`), JSON.stringify(state.prompts, null, 2), 'utf-8'); } catch (_) {}
        // first ComfyUI call starts the real exec clock
        if (!state.execStartedAt) { state.execStartedAt = new Date().toISOString(); logger.info(i, `执行开始时间: ${state.execStartedAt}`); }
        const clientId = crypto.randomBytes(8).toString('hex');
        logger.info(i, `提交 prompt 到 ComfyUI`);
        const promptId = await queuePrompt(ctx.comfyuiUrl, prompt, clientId);

        const result = await waitForPrompt(ctx.comfyuiUrl, promptId, {
          onProgress: (value, max, nodeLabel) => {
            if (max > 0) logger.info(i, `进度 ${value}/${max} (${nodeLabel || ''})`);
          },
          timeoutMs: config.execTimeoutMs || 600000,
          signal: state.abortController ? state.abortController.signal : undefined,
        });

        // Map ComfyUI outputs to this node's output ports.
        const outputs = {};
        for (const op of def.ports.outputs) {
          const nodeOut = result.outputs[op.sourceNode];
          if (!nodeOut) { logger.warn(i, `输出节点 ${op.sourceNode} 无输出数据`); continue; }
          const file = (nodeOut.images && nodeOut.images[op.sourceOutput]) ||
                       (nodeOut.gifs && nodeOut.gifs[op.sourceOutput]) ||
                       (nodeOut.images && nodeOut.images[0]);
          if (!file) { logger.warn(i, `输出端口 ${op.name} 未找到文件`); continue; }
          outputs[op.name] = {
            kind: 'comfyui-output', filename: file.filename, subfolder: file.subfolder || '',
            type: file.type || 'output', mediaType: op.type,
          };
        }
        values[node.id] = { outputs };
        if (state.steps[i]) state.steps[i].status = 'completed';
        logger.ok(i, `自定义节点「${def.name}」完成`);
      } else if (node.type === 'image-process') {
        logger.info(i, `步骤 ${i + 1}/${steps.length}: 图片处理（sharp）`);
        const inVal = getValueForPort(values, edgesIn, node.id, 'image');
        if (!inVal) throw new Error('图片处理节点未收到输入');
        const out = await processImageNode(taskId, node, inVal, ctx, logger, i);
        values[node.id] = { outputs: { image: out } };
        if (state.steps[i]) state.steps[i].status = 'completed';
        logger.ok(i, `图片处理完成`);
      } else if (node.type === 'output') {
        logger.info(i, `步骤 ${i + 1}/${steps.length}: 输出节点保存结果`);
        const inVal = getValueForPort(values, edgesIn, node.id, 'in');
        if (!inVal) throw new Error('输出节点未收到输入');
        const saved = await saveResult(taskId, wfName, node, inVal, ctx, logger, i);
        if (saved) {
          state.results.push({ port: 'in', nodeId: node.id, nodeName: '输出节点', type: saved.type, file: saved.relPath });
          logger.ok(i, `结果已保存: ${saved.relPath}`);
        }
        // pass-through: output node forwards its input downstream
        values[node.id] = { outputs: { out: inVal } };
        if (state.steps[i]) state.steps[i].status = 'completed';
      }
      storage.updateTaskRecord(taskId, { currentStep: state.currentStep, inputs: state.inputs, results: state.results });
    }

    state.status = 'completed';
    state.execFinishedAt = new Date().toISOString();
    state.execDurationMs = state.execStartedAt ? (new Date(state.execFinishedAt) - new Date(state.execStartedAt)) : null;
    const finishedAt = state.execFinishedAt;
    const durationMs = new Date(finishedAt) - new Date(startedAt);
    const execSec = state.execDurationMs != null ? (state.execDurationMs / 1000).toFixed(1) : '?';
    logger.ok(null, `任务完成，总耗时 ${(durationMs / 1000).toFixed(1)}s，执行耗时 ${execSec}s`);
    storage.transitionTaskRecord(taskId, 'completed', { finishedAt, durationMs, execStartedAt: state.execStartedAt, execFinishedAt: state.execFinishedAt, execDurationMs: state.execDurationMs, results: state.results, inputs: state.inputs });
  } catch (err) {
    state.status = 'failed';
    state.failedStep = state.currentStep;
    if (state.steps) {
      for (let i = 0; i < state.steps.length; i++) {
        if (state.steps[i].status === 'running') state.steps[i].status = 'failed';
        else if (state.steps[i].status === 'queued') state.steps[i].status = 'skipped';
      }
    }
    state.execFinishedAt = new Date().toISOString();
    state.execDurationMs = state.execStartedAt ? (new Date(state.execFinishedAt) - new Date(state.execStartedAt)) : null;
    const finishedAt = state.execFinishedAt;
    logger.error(null, `任务失败: ${err.message}`);
    storage.transitionTaskRecord(taskId, state.terminateRequested ? 'aborted' : 'failed', {
      finishedAt, failedStep: state.currentStep,
      results: state.results, inputs: state.inputs,
      error: err.message,
      execStartedAt: state.execStartedAt, execFinishedAt: state.execFinishedAt, execDurationMs: state.execDurationMs,
    });
    state.status = state.terminateRequested ? 'aborted' : 'failed';
  } finally {
    live.delete(taskId);
  }
}

// Save a result file to .aiworkbench/results/<taskId>/ and return its relpath.
async function saveResult(taskId, wfName, node, value, ctx, logger, stepIdx) {
  const dirs = storage._getDirs();
  const resultsDir = path.join(dirs.results, taskId);
  fs.mkdirSync(resultsDir, { recursive: true });
  const stamp = String(Date.now()).slice(-6);
  const safeWf = wfName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);

  let buffer, ext, mediaType;
  if (value.kind === 'file') {
    // file-manager file — copy
    const resolved = await resolveFileRef(value.fileRef, ctx.fileRoots);
    buffer = await fs.promises.readFile(resolved.absPath);
    ext = path.extname(resolved.absPath).slice(1) || 'bin';
    mediaType = value.type;
  } else if (value.kind === 'comfyui-output') {
    buffer = await viewFile(ctx.comfyuiUrl, { filename: value.filename, subfolder: value.subfolder, type: value.type });
    ext = path.extname(value.filename).slice(1) || (value.mediaType === 'video' ? 'mp4' : 'webp');
    mediaType = value.mediaType;
  } else {
    return null;
  }

  const filename = `${safeWf}_${node.id}_${stamp}.${ext}`;
  const absPath = path.join(resultsDir, filename);
  fs.writeFileSync(absPath, buffer);
  // Path relative to the AI workDir root so /api/ai/file can serve it
  const root = storage._getDirs().root;
  const relPath = path.relative(root, absPath).split(path.sep).join('/');
  return { relPath, type: mediaType };
}

// Resolve an upstream image value to an absolute local file path (downloading
// from ComfyUI if it's a comfyui-output). Returns { absPath, ext }.
async function resolveImageToFile(taskId, nodeId, value, ctx, logger, stepIdx) {
  const dirs = storage._getDirs();
  const tmpDir = path.join(dirs.results, taskId);
  fs.mkdirSync(tmpDir, { recursive: true });
  if (value.kind === 'file') {
    const resolved = await resolveFileRef(value.fileRef, ctx.fileRoots);
    const ext = path.extname(resolved.absPath).slice(1) || 'png';
    return { absPath: resolved.absPath, ext };
  } else if (value.kind === 'comfyui-output') {
    const buffer = await viewFile(ctx.comfyuiUrl, { filename: value.filename, subfolder: value.subfolder, type: value.type });
    const ext = path.extname(value.filename).slice(1) || (value.mediaType === 'video' ? 'mp4' : 'png');
    const f = path.join(tmpDir, `in_${nodeId}_${Date.now()}.${ext}`);
    fs.writeFileSync(f, buffer);
    return { absPath: f, ext };
  }
  throw new Error('图片处理节点需要图片输入');
}

// Execute an image-process node using sharp: resize/crop/rotate/flip/format.
async function processImageNode(taskId, node, inVal, ctx, logger, stepIdx) {
  if (!_sharp) throw new Error('服务器未安装 sharp，无法执行图片处理节点');
  const d = node.data || {};
  const { absPath, ext } = await resolveImageToFile(taskId, node.id, inVal, ctx, logger, stepIdx);

  let pipe = _sharp(absPath, { animated: false });
  // rotate
  const rot = parseInt(d.rotate, 10) || 0;
  if (rot) pipe = pipe.rotate(rot);
  // flip / flop (vertical / horizontal)
  if (d.flipV) pipe = pipe.flip();
  if (d.flipH) pipe = pipe.flop();
  // resize
  const w = d.width != null && d.width !== '' ? parseInt(d.width, 10) : null;
  const h = d.height != null && d.height !== '' ? parseInt(d.height, 10) : null;
  if (w || h) {
    const crop = d.crop || 'crop';
    const fit = crop === 'stretch' ? 'fill' : crop === 'pad' ? 'contain' : 'cover';
    const opts = { fit };
    if (fit === 'contain') opts.background = { r: 255, g: 255, b: 255, alpha: 1 };
    pipe = pipe.resize(w || null, h || null, opts);
  }
  // format
  const fmt = d.format || '';
  const quality = Math.max(1, Math.min(100, parseInt(d.quality, 10) || 80));
  let outExt = ext;
  if (fmt === 'jpeg') { pipe = pipe.flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } }).jpeg({ quality, mozjpeg: true }); outExt = 'jpg'; }
  else if (fmt === 'webp') { pipe = pipe.webp({ quality }); outExt = 'webp'; }
  else if (fmt === 'png') { pipe = pipe.png(); outExt = 'png'; }

  const dirs = storage._getDirs();
  const outDir = path.join(dirs.results, taskId);
  fs.mkdirSync(outDir, { recursive: true });
  const outName = `proc_${node.id}_${Date.now()}.${outExt}`;
  const outAbs = path.join(outDir, outName);
  await pipe.toFile(outAbs);
  logger.info(stepIdx, `sharp 处理完成 → ${outName}`);
  return { kind: 'file', path: outAbs, type: 'image' };
}

module.exports = {
  runTask: (taskId, workflow, config) => {
    if (workflow && workflow.executor && workflow.executor.type === 'infinite-canvas') {
      return infiniteCanvasExecutor.runTask(taskId, workflow, config);
    }
    return runLegacyTask(taskId, workflow, config);
  },
  getLive,
  listLive: () => [...listLive(), ...infiniteCanvasExecutor.listLive()],
  pauseTask, resumeTask, terminateTask, abortTask,
  buildGraph, validateWorkflow,
};
