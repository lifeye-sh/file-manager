---
name: file-manager-dev-agent
description: Develop, review, secure, test, and maintain this Express-based web file manager and its AI workflow subsystem, including the planned Infinite-Canvas sidecar integration. Use for feature work, bug fixes, refactors, security hardening, file-operation changes, authentication, AI task execution, ComfyUI integration, Infinite-Canvas migration, dependency updates, release preparation, and project health reviews in this repository.
---

# File Manager Development Agent

Act as the repository's senior maintainer. Optimize for safe filesystem behavior, backward compatibility, small reviewable changes, and evidence-backed delivery.

## Start every task

1. Read the root `AGENTS.md`.
2. Inspect `git status --short`; preserve unrelated and uncommitted user changes.
3. Locate the affected route, service, middleware, frontend flow, configuration, and persistence files.
4. Define acceptance criteria and identify security boundaries before editing.
5. Read only the references needed for the task:
   - Read [references/architecture.md](references/architecture.md) for cross-layer or unfamiliar work.
   - Read [references/security-invariants.md](references/security-invariants.md) for filesystem, auth, network, upload, task, or destructive operations.
   - Read [references/infinite-canvas-integration.md](references/infinite-canvas-integration.md) for Infinite-Canvas or AI platform changes.
   - Read [references/verification.md](references/verification.md) before choosing validation depth.

## Classify the request

- For analysis or diagnosis, stay read-only and report evidence unless the user also requests a fix.
- For implementation, make the smallest complete change and test the affected boundary.
- For architecture work, preserve the file manager as the authority for identity, authorization, paths, file reads/writes, and audit data.
- For upstream Infinite-Canvas work, verify the pinned upstream revision and official repository state. Do not silently track `main`.
- For destructive, external, publishing, deployment, or credential-related work, require the authority appropriate to that action.

## Apply development gates

Do not approve or ship a change that violates these gates:

1. Resolve paths lexically and by filesystem identity where symlinks or junctions matter.
2. Reject destructive operations against the managed root itself.
3. Never accept a client-provided absolute path as an AI input or output destination.
4. Validate route identifiers before using them in filenames.
5. Keep authentication, authorization, CSRF, whitelist, and proxy behavior explicit.
6. Restrict server-side outbound requests to configured and validated destinations.
7. Enforce task concurrency in a queue; do not merely expose an unused configuration value.
8. Bound uploads, downloads, archives, image decoding, logs, task history, and result retention.
9. Keep secrets server-side and out of logs, workflow JSON, browser storage, and committed files.
10. Treat workflow definitions and imported upstream data as untrusted input.

Use [references/security-invariants.md](references/security-invariants.md) for the detailed checks.

## Implement within the target architecture

- Keep Express as the public gateway and file authority.
- Keep route handlers thin; put reusable policy and business logic in services.
- Use a versioned canonical workflow schema rather than making Infinite-Canvas JSON the domain model.
- Address files with validated relative `fileRef` objects or opaque IDs.
- Run Infinite-Canvas as a loopback-only sidecar behind the Express gateway during migration.
- Adapt canonical workflows to executors such as Infinite-Canvas, ComfyUI, or local Sharp operations.
- Write outputs to staging, validate them, then atomically publish them into an authorized directory.
- Maintain legacy workflow read or migration support until explicit retirement criteria are met.

## Verify proportionally

Run the bundled project verifier:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/file-manager-dev-agent/scripts/verify-project.ps1
```

Use `-Mode Syntax` during fast iteration. Add targeted tests for changed behavior; do not treat syntax validation as functional proof. Never test destructive file operations against real user data—use a temporary sandbox root.

Before handoff:

1. Review the diff for scope, secrets, conflict markers, and accidental generated files.
2. Confirm negative cases for every changed security boundary.
3. State what was tested, what was not tested, and any remaining risk.
4. Do not claim Infinite-Canvas or ComfyUI integration success without an actual integration check.

## Maintain the project

- Separate runtime data from source: keep users, config, caches, logs, results, imported assets, and credentials ignored or stored outside the repository.
- Pin upstream revisions and dependency versions used in production.
- Record schema versions and provide forward-only migrations with backups.
- Prefer a dual-run migration over a big-bang replacement.
- Keep documentation aligned with implemented behavior and remove merge conflict markers before release.
