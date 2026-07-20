// Builds a concrete ComfyUI prompt from a node definition's template by
// substituting {{portName}} placeholders with resolved port values.
// Image/video port values are file-manager-relative paths: the file is
// uploaded to ComfyUI and the returned filename is substituted.
const fs = require('fs');
const path = require('path');
const { uploadFile, viewFile } = require('./comfyui-client');
const { normalizeFileRef, resolveFileRef } = require('../file-ref-service');

function placeholderFor(name) { return `{{${name}}}`; }

// Substitute placeholders in the template. portValues: { [portName]: value }
// value semantics:
//   image/video → relative path within file-manager root (string)
//   int/float   → number (or numeric string)
//   text        → string
async function buildPrompt(nodeDef, portValues, ctx) {
  const { rootDir, comfyuiUrl, uploadCache, log } = ctx;
  const template = nodeDef.comfyuiPromptTemplate;
  const portsByName = {};
  for (const p of nodeDef.ports.inputs) portsByName[p.name] = p;

  const prompt = {};
  for (const nodeId of Object.keys(template)) {
    const tNode = template[nodeId];
    prompt[nodeId] = { class_type: tNode.class_type, inputs: {} };
    for (const field of Object.keys(tNode.inputs)) {
      const raw = tNode.inputs[field];
      if (typeof raw === 'string' && raw.startsWith('{{') && raw.endsWith('}}')) {
        const portName = raw.slice(2, -2);
        const port = portsByName[portName];
        let value = portValues[portName];
        // fall back to port default if no value provided
        if (value === undefined || value === null || value === '') value = port ? port.default : undefined;
        prompt[nodeId].inputs[field] = await resolveValue(port, value, ctx);
      } else {
        // internal link array or literal default — keep as-is
        prompt[nodeId].inputs[field] = raw;
      }
    }
  }
  return prompt;
}

async function resolveValue(port, value, ctx) {
  if (!port) return value;
  // unwrap literal wrapper from generic input nodes
  if (value && typeof value === 'object' && value.kind === 'literal') value = value.value;

  if (port.type === 'image' || port.type === 'video') {
    if (!value || (typeof value === 'object' && !value.kind)) throw new Error(`端口「${port.name}」未提供文件`);
    if (typeof value === 'string') return await ensureUploaded(normalizeFileRef(value), ctx, port.type);
    if (value.kind === 'file') {
      if (!value.fileRef) throw new Error(`端口「${port.name}」未选择文件`);
      return await ensureUploaded(value.fileRef, ctx, port.type);
    }
    if (value.kind === 'comfyui-output') {
      // downstream custom node needs the file in ComfyUI input — download then re-upload
      const buf = await viewFile(ctx.comfyuiUrl, { filename: value.filename, subfolder: value.subfolder, type: value.type });
      const ext = path.extname(value.filename) || (port.type === 'video' ? '.mp4' : '.webp');
      const tmpName = `aiwb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      if (ctx.log) ctx.log(`中转输出到下游: ${value.filename} → 重新上传`);
      const r = await uploadFile(ctx.comfyuiUrl, tmpName, buf, port.type === 'video' ? 'video' : 'image');
      return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
    }
    throw new Error(`端口「${port.name}」值类型无效`);
  }
  if (port.type === 'int') {
    const n = parseInt(value, 10);
    return isNaN(n) ? value : n;
  }
  if (port.type === 'float') {
    const n = parseFloat(value);
    return isNaN(n) ? value : n;
  }
  return String(value == null ? '' : value);
}

// Upload a managed file to ComfyUI after resolving its server-owned fileRef.
async function ensureUploaded(fileRef, ctx, kind) {
  const { comfyuiUrl, uploadCache, log } = ctx;
  const cache = uploadCache || new Map();
  const resolved = await resolveFileRef(fileRef, ctx.fileRoots || { main: ctx.rootDir });
  const cacheKey = `${resolved.ref.rootId}:${resolved.ref.path}|${resolved.stats.mtimeMs}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const buffer = await fs.promises.readFile(resolved.absPath);
  const typeField = kind === 'video' ? 'video' : 'image';
  if (log) log(`上传 ${kind} 到 ComfyUI: ${resolved.ref.path} (${Math.round(buffer.length / 1024)}KB)`);
  const res = await uploadFile(comfyuiUrl, resolved.basename, buffer, typeField);
  const comfyName = res.subfolder ? `${res.subfolder}/${res.name}` : res.name;
  cache.set(cacheKey, comfyName);
  return comfyName;
}

module.exports = { buildPrompt, ensureUploaded };
