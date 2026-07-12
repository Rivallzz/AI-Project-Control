# AI Project Control Agent Instructions

Read this file before changing the project.

## Authority

The Git repository is the source of truth for product behavior, architecture and documentation.
Obsidian is working knowledge. Graphify is a disposable discovery index. Neither may silently override repository files.

## Engineering workflow

1. Read `README.md`, `Docs/ARCHITECTURE.md`, `Docs/PROVIDER_POLICY.md`, `Docs/INTEGRATIONS.md` and `Docs/CURRENT_TASK.md`.
2. Inspect the current Git status and preserve unrelated changes.
3. Keep provider adapters, project knowledge adapters and the web UI modular.
4. Keep runtime state outside the repository under `%LOCALAPPDATA%\AI Project Control`.
5. Add no paid API path without explicit owner approval and a visible billing guard.
6. Prefer local CLI integrations over MCP servers when both offer the same capability.
7. Run `npm test` before declaring a change complete.
8. Update only the owning documentation, plus `Docs/CHANGELOG.md` and `Docs/CURRENT_TASK.md` when the task is complete.

Do not commit, push, publish or create a remote unless the owner explicitly asks for that action.

