'use strict';

const { isValidAiId } = require('../../utils/identifiers');

const SCHEMA_VERSION = 1;
const MAX_WORKFLOW_BYTES = 2 * 1024 * 1024;
const MAX_EXECUTOR_PAYLOAD_BYTES = 512 * 1024;
const MAX_NODES = 200;
const MAX_EDGES = 1000;
const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const EXECUTOR_TYPES = new Set(['legacy-comfyui', 'infinite-canvas']);
const SENSITIVE_PAYLOAD_KEY = /(^|_)(api[_-]?key|authorization|cookie|credential|password|secret|token)($|_)/i;
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ABSOLUTE_PATH_VALUE = /^(?:[A-Za-z]:[\\/]|\\\\|\/\/|\/(?!\/))/;

function workflowError(message, code = 'INVALID_WORKFLOW') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function splitPortRef(value) {
  if (typeof value !== 'string') return null;
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;
  const nodeId = value.slice(0, dot);
  const port = value.slice(dot + 1);
  if (!NODE_ID_PATTERN.test(nodeId) || !NODE_ID_PATTERN.test(port)) return null;
  return { nodeId, port };
}

function assertAcyclic(nodes, edges) {
  const indegree = new Map(nodes.map(node => [node.id, 0]));
  const outgoing = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) {
    const from = splitPortRef(edge.from);
    const to = splitPortRef(edge.to);
    indegree.set(to.nodeId, indegree.get(to.nodeId) + 1);
    outgoing.get(from.nodeId).push(to.nodeId);
  }
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    for (const target of outgoing.get(id)) {
      const next = indegree.get(target) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (visited !== nodes.length) throw workflowError('工作流不能包含环路', 'WORKFLOW_CYCLE');
}

function normalizeExecutor(executor) {
  const normalized = executor && typeof executor === 'object'
    ? executor
    : { type: 'legacy-comfyui', payloadVersion: 1, payload: {} };
  if (!EXECUTOR_TYPES.has(normalized.type)) {
    throw workflowError('不支持的工作流执行器', 'UNSUPPORTED_EXECUTOR');
  }
  if (!Number.isInteger(normalized.payloadVersion) || normalized.payloadVersion < 1) {
    throw workflowError('执行器 payloadVersion 无效');
  }
  if (!normalized.payload || typeof normalized.payload !== 'object' || Array.isArray(normalized.payload)) {
    throw workflowError('执行器 payload 必须是对象');
  }
  if (jsonSize(normalized.payload) > MAX_EXECUTOR_PAYLOAD_BYTES) {
    throw workflowError('执行器 payload 过大', 'WORKFLOW_TOO_LARGE');
  }
  assertSafeExecutorPayload(normalized.payload);
  return {
    type: normalized.type,
    payloadVersion: normalized.payloadVersion,
    payload: normalized.payload,
  };
}

function assertSafeExecutorPayload(value, depth = 0) {
  if (depth > 30) throw workflowError('执行器 payload 嵌套过深', 'INVALID_EXECUTOR_PAYLOAD');
  if (typeof value === 'string') {
    if (ABSOLUTE_PATH_VALUE.test(value)) {
      throw workflowError('执行器 payload 不得包含宿主绝对路径', 'EXECUTOR_HOST_PATH_REJECTED');
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafeExecutorPayload(item, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_OBJECT_KEYS.has(key) || SENSITIVE_PAYLOAD_KEY.test(key)) {
      throw workflowError('执行器 payload 不得包含凭据或危险字段', 'EXECUTOR_SECRET_REJECTED');
    }
    assertSafeExecutorPayload(child, depth + 1);
  }
}

function validateGraph(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw workflowError('工作流 nodes 和 edges 必须是数组');
  }
  if (nodes.length > MAX_NODES || edges.length > MAX_EDGES) {
    throw workflowError('工作流节点或连线数量超过限制', 'WORKFLOW_TOO_LARGE');
  }
  const nodeIds = new Set();
  for (const node of nodes) {
    if (!node || !NODE_ID_PATTERN.test(node.id || '')) throw workflowError('工作流包含无效节点 ID');
    if (nodeIds.has(node.id)) throw workflowError('工作流包含重复节点 ID', 'DUPLICATE_NODE_ID');
    nodeIds.add(node.id);
  }
  const edgeIds = new Set();
  const occupiedInputs = new Set();
  for (const edge of edges) {
    if (!edge || !NODE_ID_PATTERN.test(edge.id || '')) throw workflowError('工作流包含无效连线 ID');
    if (edgeIds.has(edge.id)) throw workflowError('工作流包含重复连线 ID', 'DUPLICATE_EDGE_ID');
    edgeIds.add(edge.id);
    const from = splitPortRef(edge.from);
    const to = splitPortRef(edge.to);
    if (!from || !to || !nodeIds.has(from.nodeId) || !nodeIds.has(to.nodeId)) {
      throw workflowError('工作流包含悬空连线', 'DANGLING_EDGE');
    }
    if (occupiedInputs.has(edge.to)) throw workflowError('单个输入端口只能连接一次', 'DUPLICATE_INPUT_EDGE');
    occupiedInputs.add(edge.to);
  }
  assertAcyclic(nodes, edges);
}

function inferInputs(nodes) {
  return nodes.filter(node => ['image-input', 'video-input', 'text-input', 'int-input', 'float-input'].includes(node.type))
    .map(node => ({ nodeId: node.id, type: node.type }));
}

function inferOutputs(nodes) {
  return nodes.filter(node => node.type === 'output')
    .map(node => ({ nodeId: node.id, type: node.data && node.data.portType || 'unknown' }));
}

function buildCanonical(input, metadata = {}, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw workflowError('工作流必须是对象');
  const id = metadata.id || input.id || (existing && existing.id);
  if (!isValidAiId(id, 'wf')) throw workflowError('工作流 ID 无效', 'INVALID_AI_ID');
  const name = String(input.name !== undefined ? input.name : existing && existing.name || '').trim().slice(0, 120);
  if (!name) throw workflowError('工作流名称不能为空');
  const nodes = input.nodes !== undefined ? input.nodes : existing && existing.nodes;
  const edges = input.edges !== undefined ? input.edges : existing && existing.edges;
  validateGraph(nodes, edges);
  const executor = normalizeExecutor(input.executor !== undefined ? input.executor : existing && existing.executor);
  const now = metadata.now || new Date().toISOString();
  const canonical = {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    revision: existing ? Math.max(1, Number.parseInt(existing.revision, 10) || 1) + 1 : 1,
    createdAt: existing && existing.createdAt || metadata.createdAt || now,
    updatedAt: now,
    author: existing && existing.author || metadata.author || null,
    nodes,
    edges,
    inputs: inferInputs(nodes),
    outputs: inferOutputs(nodes),
    executor,
  };
  if (jsonSize(canonical) > MAX_WORKFLOW_BYTES) throw workflowError('工作流定义过大', 'WORKFLOW_TOO_LARGE');
  return canonical;
}

function createWorkflow(input, metadata) {
  return buildCanonical(input, metadata, null);
}

function updateWorkflow(existing, patch, metadata = {}) {
  if (!existing) throw workflowError('工作流不存在', 'WORKFLOW_NOT_FOUND');
  return buildCanonical(patch, { ...metadata, id: existing.id }, existing);
}

function readCompatible(workflow) {
  if (workflow && workflow.schemaVersion === SCHEMA_VERSION) return workflow;
  return buildCanonical(workflow, {
    id: workflow && workflow.id,
    author: workflow && workflow.author,
    createdAt: workflow && workflow.createdAt,
    now: workflow && workflow.updatedAt || new Date().toISOString(),
  });
}

module.exports = {
  SCHEMA_VERSION,
  MAX_WORKFLOW_BYTES,
  MAX_EXECUTOR_PAYLOAD_BYTES,
  MAX_NODES,
  MAX_EDGES,
  EXECUTOR_TYPES,
  assertSafeExecutorPayload,
  createWorkflow,
  updateWorkflow,
  readCompatible,
  validateGraph,
};
