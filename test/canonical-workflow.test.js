'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWorkflow,
  updateWorkflow,
  readCompatible,
  SCHEMA_VERSION,
} = require('../services/ai/canonical-workflow');

function validGraph() {
  return {
    nodes: [
      { id: 'input_1', type: 'image-input', data: {} },
      { id: 'output_1', type: 'output', data: { portType: 'image' } },
    ],
    edges: [
      { id: 'edge_1', from: 'input_1.image', to: 'output_1.in' },
    ],
  };
}

test('new workflows use the project-owned canonical envelope', () => {
  const graph = validGraph();
  const workflow = createWorkflow({
    id: 'wf_canonical',
    name: 'Canonical',
    ...graph,
  }, {
    id: 'wf_canonical',
    author: 'admin',
    now: '2026-07-18T00:00:00.000Z',
  });

  assert.equal(workflow.schemaVersion, SCHEMA_VERSION);
  assert.equal(workflow.revision, 1);
  assert.equal(workflow.executor.type, 'legacy-comfyui');
  assert.deepEqual(workflow.inputs, [{ nodeId: 'input_1', type: 'image-input' }]);
  assert.deepEqual(workflow.outputs, [{ nodeId: 'output_1', type: 'image' }]);
});

test('legacy workflows are read compatibly and revisions increment on update', () => {
  const graph = validGraph();
  const legacy = {
    id: 'wf_legacy',
    name: 'Legacy',
    author: 'admin',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...graph,
  };
  const compatible = readCompatible(legacy);
  const updated = updateWorkflow(compatible, { name: 'Updated' }, {
    now: '2026-07-18T00:00:00.000Z',
  });

  assert.equal(compatible.schemaVersion, 1);
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdAt, legacy.createdAt);
  assert.equal(updated.name, 'Updated');
});

test('workflow validation rejects duplicate IDs, dangling edges and cycles', () => {
  const base = { id: 'wf_invalid', name: 'Invalid' };
  assert.throws(() => createWorkflow({
    ...base,
    nodes: [{ id: 'node_1' }, { id: 'node_1' }],
    edges: [],
  }, { id: base.id }), { code: 'DUPLICATE_NODE_ID' });

  assert.throws(() => createWorkflow({
    ...base,
    nodes: [{ id: 'node_1' }],
    edges: [{ id: 'edge_1', from: 'node_1.out', to: 'missing.in' }],
  }, { id: base.id }), { code: 'DANGLING_EDGE' });

  assert.throws(() => createWorkflow({
    ...base,
    nodes: [{ id: 'node_1' }, { id: 'node_2' }],
    edges: [
      { id: 'edge_1', from: 'node_1.out', to: 'node_2.in' },
      { id: 'edge_2', from: 'node_2.out', to: 'node_1.in' },
    ],
  }, { id: base.id }), { code: 'WORKFLOW_CYCLE' });
});

test('workflow validation rejects unsupported executors and oversized payloads', () => {
  const graph = validGraph();
  assert.throws(() => createWorkflow({
    id: 'wf_executor',
    name: 'Bad executor',
    ...graph,
    executor: { type: 'arbitrary-shell', payloadVersion: 1, payload: {} },
  }, { id: 'wf_executor' }), { code: 'UNSUPPORTED_EXECUTOR' });

  assert.throws(() => createWorkflow({
    id: 'wf_large0',
    name: 'Large',
    ...graph,
    executor: {
      type: 'infinite-canvas',
      payloadVersion: 1,
      payload: { data: 'x'.repeat(600 * 1024) },
    },
  }, { id: 'wf_large0' }), { code: 'WORKFLOW_TOO_LARGE' });
});

test('executor payload cannot persist credentials or host absolute paths', () => {
  const graph = validGraph();
  assert.throws(() => createWorkflow({
    id: 'wf_secret0',
    name: 'Secret',
    ...graph,
    executor: {
      type: 'infinite-canvas',
      payloadVersion: 1,
      payload: { api_key: 'must-not-be-stored' },
    },
  }, { id: 'wf_secret0' }), { code: 'EXECUTOR_SECRET_REJECTED' });

  assert.throws(() => createWorkflow({
    id: 'wf_path000',
    name: 'Path',
    ...graph,
    executor: {
      type: 'infinite-canvas',
      payloadVersion: 1,
      payload: { source: 'C:\\Users\\someone\\image.png' },
    },
  }, { id: 'wf_path000' }), { code: 'EXECUTOR_HOST_PATH_REJECTED' });
});
