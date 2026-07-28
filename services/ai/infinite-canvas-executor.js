'use strict';

const storage = require('./storage');
const { InfiniteCanvasClient } = require('./infinite-canvas-client');
const { publishCanvasOutputs } = require('./infinite-canvas-output-publisher');

const active = new Map();
const POLL_MS = 1000;

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => {
      clearTimeout(timer);
      const err = new Error('Infinite-Canvas 任务已终止');
      err.code = 'TASK_ABORTED';
      reject(err);
    }, { once: true });
  });
}

async function runTask(taskId, workflow, config) {
  const executor = workflow && workflow.executor;
  const payload = executor && executor.payload || {};
  const kind = payload.kind;
  const request = payload.request;
  if (executor.type !== 'infinite-canvas' || !['image', 'comfy', 'video', 'llm', 'image-query'].includes(kind)
      || !request || typeof request !== 'object' || Array.isArray(request)) {
    const err = new Error('Infinite-Canvas 执行器定义无效');
    err.code = 'INVALID_CANVAS_EXECUTOR';
    throw err;
  }
  const controller = new AbortController();
  active.set(taskId, { controller, status: 'running' });
  const client = new InfiniteCanvasClient({
    baseUrl: config.infiniteCanvasBaseUrl,
    timeoutMs: config.execTimeoutMs,
    gatewayToken: process.env.INFINITE_CANVAS_GATEWAY_TOKEN,
  });
  storage.updateTaskRecord(taskId, {
    currentStep: 1,
    stepCount: 1,
    executorType: 'infinite-canvas',
    canvasTaskKind: kind,
  });
  try {
    let result = await client.submitCanvasTask(kind, request);
    let upstreamTaskId = null;
    if (kind === 'image' || kind === 'comfy') {
      upstreamTaskId = result.task_id;
      let succeeded = false;
      storage.updateTaskRecord(taskId, { upstreamTaskId });
      const deadline = Date.now() + Math.max(1000, config.execTimeoutMs || 600000);
      while (Date.now() < deadline) {
        await delay(POLL_MS, controller.signal);
        result = await client.getCanvasTask(kind, upstreamTaskId);
        storage.updateTaskRecord(taskId, {
          upstreamStatus: result.status,
          progressUpdatedAt: new Date().toISOString(),
        });
        if (result.status === 'succeeded') {
          result = result.result;
          succeeded = true;
          break;
        }
        if (result.status === 'failed') {
          throw new Error(String(result.error || 'Infinite-Canvas 上游任务失败'));
        }
      }
      if (!succeeded) {
        const err = new Error('Infinite-Canvas 任务执行超时');
        err.code = 'CANVAS_TASK_TIMEOUT';
        throw err;
      }
    }
    const publishedResults = await publishCanvasOutputs({
      taskId,
      result,
      client,
      rootDir: config.rootDir,
    });
    storage.transitionTaskRecord(taskId, 'completed', {
      finishedAt: new Date().toISOString(),
      currentStep: 1,
      canvasResult: result,
      upstreamTaskId,
      results: publishedResults,
    });
    return result;
  } finally {
    active.delete(taskId);
  }
}

function terminateTask(taskId) {
  const entry = active.get(taskId);
  if (!entry) return false;
  entry.status = 'terminating';
  entry.controller.abort();
  return true;
}

function listLive() {
  return [...active].map(([id, item]) => ({ id, status: item.status, executorType: 'infinite-canvas' }));
}

module.exports = { runTask, terminateTask, listLive };
