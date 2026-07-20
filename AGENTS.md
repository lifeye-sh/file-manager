# File Manager project instructions

## Mission

Develop and operate a secure web file manager whose primary authority is the configured managed directory. Extend it with versioned AI workflows and an Infinite-Canvas integration without weakening filesystem, identity, or network boundaries.

Use the project skill at `.agents/skills/file-manager-dev-agent/SKILL.md` for feature work, fixes, reviews, refactors, security work, AI/ComfyUI changes, Infinite-Canvas integration, dependency maintenance, and releases.

## Current stack

- Node.js 20+, CommonJS, Express 4.
- Build-free HTML, CSS, and browser JavaScript.
- Sharp for thumbnails and local image processing.
- WebSocket and HTTP integrations with ComfyUI.
- JSON/file-backed runtime state.
- Planned Infinite-Canvas FastAPI sidecar.

## Required workflow

1. Inspect the working tree and preserve unrelated user changes.
2. Trace the full request path from browser to route, middleware, service, filesystem/network boundary, and persistence.
3. Define acceptance criteria and security-negative cases.
4. Make the smallest complete change.
5. Validate proportionally and report exact evidence.

Do not modify code when the user only asks for analysis or diagnosis.

## Non-negotiable safety rules

- Never permit reading, writing, moving, archiving, or deleting outside an authorized managed root.
- Never permit deletion or replacement of the managed root itself.
- Validate existing targets with real filesystem containment, including symlinks and Windows junctions.
- Never trust client-provided absolute paths, workflow paths, IDs, filenames, MIME types, URLs, or upstream result metadata.
- Keep authentication, authorization, CSRF, IP policy, proxy trust, and outbound URL policy explicit.
- Keep credentials and runtime data out of source control and browser-visible data.
- Put AI work behind a bounded task queue with legal state transitions, timeouts, cancellation semantics, retention, and restart handling.
- Test destructive behavior only in a disposable temporary root.

## Infinite-Canvas policy

- Personal-use authorization is accepted for this project; preserve attribution and applicable source obligations.
- Integrate Infinite-Canvas as a loopback-only sidecar behind Express first.
- Pin a reviewed upstream commit; never silently follow `main`.
- Keep Express authoritative for sessions, file authorization, API exposure, audit, and result publication.
- Use opaque file IDs or validated relative file references; never share arbitrary host paths.
- Store a versioned canonical workflow owned by this project and adapt it to upstream payloads.
- Keep the legacy AI workbench available until migration fixtures, rollback, and acceptance criteria pass.

## Code organization

- Keep routes thin and move reusable policy/business logic into services.
- Centralize path, URL, identifier, schema, and state-transition validation.
- Prefer atomic metadata writes and staging-plus-rename for file publication.
- Avoid adding more unrelated responsibilities to oversized frontend files.
- Preserve API compatibility or provide an explicit migration path.

## Verification

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/file-manager-dev-agent/scripts/verify-project.ps1
```

Use targeted tests and a browser check for affected behavior. Do not claim ComfyUI or Infinite-Canvas success without an actual integration run.

The repository currently contains development-stage AI code and known documentation debt. Treat existing failures as visible debt, not as reasons to weaken verification.
