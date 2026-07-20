const { normalizeFileRef, resolveFileRef } = require('../file-ref-service');

const FILE_INPUT_TYPES = new Set(['image-input', 'video-input']);

async function snapshotWorkflowInputs(workflow, fileRoots) {
  const nodes = await Promise.all((workflow.nodes || []).map(async node => {
    if (!FILE_INPUT_TYPES.has(node.type)) return { ...node };
    const data = node.data || {};
    const fileRef = normalizeFileRef(data.fileRef || data.path);
    if (!fileRef) {
      const err = new Error(`Invalid file input for node ${node.id}`);
      err.code = 'INVALID_FILE_REF';
      throw err;
    }
    const resolved = await resolveFileRef(fileRef, fileRoots);
    const nextData = { ...data, fileRef: resolved.ref };
    delete nextData.path;
    return { ...node, data: nextData };
  }));
  return { ...workflow, nodes };
}

module.exports = { snapshotWorkflowInputs, FILE_INPUT_TYPES };
