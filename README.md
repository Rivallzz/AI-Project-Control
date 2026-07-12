# AI Project Control

AI Project Control is a local, multi-project workspace for running controlled tasks through Codex, Claude Code and Ollama while keeping project knowledge connected through Graphify and Obsidian.

## What it provides

- One chat-like task and feedback timeline per project.
- Provider routing: Codex, then Claude Code, then local Ollama.
- A visible switch that disables subscription-token use and forces local Ollama.
- Automatic isolated Git worktrees for write tasks.
- Live provider, handoff and tool output.
- Unified Graphify relationship explorer and automatically loaded Obsidian working notes.
- Controlled Git review, selected-file commits and explicit branch pushes without a repository editor.
- Automatic local project provisioning with Git, documentation, Graphify and Obsidian.
- Machine and project integration inventory, including Hermes, ECC and MCP.
- Dynamic machine inventory, project capability mapping and reviewed installers for missing local foundations.

## Cost boundary

The router accepts ChatGPT/Codex and Claude subscription authentication. It refuses OpenAI and Anthropic API-key billing paths. Ollama, Graphify, Obsidian, Hermes, ECC and MCP itself are local/open-source components; a third-party service connected through MCP can still have its own cost.

## Start

```powershell
.\Open-Dashboard.ps1
```

On a newly downloaded Windows setup, run `bootstrap.ps1` first. It checks the three foundations needed to launch and route work: Node.js LTS, Git and PowerShell 7.

The dashboard listens only on `http://127.0.0.1:8765`.

Runtime state is stored under `%LOCALAPPDATA%\AI Project Control`; task runs under `%USERPROFILE%\Documents\AI-Runs`; automatic worktrees under `%USERPROFILE%\Documents\AI-Worktrees`.

## Documentation

- `Docs/ARCHITECTURE.md`
- `Docs/PROVIDER_POLICY.md`
- `Docs/INTEGRATIONS.md`
- `Docs/OPERATIONS.md`
- `Docs/CONTEXT_BUDGET.md`
- `Docs/DESIGN_SYSTEM.md`
