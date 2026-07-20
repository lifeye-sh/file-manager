'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskScheduler, clampConcurrency } = require('../services/ai/task-scheduler');
const { assertTransition, canTransition, isTerminal } = require('../services/ai/task-state');

class FakeStore {
  constructor(records = [], jobs = []) {
    this.records = new Map(records.map(record => [record.id, { ...record }]));
    this.jobDocs = new Map(jobs.map(job => [job.id, job]));
    this.jobs = {
      list: () => [...this.jobDocs.values()],
      save: job => this.jobDocs.set(job.id, job),
      remove: id => this.jobDocs.delete(id),
    };
  }

  loadHistory() {
    return { tasks: [...this.records.values()] };
  }

  addTaskRecord(record) {
    this.records.set(record.id, { ...record });
  }

  getTaskRecord(id) {
    return this.records.get(id) || null;
  }

  transitionTaskRecord(id, status, patch = {}) {
    const current = this.getTaskRecord(id);
    assertTransition(current.status, status);
    const next = { ...current, ...patch, status };
    this.records.set(id, next);
    return next;
  }
}

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

function workflow(id) {
  return { id: `wf_${id}`, name: id, nodes: [], edges: [] };
}

function executionConfig() {
  return { comfyuiUrl: 'http://127.0.0.1:8188', execTimeoutMs: 1000 };
}

test('task state machine rejects illegal terminal transitions', () => {
  assert.equal(canTransition('queued', 'running'), true);
  assert.equal(canTransition('running', 'paused'), true);
  assert.equal(isTerminal('completed'), true);
  assert.throws(() => assertTransition('completed', 'running'), {
    code: 'ILLEGAL_TASK_TRANSITION',
  });
});

test('scheduler enforces concurrency and supports queued cancellation', async () => {
  const store = new FakeStore();
  const releases = [];
  let active = 0;
  let peak = 0;
  const executor = (id) => {
    active += 1;
    peak = Math.max(peak, active);
    return new Promise(resolve => {
      releases.push(() => {
        active -= 1;
        store.transitionTaskRecord(id, 'completed', { finishedAt: new Date().toISOString() });
        resolve();
      });
    });
  };
  const scheduler = new TaskScheduler({ store, executor, controls: {} });
  scheduler.initialize(() => ({ rootDir: 'C:\\managed', maxConcurrentTasks: 1 }));

  scheduler.enqueue('task_one', workflow('one'), executionConfig());
  scheduler.enqueue('task_two', workflow('two'), executionConfig());
  await tick();

  assert.equal(scheduler.snapshot().runningCount, 1);
  assert.equal(scheduler.snapshot().queuedCount, 1);
  assert.equal(store.getTaskRecord('task_two').status, 'queued');
  assert.equal(scheduler.cancel('task_two'), true);
  assert.equal(store.getTaskRecord('task_two').status, 'cancelled');
  assert.equal(store.jobDocs.has('task_two'), false);

  releases.shift()();
  await tick();
  assert.equal(peak, 1);
  assert.equal(store.getTaskRecord('task_one').status, 'completed');
});

test('scheduler recovers queued jobs and aborts stale active tasks after restart', async () => {
  const queuedJob = {
    schemaVersion: 1,
    id: 'task_queued',
    workflow: workflow('queued'),
    execution: executionConfig(),
    queuedAt: new Date().toISOString(),
  };
  const store = new FakeStore([
    { id: 'task_stale', status: 'running' },
    { id: 'task_queued', status: 'queued' },
  ], [queuedJob]);
  let release;
  const scheduler = new TaskScheduler({
    store,
    controls: {},
    executor: id => {
      return new Promise(resolve => {
        release = () => {
          store.transitionTaskRecord(id, 'completed');
          resolve();
        };
      });
    },
  });

  scheduler.initialize(() => ({ rootDir: 'C:\\managed', maxConcurrentTasks: 1 }));
  await tick();

  assert.equal(store.getTaskRecord('task_stale').status, 'aborted');
  assert.equal(store.getTaskRecord('task_stale').recoveryReason, 'server_restart');
  assert.equal(store.getTaskRecord('task_queued').status, 'running');
  release();
  await tick();
  assert.equal(store.jobDocs.has('task_queued'), false);
});

test('configured concurrency is bounded', () => {
  assert.equal(clampConcurrency(0), 1);
  assert.equal(clampConcurrency(4), 4);
  assert.equal(clampConcurrency(999), 8);
});

test('queued records expose their executor type before execution starts', async () => {
  const store = new FakeStore();
  let releaseFirst;
  const firstDone = new Promise(resolve => { releaseFirst = resolve; });
  const scheduler = new TaskScheduler({
    store,
    executor: id => id === 'task_first' ? firstDone : Promise.resolve(),
    controls: {},
  });
  scheduler.initialize(() => ({ rootDir: 'C:\\managed', maxConcurrentTasks: 1 }));
  scheduler.enqueue('task_first', workflow('first'), executionConfig(), {});
  scheduler.enqueue('task_canvas', {
    ...workflow('wf_canvas'),
    executor: { type: 'infinite-canvas', payloadVersion: 1, payload: { kind: 'comfy', request: {} } },
  }, executionConfig(), {});
  await tick();
  assert.equal(store.getTaskRecord('task_canvas').status, 'queued');
  assert.equal(store.getTaskRecord('task_canvas').executorType, 'infinite-canvas');
  releaseFirst();
});
