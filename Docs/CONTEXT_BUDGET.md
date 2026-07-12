# Context Budget

Inventory observed on 2026-07-12:

| Surface | Files | Estimated tokens on disk |
|---|---:|---:|
| Codex skills | 13 | ~23,122 |
| Claude skills | 3 | ~3,255 |
| Claude user agents | 0 | 0 |
| Configured MCP servers | 1 | ~500 schema tokens per exposed tool as a planning estimate |

On-disk skill totals are not the same as always-loaded prompt overhead; skills should be loaded on demand. The current selective Claude/ECC installation is appropriately small. The largest future risk is enabling many MCP servers or bulk-copying ECC's full catalog.

Recommended policy:

- Keep Graphify discovery focused before opening broad source trees.
- Keep ECC skills selective and on demand.
- Add MCP only when it provides capability that a local CLI cannot provide cleanly.
- Re-run a context-budget audit after adding agents, rules, hooks or MCP servers.

