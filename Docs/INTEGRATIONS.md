# Integrations

## Graphify

Graphify is the semantic discovery layer. New projects receive `graphify-out/graph.json`, which stays ignored by Git because it can be rebuilt. Search results are hints, not authority.

The dashboard presents Graphify and Obsidian together. One search query filters relationships and working notes, while source badges preserve the authority boundary. Graph zoom is local UI state and does not alter the index.

## Obsidian

Each project receives a working area under `Project-Knowledge/10 Projects/<Project>`. It contains dashboards, working notes, research, reviews, prompts, lessons and AI-run links. Official project documentation stays in Git.

The project area is initialized with lightweight index notes for every working category. Notes load automatically when the Knowledge view opens; no synchronization copy of repository documentation is created.

## Git And GitHub

Git status, branch, upstream, remote and text diffs are read through the local Git CLI. GitHub authentication is reported through GitHub CLI. Commit and push are owner-triggered actions in separate confirmation steps. The dashboard does not merge, force-push or edit repository files in the review view.

## Hermes And ECC

Hermes is the execution orchestrator used for the local Ollama fallback and controlled skills. ECC is a selective library of skills, rules, retrieval patterns and context-budget checks. They complement each other: Hermes runs workflows; ECC improves how context and reusable procedures are selected.

Only selected ECC capabilities should be activated. Loading its entire catalog would add noise and context overhead.

## MCP

MCP connects an agent to external tools through a standard protocol. MCP itself has no subscription fee. Local MCP servers are free apart from machine resources; remote services can have their own billing or account terms.

The current setup contains one Codex MCP server (`node_repl`) and no active Claude project MCP server. This is intentionally small. CLI tools remain preferable when they cover the same operation because each MCP tool schema consumes context.
