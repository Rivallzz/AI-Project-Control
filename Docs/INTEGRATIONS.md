# Integrations

## Graphify

Graphify is the semantic discovery layer. New projects receive `graphify-out/graph.json`, which stays ignored by Git because it can be rebuilt. Search results are hints, not authority.

## Obsidian

Each project receives a working area under `Project-Knowledge/10 Projects/<Project>`. It contains dashboards, working notes, research, reviews, prompts, lessons and AI-run links. Official project documentation stays in Git.

## Hermes And ECC

Hermes is the execution orchestrator used for the local Ollama fallback and controlled skills. ECC is a selective library of skills, rules, retrieval patterns and context-budget checks. They complement each other: Hermes runs workflows; ECC improves how context and reusable procedures are selected.

Only selected ECC capabilities should be activated. Loading its entire catalog would add noise and context overhead.

## MCP

MCP connects an agent to external tools through a standard protocol. MCP itself has no subscription fee. Local MCP servers are free apart from machine resources; remote services can have their own billing or account terms.

The current setup contains one Codex MCP server (`node_repl`) and no active Claude project MCP server. This is intentionally small. CLI tools remain preferable when they cover the same operation because each MCP tool schema consumes context.

