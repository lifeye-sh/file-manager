# Infinite-Canvas integration boundary

For a complete Windows installation, including the Python virtual environment,
pinned upstream download, SHA-256 verification, ComfyUI configuration, startup,
logs, and troubleshooting, see [the project installation guide](../../INSTALL.md).

This project integrates [hero8152/Infinite-Canvas](https://github.com/hero8152/Infinite-Canvas)
as a separately managed, loopback-only sidecar. The upstream source is not vendored
into this repository.

The exact upstream revision is recorded in `upstream.json`. Updating it requires a
review of startup behavior, API compatibility, credential handling, file isolation,
license obligations, migration fixtures, and rollback.

## Runtime layout

The integration uses three loopback processes:

- File Manager/Express on `127.0.0.1:3000` remains authoritative for login,
  authorization, CSRF, endpoint policy, the bounded task queue, audit state, and
  publishing results into the managed root.
- The narrow adapter on `127.0.0.1:7862` verifies the pinned source and brokers
  opaque, validated file imports.
- The protected upstream runner on `127.0.0.1:7863` runs a mutable runtime copy
  of the verified source. It requires the gateway token for HTTP and WebSocket
  traffic and is never exposed directly to browsers.

`/ai-workbench.html` redirects to the authenticated same-origin Canvas gateway.
The previous implementation remains available at `/ai-workbench-legacy.html`
for rollback while existing workflows are retained.

## Adapter contract v1

The Express gateway initially requires only:

```http
GET /health
```

Successful response:

```json
{
  "ok": true,
  "contractVersion": 1,
  "upstreamCommit": "06eb6f524dd93dcfdb85e8b76041bddb735063ec"
}
```

The adapter must bind to `127.0.0.1`. Browsers must access it only through the
authenticated Express gateway. It must not accept arbitrary host paths or expose
provider credentials.

Every request also requires the `X-File-Manager-Gateway-Token` header. Set the same
random value (at least 32 characters) in `INFINITE_CANVAS_GATEWAY_TOKEN` for both
Express and the sidecar. The token is never stored in `config.json` or returned to
the browser.

Start the adapter against a Git checkout:

```powershell
$env:INFINITE_CANVAS_GATEWAY_TOKEN = '<random 32+ character secret>'
.\integrations\infinite-canvas\start-sidecar.ps1 `
  -UpstreamDir 'D:\path\to\Infinite-Canvas' `
  -StagingDir 'D:\runtime\infinite-canvas-staging'
```

Startup health remains unavailable unless `git rev-parse HEAD` exactly matches the
commit in `upstream.json` and the checkout contains `main.py`.

An official GitHub archive of the same commit is also accepted when `-ArchivePath`
is supplied. Its archive SHA-256, extracted root name, and complete source-tree
SHA-256 must all match `upstream.json`; modified or path-redirected source fails
closed.

Run the adapter contract tests with:

```powershell
npm run test:sidecar
```

The broker contract supports gateway-only image staging:

```http
PUT /v1/imports/{server-generated-import-id}
DELETE /v1/imports/{server-generated-import-id}
```

Only JPEG, PNG, WebP, and GIF are accepted. Express performs managed-root and
decoded-image validation before forwarding bytes. The sidecar independently checks
the media signature, per-file limit, total staging capacity, and opaque identifier.

The File Manager context menu publishes a validated image into the Canvas asset
library through the protected upstream API, then removes its broker staging copy.
No absolute managed-root path is sent to Infinite-Canvas or the browser.

## Start and stop the development stack

The official archive and extracted source described by `upstream.json` must exist
under `%LOCALAPPDATA%\FileManager\Infinite-Canvas`. Start all three services with:

```powershell
.\integrations\infinite-canvas\start-debug-stack.ps1 `
  -ComfyUiUrl 'http://192.168.3.34:8870'
```

The script generates one ephemeral gateway token, starts hidden child processes,
waits with bounded health retries, and stores PID/log files in the runtime
directory. Stop only those recorded processes with:

```powershell
.\integrations\infinite-canvas\stop-debug-stack.ps1
```

## Execution and result publication

Canvas image, ComfyUI, video, and LLM execution endpoints are intercepted before
the generic proxy and submitted to the project's persistent bounded scheduler.
Direct upstream execution endpoints are denied. Queued tasks use the project's
legal state transitions and restart recovery. Cancellation stops local polling;
upstream Infinite-Canvas does not provide a task-scoped cancellation API, so an
already-submitted remote provider task may require provider-side cleanup.

Returned media is accepted only from allowlisted upstream-relative output paths.
Downloads do not follow redirects and are bounded by count, per-file size, and
aggregate size. Images are decoded and videos have their container signatures
checked. All files are written to a random staging directory below
`<managed-root>\AI-Canvas`, then atomically renamed into the task directory.
Task history stores versioned `fileRef` values, never host paths.

`workflows/file-manager-smoke.json` is a project-owned, model-free migration
fixture copied into the mutable upstream runtime at startup. It is used only for
end-to-end queue and result-publication verification.

## Gateway policy

The Express gateway:

- requires an authenticated File Manager session and same-origin WebSocket origin;
- requires CSRF for mutations and injects it into upstream browser `fetch` calls;
- forwards a server-only gateway token to the loopback services;
- denies provider/token mutation, self-update, CLI/cloud integration, arbitrary
  storage, and all raw execution endpoints;
- returns an empty shared-folder list so upstream cannot disclose host paths;
- limits HTTP request/response and WebSocket payload sizes.

## Verification and rollback

Run:

```powershell
npm test
npm run test:sidecar
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .agents\skills\file-manager-dev-agent\scripts\verify-project.ps1
```

Rollback is immediate: stop the debug stack, disable
`aiWorkbench.infiniteCanvas.enabled`, and use `/ai-workbench-legacy.html`.
The legacy workflow files and task history are not deleted or rewritten by the
Canvas migration.

## Upstream obligations

The pinned source remains attributed to
[hero8152/Infinite-Canvas](https://github.com/hero8152/Infinite-Canvas). Review
`upstream.json` and the pinned upstream `LICENSE` before distribution or
commercial use. Updating the pinned commit requires a new source/archive hash,
security review, browser test, migration fixture review, and rollback test.
