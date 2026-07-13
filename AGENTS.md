# AI Project Control Agent Instructions

Read this file before changing the project.

## Authority

The Git repository is the source of truth for product behavior, architecture and documentation.
Obsidian is working knowledge. Graphify is a disposable discovery index. Neither may silently override repository files.

## Engineering workflow

1. Read `README.md`, `Docs/ARCHITECTURE.md`, `Docs/PROVIDER_POLICY.md`, `Docs/INTEGRATIONS.md` and `Docs/CURRENT_TASK.md`.
2. Inspect the current Git status and preserve unrelated changes.
3. Keep provider adapters, project knowledge adapters and the web UI modular. Add focused modules at stable ownership boundaries; do not replace the stack or perform a broad rewrite without a recorded decision.
4. Keep runtime state outside the repository under `%LOCALAPPDATA%\AI Project Control`.
5. Add no paid API path without explicit owner approval and a visible billing guard.
6. Prefer local CLI integrations over MCP servers when both offer the same capability.
7. Run `npm test` before declaring a change complete. Prefer unit, API and browser behavior tests over assertions that search production source text. Visually verify UI changes at 375, 768, 1024 and 1920 pixels when the browser test surface is available.
8. Update only the owning documentation, plus `Docs/CHANGELOG.md` and `Docs/CURRENT_TASK.md` when the task is complete.
9. Keep generic control-plane code free of project names, personal repository paths and model aliases. Put reviewed machine integrations in the system catalog and project-specific hints in project configuration.
10. Treat commit, integration, push and remote-branch deletion as separate owner gates. Never delete a remote branch as a side effect of local integration.

## Integration contract

Adding a repository, AI agent, model, MCP server or developer tool is not complete when the software is merely installed. Every addition must define and validate:

1. Its single workflow role and the problem it removes.
2. Whether it is global, project-dependent or project-specific.
3. The exact activation rule so it does not add permanent context overhead.
4. Its cost and credential boundary, including whether it can trigger paid usage.
5. How it connects to Graphify, Serena, Obsidian, providers and Hermes without duplicating their ownership.
6. A health check, an end-to-end test, documentation and a rollback path.

Prefer deterministic tools before LLM calls. Use Graphify for repository-wide discovery, Serena for symbol-level code navigation and Obsidian only for working knowledge. Use `cli-continues` only after a verified provider interruption; task packages, current files and Git state remain the authoritative handoff.

Do not commit, push, publish or create a remote unless the owner explicitly asks for that action.
