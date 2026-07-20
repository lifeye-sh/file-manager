# Verification matrix

## Baseline

- Run JavaScript syntax checks.
- Run `npm ls --depth=0`.
- Search source and documentation for merge conflict markers.
- Run `git diff --check`.
- Review `git status --short` and the scoped diff.

Use `scripts/verify-project.ps1` for these checks.

## Filesystem changes

Use a disposable temporary managed root. Test:

- ordinary nested path;
- empty path, `.`, `..`, absolute path, drive-relative path, UNC path;
- encoded and double-encoded traversal;
- root deletion attempt;
- symlink or Windows junction escape;
- missing source and existing destination;
- case-only rename and cross-volume move if supported;
- aborted upload and oversized upload.

Assert that no path outside the temporary root changes.

## Auth and configuration

Test unauthenticated, normal user, administrator, expired session, deleted user, stale CSRF, trusted proxy, and untrusted forwarded headers. Confirm secrets are absent from responses and logs.

## Workflow and tasks

Test malformed schema, duplicate IDs, dangling edges, cycles, missing ports, invalid types, unsupported executor, absent input, input changed after submission, batch limit, concurrency limit, timeout, cancellation, provider failure, restart recovery, duplicate completion, and result retention.

## Infinite-Canvas integration

Test the pinned revision in isolation and through the Express gateway:

- direct sidecar network access is unavailable;
- HTTP and WebSocket authentication is enforced;
- only authorized file references can be imported;
- absolute and traversal paths are rejected;
- credentials stay server-side;
- workflow save/load survives restart;
- status and cancellation map correctly;
- outputs publish only to an authorized destination;
- sidecar outage degrades without breaking file management;
- rollback to the prior revision works.

## Frontend

Exercise login, browse, upload, preview, editing, drag/drop, context menus, AI send-to-canvas, task status, result navigation, mobile layout, keyboard behavior, and CSP in a real browser. Check the browser console and network panel.

## Reporting

Report exact commands, environment assumptions, passed checks, failed checks, skipped integrations, and remaining risks. A syntax pass is not an end-to-end pass.
