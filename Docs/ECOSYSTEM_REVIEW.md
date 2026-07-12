# Ecosystem Review

Reviewed on 2026-07-12. Star counts are point-in-time discovery signals, not quality scores. Candidates were compared against the existing Codex -> Claude -> Hermes/Ollama router, Graphify, Obsidian, ECC and the local dashboard. Serena and cli-continues were subsequently installed and integrated after their pilots passed local setup checks.

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
