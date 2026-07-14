# Context Budget

Inventory observed on 2026-07-14:

| Surface | Files | Estimated tokens on disk |
|---|---:|---:|
| Codex skills | 14 | ~44,384 |
| Cached plugin skills | 48 | ~108,136 |
| Claude skills | 3 | ~4,575 |
| Global and repository agent rules | 2 | ~711 |
| Direct Codex MCP tools | 30 across 3 integration families | ~15,000 as an eager-loading upper-bound proxy |

On-disk skill totals are not the same as always-loaded prompt overhead. Codex skills, installed plugin skills and hosted connector tools use progressive or lazy disclosure. The direct MCP estimate uses the audit heuristic of roughly 500 tokens per exposed schema: Serena exposes 22 tools, Codex's managed `node_repl` exposes 3 and the project-scoped OpenAI Developer Docs server exposes 5. The host may load less than this estimate, but it remains a useful duplication warning.

The selected project now has four configuration rows because Serena appears once for each client: three Codex rows (`node_repl`, Serena and OpenAI Developer Docs) and one Claude Code row (Serena). These are three distinct integration roles, not four competing capabilities. Plugin-backed GitHub, Figma, document and browser surfaces remain outside the classic MCP count and must not be copied into it solely for visibility.

Recommended policy:

- Keep Graphify discovery focused before opening broad source trees.
- Keep ECC skills selective and on demand.
- Add MCP only when it provides capability that a local CLI cannot provide cleanly.
- Keep remote MCPs project-scoped and tool-allow-listed whenever their role is narrow.
- Do not duplicate plugin-managed connectors with classic MCP registrations.
- Re-run a context-budget audit after adding agents, rules, hooks or MCP servers.
- Preserve the original owner prompt and use a deterministic task envelope instead of a mandatory prompt-rewriter LLM.
- Inject at most four lexically relevant reviewed memory notes, or two recent notes when no match exists.
- Use a 4,096-token Graphify extraction budget with one local Ollama request at a time; split or retry locally when structured output is incomplete.
