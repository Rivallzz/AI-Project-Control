# Ecosystem Review

Reviewed on 2026-07-12. Star counts are point-in-time discovery signals, not quality scores. Candidates were compared against the existing Codex -> Claude -> Hermes/Ollama router, Graphify, Obsidian, ECC and the local dashboard. Serena and cli-continues were subsequently installed and integrated after their pilots passed local setup checks.

## Installed Tool Audit - 2026-07-14

The current machine catalog contains 26 systems. Installation is not treated as a reason to expose an MCP schema: deterministic runtimes and CLIs stay deterministic, provider applications stay behind the router, and project tools activate only from repository capability signals.

| Installed or detected system | Decision | Reason and activation boundary |
|---|---|---|
| Node.js | Keep as runtime | Runs the dashboard. It is not an agent tool and gains nothing from an MCP wrapper. |
| Git | Keep as CLI | Repository truth, diffs, branches and worktrees stay deterministic and owner-gated. |
| PowerShell 7 | Keep as runtime/CLI | Runs the router and local maintenance scripts. |
| Codex CLI | Keep as provider | Primary subscription-backed coding provider; the dashboard router owns activation and billing guards. |
| Claude Code | Keep as provider | Subscription-backed fallback provider; not a tool server. |
| Hermes Agent | Keep as orchestrator | Owns controlled multi-step and local-provider execution without duplicating Codex or Claude tools. |
| Ollama | Keep as local model host | Supplies the free local route and Graphify model; only explicit local model calls activate it. |
| Python | Keep as runtime | Supports Graphify and local automation. |
| uv | Keep as package/runtime manager | Owns isolated Python tools such as Serena; no MCP role. |
| Graphify | Keep as CLI/index | Repository-wide discovery precedes Serena. An MCP wrapper would duplicate the existing index adapter. |
| Obsidian | Keep as working-knowledge adapter | Working notes remain separate from repository truth and load only when relevant. |
| ECC | Keep as selective skill source | Its practices load on demand; bulk loading would create context bloat. |
| MCP | Keep as protocol capability | This catalog row detects configured servers; MCP itself is not another server. |
| Serena | Keep as MCP | Its structured symbol and reference operations are materially better than plain shell output. Global for Codex and Claude, activated only for code-symbol work. |
| cli-continues | Keep as CLI | Activates only after a verified provider interruption. A permanent MCP schema would violate that boundary. |
| GitHub CLI | Keep as CLI | Local and remote GitHub actions remain explicit; hosted GitHub connector tools may be used on demand, but a second classic GitHub MCP would duplicate them. |
| ripgrep | Keep as CLI | Fast deterministic text search with negligible context overhead. |
| jq | Keep as CLI | Deterministic JSON filtering without an LLM or MCP schema. |
| CC Switch | Optional removal candidate | Convenience UI for provider configuration. It is redundant if provider configuration is managed only through AI Project Control and no external workflow uses it. |
| Comfy Desktop | Keep project-dependent | Activate only for repositories declaring an image-generation or asset-pipeline capability. |
| Comfy Cloud | Optional removal/disable candidate | Adds no value to a local-only Comfy/Flux workflow and can have separate cloud cost. Keep disabled unless a project explicitly needs it. |
| Flux local | Keep project-dependent | Local image model, activated only for a declared image pipeline. |
| FFmpeg | Keep project-dependent CLI | Deterministic media processing for repositories with media signals. |
| ImageMagick | Keep project-dependent CLI | Deterministic image transformation for declared asset pipelines. |
| 7-Zip | Keep project-dependent CLI | Deterministic archive handling for asset pipelines. |
| Godot | Keep project-dependent CLI | Headless engine and tests activate only for Godot repositories. |

Seven enabled Codex plugins were also checked: Documents, PDF, Spreadsheets, Presentations, Template Creator, Browser and Visualize. They remain plugin/skill capabilities with progressive disclosure. Browser already uses Codex's managed `node_repl` MCP runtime; adding Playwright, Chrome DevTools or another browser MCP by default would duplicate this role. Artifact plugins should not become permanent MCP servers because their instructions and runtimes are needed only when the corresponding file type is requested.

Cached marketplace packages are not counted as installed integrations. In particular, Figma, GitHub and OpenAI platform connector manifests found in the plugin cache must remain plugin-managed and activate only after an explicit install/use request and any required authentication. They must not be copied into classic MCP configuration merely to increase the dashboard count.

### MCP Result

- **Serena** remains the only code-semantic MCP and is configured for Codex and Claude Code. Its local Claude connection and Serena runtime were healthy during this audit.
- **node_repl** remains Codex-managed for the installed Browser plugin. It is not duplicated in project configuration.
- **OpenAI Developer Docs** is added only for this repository in `.codex/config.toml`. It exposes an allow-list of five read-only tools, needs no credential, creates no paid API path and is not a required startup dependency. A protocol handshake, tool listing and one search call passed. Removing that one table is the rollback.
- All other installed items stay CLI-, runtime-, skill-, plugin- or project-managed. No additional MCP wrapper passed the non-duplication test.

## Shortlist

### Serena - integrated

- Repository: https://github.com/oraios/serena
- Stars observed: 26,354
- Value: LSP-backed symbol lookup, reference navigation and symbol-level editing can reduce full-file reads in code-heavy repositories.
- Fit: complements Graphify. Graphify discovers cross-document relationships; Serena can retrieve exact code symbols after discovery.
- Result: installed globally through `uv`, connected to Codex and Claude Code, activated per worktree and kept outside project repositories.
- Boundary: enabled only for code-heavy tasks; its code-semantic tools complement rather than duplicate Graphify.

### cli-continues - integrated

- Repository: https://github.com/yigitkonur/cli-continues
- Stars observed: 1,335
- Value: read-only parsing of native Codex and Claude sessions into bounded handoff documents directly addresses quota-driven provider changes.
- Fit: can improve the existing router handoff without becoming another agent.
- Result: installed globally through npm and used only after verified Codex or Claude quota failures.
- Boundary: native session formats are reverse-engineered and may change. Exact project/time matching is required, and generated extracts remain subordinate to the dashboard task package and Git state.

### Agent Skills - selective source library

- Repository: https://github.com/addyosmani/agent-skills
- Stars observed: 77,478
- Value: structured lifecycle skills with progressive disclosure and verification gates.
- Fit: use as a source for auditing or selectively updating ECC skills.
- Boundary: do not load or install the whole catalog. That would duplicate ECC and increase standing context.

### GitHub Spec Kit - template source for large work

- Repository: https://github.com/github/spec-kit
- Stars observed: 119,749
- Value: durable Spec -> Plan -> Tasks -> Implement artifacts and cross-artifact consistency checks.
- Fit: useful when creating a new project or a large feature. AI Project Control already has AGENTS, CURRENT_TASK, decision and review gates, so concepts should be adapted rather than duplicated.
- Boundary: not required for small tasks or the normal chat flow.

## Do Not Add To The Default Workflow

### claude-mem

Automatic capture, compression and context injection overlap with Obsidian, Hermes memory and AI Runs. It may improve recall, but it also introduces another worker, database, hooks and automatic token injection. Reconsider only after measured failures in the current memory workflow.

### Repomix

Packing a whole repository is useful for one-off external reviews. It conflicts with the normal Graphify-first goal of selecting a small amount of source context. Keep it outside the default path.

### Aider

Aider's repository-map design is worth studying, but adding another coding agent and automatic Git behavior duplicates Codex and Claude and weakens the current approval boundaries.

### AionUi, AI Maestro and other agent dashboards

They overlap directly with AI Project Control. Their session observability and handoff ideas can inform the product, but running another control plane would create competing state and more maintenance.

### codebase-context

The conventions map is relevant, but the project is currently small and overlaps Graphify plus repository rules. Revisit after stronger adoption or if Graphify consistently fails to identify local coding patterns.

## Recommended Evaluation Order

1. Measure Serena on one code-heavy Polis task and compare files read, context size and result quality.
2. Exercise cli-continues during the next real quota handoff and compare its minimal extract to the router package.
3. Audit only the context-engineering, code-review and test skills from Agent Skills against ECC.
4. Adapt selected Spec Kit templates for future large projects without adding a mandatory runtime.
