# Integrations

## Graphify

Graphify is the semantic discovery layer. New projects receive `graphify-out/graph.json`, which stays ignored by Git because it can be rebuilt. Search results are hints, not authority.

The dashboard presents Graphify and Obsidian together. One search query filters relationships and working notes, while source badges preserve the authority boundary. The Graphify canvas, node list and direct-relationship controls share one selection state so every entry can locate and inspect the same node without altering the index. The potentially large node list scrolls inside a keyboard-focusable region matched to the responsive graph height; its heading and selection guidance remain visible. Graph zoom and centering remain local UI state.

## Obsidian

Each project receives a working area under `Project-Knowledge/10 Projects/<Project>`. It contains dashboards, working notes, research, reviews, prompts, lessons and AI-run links. Official project documentation stays in Git.

The project area is initialized with lightweight index notes for every working category. Notes load automatically when the Knowledge view opens; no synchronization copy of repository documentation is created.

## Serena

Serena provides LSP-backed symbol lookup, reference navigation and symbol-level editing to Codex and Claude Code through one global MCP registration. It activates the current worktree for each agent run, while its generated state stays outside Git under `%LOCALAPPDATA%\AI Project Control\serena-projects`.

Use Serena for code-heavy analysis and changes after Graphify has narrowed the relevant area. Do not invoke it for ordinary documentation questions or as a duplicate file, shell or repository search layer. Serena is local and open source; it uses the already selected model and adds no subscription.

## cli-continues

cli-continues reads local Codex and Claude session stores without modifying them. The router preserves provider sessions and, only after a verified quota failure, selects a session whose working directory and timestamp match the interrupted run. It exports the `minimal` preset into the attempt directory.

That extract is supplemental. The task package, current worktree, Git status, diff, stdout and stderr remain the authoritative handoff. If no exact session match exists, the router skips cli-continues instead of guessing.

## Git And GitHub

Git status, branch, upstream, remote, worktrees and per-file diffs are read through the local Git CLI. GitHub authentication is reported through GitHub CLI. Commit, task-to-target fast-forward, cleanup and push are owner-triggered actions in separate confirmation steps. A safe fast-forward never resolves conflicts. It targets the separate integration branch when one exists and otherwise explicitly targets `main`; only a separate integration branch is intended to enter `main` through a reviewed pull request. Integration removes the completed local task worktree and branch but preserves any remote branch. The dashboard never force-pushes or edits repository files in the review view.

## Hermes And ECC

Hermes is the execution orchestrator used for the local Ollama fallback and controlled skills. The explicit dashboard provider `Hermes lokal (Ollama)` starts the same controlled router path directly. ECC is a selective library of skills, rules, retrieval patterns and context-budget checks. They complement each other: Hermes runs workflows; ECC improves how context and reusable procedures are selected.

Only selected ECC capabilities should be activated. Loading its entire catalog would add noise and context overhead.

## MCP

MCP connects an agent to external tools through a standard protocol. MCP itself has no subscription fee. Local MCP servers are free apart from machine resources; remote services can have their own billing or account terms.

The current setup adds Serena to Codex and Claude Code as the one code-semantic MCP integration. Codex also has its local `node_repl` server. This remains intentionally small. CLI tools remain preferable when they cover the same operation because each MCP tool schema consumes context.

This repository additionally enables the official OpenAI Developer Docs Streamable HTTP server through project `.codex/config.toml`. Its single role is current OpenAI product and API documentation. It activates only in this trusted repository and exposes exactly `search_openai_docs`, `fetch_openai_doc`, `list_openai_docs`, `list_api_endpoints` and `get_openapi_spec`. All five tools report read-only, non-destructive annotations; the server needs no credential and creates no API-billing path. It complements the local Codex manual and does not replace Graphify, Serena, Obsidian, providers or Hermes. The 2026-07-14 health check completed MCP initialization, listed the five tools and executed one documentation search. Rollback is deletion of the `mcp_servers.openaiDeveloperDocs` table.

The `MCP-Server` dashboard view is a read-only configuration inventory for the selected project. It reads global and project Codex/Claude configuration, distinguishes STDIO from HTTP and shows role, scope, activation, explicit tool filters, timeouts and cost boundary. It does not write client configuration, launch configured commands or probe remote services. Consequently, `konfiguriert` means that a complete command or URL was found, not that a live MCP handshake succeeded. Environment and header values, URL credentials and query values are redacted; only referenced names are exposed.

Local runtimes, installation checks and updates remain under the secondary `Lokale Laufzeiten & Diagnose` disclosure. This keeps MCP connections distinct from software installation and prevents a detector failure such as an unavailable executable alias from being presented as an MCP configuration problem. Rollback is limited to removing this read-only view and endpoint; client-owned MCP files remain unchanged.

The separate `Workflow` view consumes this inventory only as a safe capability signal. A configured MCP server is shown as `bei Bedarf`, never as connected. Serena becomes active only for a running task with a code signal; `node_repl` remains reserved for browser/UI verification and OpenAI Developer Docs for current OpenAI documentation work. Graphify, Git, Obsidian, the provider router and cli-continues retain their CLI or project-knowledge ownership instead of being relabeled as MCP. Removing the Workflow view or its projection module rolls back this explanation layer without changing any tool configuration.

Codex plugins and hosted app connectors are a separate integration surface. Enabled document, browser and visualization plugins load on demand; cached marketplace manifests are not proof of installation. Plugin-managed GitHub, Figma or OpenAI Platform tools must not be duplicated as classic MCP servers. The complete 2026-07-14 classification and the two optional removal candidates are recorded in `Docs/ECOSYSTEM_REVIEW.md`.

## Flux And ComfyUI

Flux and ComfyUI are project-dependent image-generation tools, not dashboard foundations. Detection uses Comfy Desktop settings, the optional `AI_PROJECT_CONTROL_COMFY_ROOT` location and `ComfyUI` siblings of registered repository roots. A custom portable installation can also be registered in System Inventory. These tools appear as relevant only for projects that explicitly declare or contain a bounded image-generation workflow signal.
