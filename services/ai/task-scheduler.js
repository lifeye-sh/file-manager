'use strict';

const storage = require('./storage');
const taskManager = require('./task-manager');
const { isTerminal } = require('./task-state');

const MAX_CONCURRENT_TASKS = 8;
const MAX_QUEUED_TASKS = 500;
const RECOVERABLE_ACTIVE_STATES = new Set(['running', 'paused', 'terminating']);

function clampConcurrency(value) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Math.min(MAX_CONCURRENT_TASKS, Number.isFinite(parsed) ? parsed : 1));
}

class TaskScheduler {
  constructor(options = {}) {
    this.store = options.store || storage;
    this.executor = options.executor || taskManager.runTask;
    this.controls = options.controls || taskManager;
    this.pending = [];
    this.running = new Map();
    this.getRuntimeConfig = () => ({});
    this.maxConcurrentTasks = 1;
    this.initialized = false;
    this.draining = false;
  }

  initialize(getRuntimeConfig) {
    if (typeof getRuntimeConfig === 'function') this.getRuntimeConfig = getRuntimeConfig;
    const runtime = this.getRuntimeConfig() || {};
    this.maxConcurrentTasks = clampConcurrency(runtime.maxConcurrentTasks);

    if (this.initialized) {
      this._scheduleDrain();
      return this.snapshot();
    }
    this.initialized = true;

    const now = new Date().toISOString();
    const history = this.store.loadHistory().tasks || [];
    for (const record of history) {
      if (RECOVERABLE_ACTIVE_STATES.has(record.status)) {
        this.store.transitionTaskRecord(record.id, 'aborted', {
          finishedAt: now,
          error: '服务重启时任务仍处于活动状态，已安全标记为中止',
          recoveryReason: 'server_restart',
        });
      }
    }

    for (const job of this.store.jobs.list()) {
      const record = this.store.getTaskRecord(job.id);
      if (record && record.status === 'queued') {
        this.pending.push(job);
      } else {
        this.store.jobs.remove(job.id);
      }
    }
    this._scheduleDrain();
    return this.snapshot();
  }

  configure(maxConcurrentTasks) {
    this.maxConcurrentTasks = clampConcurrency(maxConcurrentTasks);
    this._scheduleDrain();
    return this.maxConcurrentTasks;
  }

  enqueue(taskId, workflow, executionConfig, metadata = {}) {
    if (!this.initialized) {
      const err = new Error('AI task scheduler is not initialized');
      err.code = 'SCHEDULER_NOT_READY';
      throw err;
    }
    if (this.pending.length + this.running.size >= MAX_QUEUED_TASKS) {
      const err = new Error('AI 任务队列已满，请稍后重试');
      err.code = 'TASK_QUEUE_FULL';
      throw err;
    }

    const queuedAt = new Date().toISOString();
    const job = {
      schemaVersion: 1,
      id: taskId,
      workflow,
      execution: {
        comfyuiUrl: executionConfig.comfyuiUrl,
        infiniteCanvasBaseUrl: executionConfig.infiniteCanvasBaseUrl,
        execTimeoutMs: executionConfig.execTimeoutMs,
      },
      queuedAt,
      submittedBy: metadata.submittedBy || null,
    };
    this.store.jobs.save(job);
    this.store.addTaskRecord({
      id: taskId,
      workflowId: workflow.id,
      workflowName: workflow.name || '未命名工作流',
      submittedBy: job.submittedBy,
      queuedAt,
      startedAt: null,
      finishedAt: null,
      status: 'queued',
      currentStep: 0,
      stepCount: 0,
      failedStep: null,
      inputs: [],
      results: [],
      logFile: `logs/${taskId}.log`,
      executorType: workflow && workflow.executor && workflow.executor.type || 'legacy-comfyui',
    });
    this.pending.push(job);
    this._scheduleDrain();
    return this.store.getTaskRecord(taskId);
  }

  cancel(taskId) {
    const index = this.pending.findIndex(job => job.id === taskId);
    if (index === -1) return false;
    this.pending.splice(index, 1);
    this.store.transitionTaskRecord(taskId, 'cancelled', {
      finishedAt: new Date().toISOString(),
      cancellationReason: 'user_requested',
    });
    this.store.jobs.remove(taskId);
    return true;
  }

  pause(taskId) {
    return Boolean(this.controls.pauseTask && this.controls.pauseTask(taskId));
  }

  resume(taskId) {
    return Boolean(this.controls.resumeTask && this.controls.resumeTask(taskId));
  }

  terminate(taskId) {
    if (this.cancel(taskId)) return { accepted: true, status: 'cancelled' };
    const running = this.running.get(taskId);
    if (!running) return { accepted: false };
    const sameProviderCount = [...this.running.values()]
      .filter(job => job.execution.comfyuiUrl === running.execution.comfyuiUrl).length;
    const accepted = Boolean(this.controls.terminateTask && this.controls.terminateTask(taskId, {
      allowProviderInterrupt: sameProviderCount <= 1,
    }));
    return {
      accepted,
      status: accepted ? 'terminating' : undefined,
      providerInterrupt: accepted && sameProviderCount <= 1,
    };
  }

  snapshot() {
    return {
      maxConcurrentTasks: this.maxConcurrentTasks,
      running: [...this.running.keys()],
      queued: this.pending.map(job => job.id),
      runningCount: this.running.size,
      queuedCount: this.pending.length,
    };
  }

  _scheduleDrain() {
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => {
      this.draining = false;
      this._drain();
    });
  }

  _drain() {
    while (this.running.size < this.maxConcurrentTasks && this.pending.length) {
      const job = this.pending.shift();
      const record = this.store.getTaskRecord(job.id);
      if (!record || record.status !== 'queued') {
        this.store.jobs.remove(job.id);
        continue;
      }
      this.store.transitionTaskRecord(job.id, 'running', {
        startedAt: new Date().toISOString(),
      });
      this.running.set(job.id, job);
      const runtime = this.getRuntimeConfig() || {};
      const executionConfig = {
        comfyuiUrl: job.execution.comfyuiUrl,
        infiniteCanvasBaseUrl: job.execution.infiniteCanvasBaseUrl || runtime.infiniteCanvasBaseUrl,
        execTimeoutMs: job.execution.execTimeoutMs,
        rootDir: runtime.rootDir,
        fileRoots: runtime.fileRoots || { main: runtime.rootDir },
      };
      Promise.resolve()
        .then(() => this.executor(job.id, job.workflow, executionConfig))
        .catch(err => {
          const latest = this.store.getTaskRecord(job.id);
          if (latest && !isTerminal(latest.status)) {
            const target = latest.status === 'terminating' || err.code === 'TASK_ABORTED' ? 'aborted' : 'failed';
            this.store.transitionTaskRecord(job.id, target, {
              finishedAt: new Date().toISOString(),
              error: err.message,
            });
          }
        })
        .finally(() => {
          this.running.delete(job.id);
          const latest = this.store.getTaskRecord(job.id);
          if (latest && isTerminal(latest.status)) this.store.jobs.remove(job.id);
          this._scheduleDrain();
        });
    }
  }
}

const scheduler = new TaskScheduler();

module.exports = scheduler;
module.exports.TaskScheduler = TaskScheduler;
module.exports.clampConcurrency = clampConcurrency;
module.exports.MAX_CONCURRENT_TASKS = MAX_CONCURRENT_TASKS;
module.exports.MAX_QUEUED_TASKS = MAX_QUEUED_TASKS;
