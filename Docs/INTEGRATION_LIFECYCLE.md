# Integration Lifecycle

Every repository, AI agent, model, MCP server or developer tool must improve the existing workflow rather than create a parallel one.

## Required Contract

Before installation, define:

1. **Problem** - the measurable gap the addition removes.
2. **Role** - one primary responsibility and the existing owner it complements.
3. **Scope** - global, project-dependent or project-specific.
4. **Activation** - the exact task signal that turns it on and when it stays off.
5. **Cost** - local resources, subscription use, credentials and every possible billing path.
6. **Data flow** - inputs, outputs, stored state and source-of-truth boundary.
7. **Handoff** - how it exchanges bounded artifacts with providers and Hermes.
8. **Validation** - detection, health check and one realistic end-to-end test.
9. **Documentation** - catalog entry, operating instructions and project notes when relevant.
10. **Rollback** - configuration restore and uninstallation without repository data loss.

## Existing Ownership

- Git and repository documentation: authoritative project state.
- Graphify: repository-wide discovery and relationship hints.
- Serena: symbol-level code navigation and editing.
- Obsidian: working notes, prompts, run links and reviewed lessons.
- Codex and Claude Code: subscription-backed implementation and review providers.
- Hermes: controlled orchestration and the local Ollama execution path.
- cli-continues: supplemental local session extraction during verified provider interruption.
- ECC: selectively loaded context and workflow practices.

## Adding A New Project

Projects created by AI Project Control receive Git, baseline owner documents, Graphify, Obsidian and the general Hermes contract. Serena is global and activates the new worktree when code-symbol work needs it. cli-continues requires no project files and matches sessions by the actual working directory.

Project-dependent tools are inferred from repository signals and displayed only when relevant. A project with an asset pipeline may use ComfyUI or Flux; a dashboard or documentation project should not inherit those requirements.

## Adding A Tool Or Agent

1. Verify the official source, license, maintenance state and local requirements.
2. Compare it with the existing ownership list and reject functional duplicates without measured benefit.
3. Add a data-driven `config/systems.json` system definition. Reuse or add exactly one official source and one package identity; grant only the install, check and update operations that are safe for that source type.
4. Declare `workflowRole`, `activation` and `costPolicy`.
5. Connect it at the narrowest stable boundary: CLI before MCP when capabilities are equal.
6. Add it to task compilation or provider handoff only where the activation rule is true.
7. Test failure behavior as well as success behavior.
8. Update owning documentation and rollback instructions.

No tool may silently introduce API-key billing, automatic top-ups, unattended loops, commits, pushes, merges or competing project memory.
