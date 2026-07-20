// Parses a ComfyUI API-format workflow JSON into a node definition
// (prompt template with placeholders + input/output port declarations).
//
// ComfyUI API JSON shape:
//   { "3": { "class_type": "KSampler", "inputs": { "seed": 123, "model": ["4", 0], ... } }, ... }

// Node classes that load external media → their filename field becomes an image/video port.
const LOAD_CLASSES = {
  LoadImage: { field: 'image', type: 'image' },
  LoadImageMask: { field: 'image', type: 'image' },
  IMG_ClipsegSegmentation: { field: 'image', type: 'image' },
  VHS_LoadVideo: { field: 'video', type: 'video' },
  VHS_LoadVideoPath: { field: 'video', type: 'video' },
};

// Terminal node classes that produce saved output → become output ports.
const OUTPUT_CLASSES = {
  SaveImage: { type: 'image', outIndex: 0, label: '输出图片' },
  PreviewImage: { type: 'image', outIndex: 0, label: '预览图片' },
  SaveAnimatedPNG: { type: 'image', outIndex: 0, label: '输出动图' },
  VHS_VideoCombine: { type: 'video', outIndex: 0, label: '输出视频' },
};

function isInternalLink(value) {
  return Array.isArray(value) && value.length === 2
    && (typeof value[0] === 'string' || typeof value[0] === 'number')
    && typeof value[1] === 'number';
}

function inferType(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'boolean') return 'int';
  return 'text';
}

// Match %param_name% placeholder strings (the user's convention for external inputs).
const PLACEHOLDER_RE = /^%([^%.]+)%$/;

// Infer a port type from the placeholder name (e.g. %seed% -> int, %prompt% -> text).
function placeholderType(name) {
  const n = String(name).toLowerCase();
  if (/image|img|photo|picture|mask/.test(n)) return 'image';
  if (/video|movie/.test(n)) return 'video';
  if (/seed|steps|step|width|height|batch|count|num|index|start|end|multiple|size/.test(n)) return 'int';
  if (/cfg|denoise|strength|scale|weight|ratio|factor|mega|noise|opacity|alpha/.test(n)) return 'float';
  return 'text';
}

function defaultForType(type) {
  if (type === 'image' || type === 'video') return null;
  if (type === 'int' || type === 'float') return 0;
  return '';
}

function readableName(classType) {
  // "KSampler" → "KSampler", "VHS_VideoCombine" → "VideoCombine"
  return String(classType).replace(/^VHS_/, '').replace(/^Load/, '').replace(/^Save/, 'Save');
}

// Validate that the uploaded JSON is ComfyUI API format.
function validateApiFormat(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return '需要 ComfyUI API 格式 JSON：顶层是一个对象，键为节点 id，值为含 class_type 与 inputs 的节点。';
  }
  // UI format has a top-level "nodes" array — reject it with clear guidance
  if (Array.isArray(json.nodes)) {
    return '检测到 ComfyUI UI 格式（含 nodes 数组），工作台需要 API 格式。\n\n请在 ComfyUI 中：\n  1. 设置 → 勾选「Enable dev mode options」\n  2. 点 Queue 面板下方的「Save (API Format)」按钮\n  3. 上传下载得到的 API 格式 JSON\n\nAPI 格式顶层是 {"3": {"class_type": "...", "inputs": {...}}, ...}，没有 nodes/links 数组。';
  }
  const keys = Object.keys(json);
  if (keys.length === 0) return '工作流为空';
  for (const k of keys) {
    const node = json[k];
    if (!node || typeof node !== 'object' || !node.class_type || !node.inputs) {
      return `节点 ${k} 缺少 class_type 或 inputs，可能不是 API 格式`;
    }
  }
  return null;
}

function parseWorkflow(apiJson, opts = {}) {
  const err = validateApiFormat(apiJson);
  if (err) throw new Error(err);

  // Collect every internal-link reference so we can find terminal nodes.
  const referenced = new Set();
  for (const id of Object.keys(apiJson)) {
    const inputs = apiJson[id].inputs || {};
    for (const field of Object.keys(inputs)) {
      if (isInternalLink(inputs[field])) {
        referenced.add(String(inputs[field][0]));
      }
    }
  }

  const template = {};
  const inputPorts = [];
  const outputPorts = [];
  const usedNames = new Set();
  const portByName = {}; // placeholder name -> port (one port per unique %name%)

  function uniqueName(base) {
    let n = base, i = 1;
    while (usedNames.has(n)) { n = `${base}_${i++}`; }
    usedNames.add(n);
    return n;
  }

  for (const id of Object.keys(apiJson)) {
    const node = apiJson[id];
    const classType = node.class_type;
    const inputs = node.inputs || {};
    template[id] = { class_type: classType, inputs: {} };

    const loadSpec = LOAD_CLASSES[classType];

    for (const field of Object.keys(inputs)) {
      const value = inputs[field];

      if (isInternalLink(value)) {
        // internal ComfyUI connection — keep as-is
        template[id].inputs[field] = value;
        continue;
      }

      // Only %param_name% placeholders become input ports; everything else is a fixed literal.
      const ph = typeof value === 'string' ? value.match(PLACEHOLDER_RE) : null;
      if (ph) {
        const portName = ph[1];
        if (!portByName[portName]) {
          const type = (loadSpec && field === loadSpec.field) ? loadSpec.type : placeholderType(portName);
          portByName[portName] = {
            name: portName,
            type,
            default: defaultForType(type),
            node: id,
            field,
          };
          inputPorts.push(portByName[portName]);
        }
        template[id].inputs[field] = `{{${portName}}}`;
      } else {
        // fixed literal — keep the original value in the template, not a port
        template[id].inputs[field] = value;
      }
    }

    // output port: terminal output-class node
    if (OUTPUT_CLASSES[classType] && !referenced.has(id)) {
      const spec = OUTPUT_CLASSES[classType];
      outputPorts.push({
        name: uniqueName(spec.label),
        type: spec.type,
        sourceNode: id,
        sourceOutput: spec.outIndex,
      });
    }
  }

  if (outputPorts.length === 0) {
    throw new Error('未找到输出节点（SaveImage / PreviewImage / VHS_VideoCombine）。请确保工作流以保存/预览节点结尾');
  }

  return {
    id: opts.id,
    name: opts.name || '未命名节点',
    createdAt: opts.createdAt || new Date().toISOString(),
    author: opts.author,
    comfyuiPromptTemplate: template,
    ports: { inputs: inputPorts, outputs: outputPorts },
  };
}

module.exports = { parseWorkflow, validateApiFormat, LOAD_CLASSES, OUTPUT_CLASSES };