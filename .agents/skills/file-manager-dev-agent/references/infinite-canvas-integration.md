# Infinite-Canvas integration

## Adopt as a sidecar first

Run Infinite-Canvas as a separate FastAPI process bound to loopback. Route browser traffic through Express so the existing authentication, CSRF, whitelist, headers, audit, and rate limits remain authoritative.

Do not initially copy its large Python backend or canvas frontend into the current source tree. Keep the upstream checkout or packaged runtime separate and pin it to an exact commit.

## Integration contract

Expose a narrow adapter instead of the complete upstream API:

- create or update a canvas document;
- import authorized file references;
- submit a versioned workflow execution;
- query task state and normalized progress;
- request cancellation where safely supported;
- collect staged outputs;
- export or migrate the canvas document.

The browser must not receive filesystem paths or upstream credentials. The sidecar must not independently choose arbitrary host files.

## Gateway rules

- Bind sidecar to `127.0.0.1` or an isolated container network.
- Remove permissive CORS at the externally reachable boundary.
- Authenticate every proxied HTTP and WebSocket request.
- Strip unneeded forwarding headers.
- Limit request/response sizes and WebSocket message sizes.
- Apply endpoint and host allowlists for external AI providers.
- Store provider credentials in a server-side secret store or ignored runtime configuration.

## Workflow strategy

Keep a canonical workflow envelope owned by this project. Store upstream canvas payload under a versioned executor adapter. This permits:

- legacy AI workbench conversion;
- future Infinite-Canvas upgrades;
- another executor without rewriting user metadata;
- server-side validation independent of UI implementation.

Do not promise lossless conversion until fixtures prove node, edge, port, media, and parameter mappings.

## Migration stages

1. License and commit gate: record permitted use and the reviewed upstream commit.
2. Isolated spike: verify startup, canvas save/load, one authorized image input, one ComfyUI execution, and one output export.
3. Gateway integration: same-origin route, session enforcement, controlled WebSocket proxy, and file-reference broker.
4. Unified tasks: route executions through the project queue and normalize status/log/result events.
5. Dual run: keep the legacy workbench available for existing workflows and compare outputs.
6. Migration: convert supported workflows, preserve backups, and identify unsupported nodes.
7. Retirement: remove the old frontend only after acceptance, rollback, and data-retention criteria pass.

## Upgrade discipline

- Track an exact commit, not a floating branch.
- Maintain an upstream patch inventory.
- Test API compatibility, canvas schema migration, credential handling, and file isolation on every update.
- Keep a rollback package and a backup of canvas/workflow metadata.
