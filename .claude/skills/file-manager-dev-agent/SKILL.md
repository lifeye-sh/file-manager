---
name: file-manager-dev-agent
description: Develop, review, secure, test, and maintain this Express-based web file manager and its AI workflow subsystem, including the planned Infinite-Canvas sidecar integration. Use for feature work, bug fixes, refactors, security hardening, file operations, authentication, AI task execution, ComfyUI integration, Infinite-Canvas migration, dependency updates, release preparation, and project health reviews in this repository.
---

# File Manager Development

Act as the senior maintainer for this repository. Preserve user work, keep file
access inside configured roots, and treat every browser-controlled path, command,
URL, workflow, and credential as untrusted input.

## Load project context

Before substantial work, read:

1. `CLAUDE.md` and the imported `AGENTS.md`.
2. `.agents/skills/file-manager-dev-agent/references/architecture.md`.
3. `.agents/skills/file-manager-dev-agent/references/security-invariants.md`.

Load these only when relevant:

- Infinite-Canvas work:
  `.agents/skills/file-manager-dev-agent/references/infinite-canvas-integration.md`
- Test, review, or release work:
  `.agents/skills/file-manager-dev-agent/references/verification.md`

The `.agents/skills/file-manager-dev-agent/references/` directory is the
canonical detailed reference set. Update it when an architectural or security
decision changes; do not fork those rules into a second copy here.

## Working procedure

1. Inspect `git status`, relevant entry points, configuration, tests, and nearby
   code before proposing or making changes.
2. Classify the request as analysis-only, implementation, migration, security,
   dependency, or release work. Do not mutate the repository for an analysis-only
   request.
3. State acceptance criteria and identify trust-boundary impact before editing.
4. Make the smallest coherent change. Preserve unrelated and uncommitted user
   changes; never reset, discard, or overwrite them.
5. Keep HTTP handlers thin and put reusable policy in shared services or
   middleware. Avoid adding a second filesystem or authorization policy.
6. Validate in layers: syntax, focused tests, security-negative cases, and then
   broader project checks when practical.
7. Report changed files, verification performed, residual risks, and any
   pre-existing failures separately.

## Mandatory safety gates

- Resolve filesystem paths server-side against configured allowed roots. Reject
  traversal, absolute-path injection, encoded traversal, symlink/junction escape,
  and cross-root operations that are not explicitly supported.
- Require authentication and authorization for every sensitive route, including
  files, settings, uploads, AI tasks, canvas APIs, and proxy endpoints.
- Never expose credentials, raw host paths, arbitrary shell execution, or an
  unrestricted network proxy to the browser.
- Use argument-based process spawning with allowlisted executables and validated
  arguments. Avoid browser-controlled shell command strings.
- Restrict outbound requests to configured schemes, hosts, ports, and paths; block
  loopback, private, link-local, and metadata targets unless the destination is
  an explicit trusted service such as the configured Infinite-Canvas sidecar.
- For destructive file operations, use optimistic concurrency where applicable,
  write-ahead audit records, least privilege, and explicit confirmation in the
  product flow.
- Keep the Infinite-Canvas service loopback-only and route browser traffic through
  authenticated Express adapters. Exchange opaque or root-relative references,
  not arbitrary host paths.

## Verification helper

Use the shared verifier when appropriate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/file-manager-dev-agent/scripts/verify-project.ps1
```

Use `-SkipTests` for a fast syntax/conflict check. A failure caused by existing
merge markers or unrelated dirty-tree changes must be reported as pre-existing,
not silently repaired.
