# Project architecture

## Current system

- `server.js`: Express composition root, mutable runtime configuration, middleware and route registration.
- `middleware/`: authentication, CSRF, security headers, and IP whitelist.
- `routes/`: HTTP boundary for auth, configuration, browsing, thumbnails, file operations, and AI workbench.
- `services/`: user persistence, thumbnails, and AI workflow execution.
- `utils/path-utils.js`: lexical managed-root path validation and name handling.
- `public/`: build-free HTML, CSS, and JavaScript clients.
- `config.json`, `users.json`, `.thumbcache/`, `.aiworkbench/`: runtime state; do not treat as source.

The current AI subsystem stores JSON workflows and node definitions, executes a DAG, calls ComfyUI, polls task state, and writes logs and results. It is development-stage code and must not be assumed to satisfy the documented queue, WebSocket, retention, or restart-recovery requirements.

## Target ownership

| Concern | Owner |
|---|---|
| Login, session, CSRF, IP policy | Express gateway |
| Managed roots and file authorization | File service |
| Browse, preview, upload, move, delete, publish | File service |
| Canonical workflow schema and migrations | Workflow service |
| Queue, concurrency, cancellation, state transitions | Task service |
| Canvas interaction and AI composition | Infinite-Canvas sidecar |
| ComfyUI or external model calls | Executor adapter |
| Logs, task metadata, result lineage | Task service |

## Target flow

1. Browser sends an authenticated request to Express.
2. Express resolves an opaque file ID or relative `fileRef` within an allowed root.
3. Workflow service validates and versions the canonical workflow.
4. Task service enqueues an immutable execution snapshot.
5. An executor adapter supplies controlled inputs to Infinite-Canvas, ComfyUI, or a local processor.
6. Executor outputs land in a per-task staging directory.
7. File service validates size, type, name, destination, and containment.
8. File service atomically publishes outputs and records lineage.

## Canonical workflow minimum

```json
{
  "schemaVersion": 1,
  "id": "wf_generated-id",
  "name": "Workflow name",
  "revision": 1,
  "nodes": [],
  "edges": [],
  "inputs": [],
  "outputs": [],
  "executor": {
    "type": "infinite-canvas",
    "payloadVersion": 1,
    "payload": {}
  }
}
```

Validate IDs, unique nodes, edge endpoints, port types, cycles, required inputs, executor allowlists, and payload size on the server.

## Design preferences

- Add a service when policy is reused or security-sensitive.
- Inject root/config/task dependencies rather than reading global mutable state deep in the stack.
- Use atomic writes for metadata and staging-plus-rename for published files.
- Prefer explicit schemas and state transitions over loosely shaped JSON.
- Avoid extending already oversized frontend files when a focused module can own the feature.
