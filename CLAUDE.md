@AGENTS.md

# Claude Code project guidance

Use the `file-manager-developer` custom agent for substantial feature work,
debugging, security review, AI workflow changes, Infinite-Canvas integration,
dependency maintenance, and release preparation. The same procedure is available
directly as `/file-manager-dev-agent`.

Keep Claude Code in the standard permission mode. Do not bypass approval checks,
and do not add broad automatic permissions for shell commands, network access,
credentials, destructive file operations, or external publishing.

The current working tree may contain user-owned changes. Inspect it before edits,
preserve unrelated work, and never use destructive reset or checkout commands.

Detailed architecture, security, migration, and verification guidance lives in
`.agents/skills/file-manager-dev-agent/references/`; those files are the canonical
project-development references shared by the Claude and Codex agents.
