# Security invariants

## Filesystem

- Treat every query, body, workflow, imported file, archive name, and upstream result path as untrusted.
- Reject NULs, drive switches, UNC paths, absolute paths, `.` and `..` where identifiers or relative file references are expected.
- For destructive operations, reject a resolved target equal to any managed root.
- Check lexical containment first, then use `realpath` containment before reading or mutating existing targets.
- For new targets, validate the real parent directory and the sanitized basename.
- Account for Windows junctions, symlinks, case-insensitive paths, reserved device names, trailing dots/spaces, and cross-volume moves.
- Do not follow archive entries outside extraction roots.

## File references

Use an opaque ID or:

```json
{
  "rootId": "main",
  "path": "relative/path/image.png",
  "version": "etag-or-mtime-size"
}
```

Resolve `rootId` server-side. Never let a workflow select an arbitrary server path. Revalidate references at execution time.

## Authentication and authorization

- Apply authentication before protected static pages and APIs.
- Apply role checks at the route and service boundary for administration.
- Invalidate or re-evaluate sessions after user deletion, role change, or password reset.
- Require CSRF protection for cookie-authenticated state changes.
- Treat forwarded IP and protocol headers as trusted only from configured proxies.
- Do not expose sidecar services directly to browsers or the network.

## Outbound network and AI

- Restrict schemes to explicit allowlists, normally `http`/`https` and `ws`/`wss`.
- Resolve and reject loopback, link-local, cloud metadata, private, or other sensitive destinations unless explicitly configured by an administrator for the executor.
- Prevent DNS rebinding by validating resolved addresses at connection time.
- Add connection, response-header, total, idle, and body-size timeouts.
- Do not return provider secrets or raw internal error objects to the browser.

## Tasks

- Persist legal transitions: `queued`, `running`, `paused`, `terminating`, `completed`, `failed`, `aborted`, `cancelled`.
- Enforce concurrency in one scheduler and make claims atomic.
- Scope cancellation to a task; document providers whose interrupt endpoint is global.
- Mark in-flight tasks interrupted by restart as aborted or recover them deterministically.
- Make completion and output publication idempotent.
- Bound history, logs, prompts, results, retries, batch size, and task lifetime.

## Uploads and outputs

- Stream large payloads where possible and enforce per-file, request, user, and concurrency limits.
- Validate decoded media, not just extensions or client MIME types.
- Generate server-side destination names or validate names strictly.
- Avoid silent overwrite unless the API explicitly requests and authorizes it.
- Build ZIP files in a bounded streaming manner for large result sets.

## Secrets and upstream code

- Keep API keys and provider cookies server-side.
- Do not commit `.env`, user databases, runtime configuration, generated results, or logs.
- Pin Infinite-Canvas to a reviewed commit.
- Preserve required attribution and source obligations.
- Review upstream changes before updating; do not auto-merge `main`.
