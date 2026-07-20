// ComfyUI client: REST calls + WebSocket listener for execution progress.
// ComfyUI API: POST /prompt, GET /history/:id, GET /system_stats,
// POST /upload/image, POST /upload/video, GET /view.
const WebSocket = require('ws');

function normUrl(base) {
  if (!base) return 'http://127.0.0.1:8188';
  return base.replace(/\/+$/, '');
}
function wsUrl(base) {
  let u = normUrl(base).replace(/^http/, 'ws');
  if (!u.endsWith('/ws')) u = u.replace(/\/$/, '') + '/ws';
  return u;
}

async function testConnection(base, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${normUrl(base)}/system_stats`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, version: data.system && data.system.comfyui_version, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally { clearTimeout(t); }
}

async function queuePrompt(base, prompt, client_id) {
  const res = await fetch(`${normUrl(base)}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI /prompt failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.prompt_id;
}

async function getHistory(base, promptId) {
  const res = await fetch(`${normUrl(base)}/history/${encodeURIComponent(promptId)}`);
  if (!res.ok) throw new Error(`ComfyUI /history failed: HTTP ${res.status}`);
  return res.json();
}

async function uploadFile(base, filename, buffer, typeField = 'image') {
  // ComfyUI /upload/image expects multipart with fields: image (file), overwrite, type
  const form = new FormData();
  form.append('overwrite', 'true');
  form.append('type', 'input');
  form.append(typeField, new Blob([buffer]), filename);
  const res = await fetch(`${normUrl(base)}/upload/${typeField}`, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI upload failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json(); // { name, subfolder, type }
}

async function viewFile(base, { filename, type = 'output', subfolder = '' }) {
  const qs = new URLSearchParams({ filename, type });
  if (subfolder) qs.set('subfolder', subfolder);
  const res = await fetch(`${normUrl(base)}/view?${qs.toString()}`);
  if (!res.ok) throw new Error(`ComfyUI /view failed: HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function interrupt(base) {
  try {
    await fetch(`${normUrl(base)}/interrupt`, { method: 'POST' });
  } catch (_) { /* best effort */ }
}

// Wait for a prompt to finish. Uses /history polling as the reliable
// completion signal (robust against missed ws events / fast executions),
// while the ws connection provides live progress and early error events.
function waitForPrompt(base, promptId, { onProgress, onLog, timeoutMs = 600000, signal } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws = null;
    const outputs = {};
    let timer = setTimeout(() => done(new Error('ComfyUI 执行超时')), timeoutMs);
    let pollTimer = null;

    function abort() {
      const err = new Error('ComfyUI 等待已由任务终止请求取消');
      err.name = 'AbortError';
      done(err);
    }

    function done(err, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      if (ws) { try { ws.close(); } catch (_) {} }
      if (signal) signal.removeEventListener('abort', abort);
      if (err) reject(err); else resolve(result);
    }

    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    }
    function refresh() {
      clearTimeout(timer);
      timer = setTimeout(() => done(new Error('ComfyUI 执行超时')), timeoutMs);
    }

    // ws: live progress + early error (non-fatal if it closes)
    try {
      ws = new WebSocket(wsUrl(base));
      ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        const d = msg.data || {};
        if (d.prompt_id && d.prompt_id !== promptId) return;
        refresh();
        switch (msg.type) {
          case 'progress':
            if (onProgress) onProgress(d.value, d.max, d.node);
            break;
          case 'executed':
            if (d.output) outputs[d.node] = d.output;
            break;
          case 'executing':
            if (d.node === null && d.prompt_id === promptId) done(null, { outputs });
            break;
          case 'execution_success':
            done(null, { outputs });
            break;
          case 'execution_error':
            done(new Error(`ComfyUI 执行错误: ${d.exception_message || d.exception_type || '未知'}`));
            break;
          case 'execution_interrupted':
            done(new Error('ComfyUI 执行被中断'));
            break;
        }
      });
      ws.on('error', () => { /* poll still works */ });
      ws.on('close', () => { /* poll still works */ });
    } catch (_) { /* ws optional */ }

    // poll /history as reliable completion fallback
    pollTimer = setInterval(async () => {
      try {
        const hist = await getHistory(base, promptId);
        const entry = hist[promptId];
        if (!entry) return;
        const status = entry.status || {};
        if (status.status_str === 'error') {
          const msgs = (status.messages || []).map(m => Array.isArray(m) ? m.map(String).join(': ') : String(m)).join('; ');
          done(new Error(`ComfyUI 执行错误: ${msgs || '未知'}`));
          return;
        }
        const out = {};
        for (const nid of Object.keys(entry.outputs || {})) out[nid] = entry.outputs[nid];
        done(null, { outputs: out });
      } catch (_) { /* keep polling */ }
      refresh();
    }, 1000);
  });
}

module.exports = {
  normUrl, testConnection, queuePrompt, getHistory,
  uploadFile, viewFile, interrupt, waitForPrompt,
};
