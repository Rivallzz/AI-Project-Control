# AI Project Control

AI Project Control is a local, multi-project workspace for running controlled tasks through Codex, Claude Code and Ollama while keeping project knowledge connected through Graphify and Obsidian.

## What it provides

- One chat-like task and feedback timeline per project.
- Provider routing: Codex, then Claude Code, then local Ollama.
- A visible switch that disables subscription-token use and forces local Ollama.
- Automatic isolated Git worktrees for write tasks.
- Live provider, handoff and tool output.
- Graphify relationship explorer and Obsidian note reader.
- Automatic local project provisioning with Git, documentation, Graphify and Obsidian.
- Machine and project integration inventory, including Hermes, ECC and MCP.

## Cost boundary

The router accepts ChatGPT/Codex and Claude subscription authentication. It refuses OpenAI and Anthropic API-key billing paths. Ollama, Graphify, Obsidian, Hermes, ECC and MCP itself are local/open-source components; a third-party service connected through MCP can still have its own cost.

## Start

```powershell
.\Open-Dashboard.ps1
```

The dashboard listens only on `http://127.0.0.1:8765`.

Runtime state is stored under `%LOCALAPPDATA%\AI Project Control`; task runs under `%USERPROFILE%\Documents\AI-Runs`; automatic worktrees under `%USERPROFILE%\Documents\AI-Worktrees`.

## Documentation

- `Docs/ARCHITECTURE.md`
- `Docs/PROVIDER_POLICY.md`
- `Docs/INTEGRATIONS.md`
- `Docs/OPERATIONS.md`
- `Docs/CONTEXT_BUDGET.md`

