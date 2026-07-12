[CmdletBinding()]
param(
    [string]$Target = 'C:\Repos\AI-Project-Control',
    [string]$Vault = (Join-Path $env:USERPROFILE 'Documents\Obsidian\Project-Knowledge'),
    [bool]$RegisterPolis = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$source = Split-Path -Parent $PSScriptRoot
$targetPath = [System.IO.Path]::GetFullPath($Target)
if (Test-Path -LiteralPath $targetPath) { throw "Target already exists: $targetPath" }

New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
Get-ChildItem -Force -LiteralPath $source |
    Where-Object { $_.Name -notin @('.git', 'graphify-out', 'node_modules') } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $targetPath -Recurse }

& git.exe -C $targetPath init -b main | Out-Null
& git.exe -C $targetPath add .
& git.exe -C $targetPath commit -m 'Initial AI Project Control setup' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Initial Git commit failed.' }

$obsidianPath = Join-Path $Vault '10 Projects\AI Project Control'
foreach ($directory in @('Working Notes', 'Research', 'Design Drafts', 'Review Notes', 'Prompt Library', 'Lessons Learned', 'AI Runs')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $obsidianPath $directory) | Out-Null
}
$dashboard = @"
---
title: AI Project Control Dashboard
tags:
  - project
  - active
---

# AI Project Control Dashboard

> [!important] Source of truth
> Official documentation is stored in the AI Project Control Git repository. This Obsidian area is working knowledge.

- Repository: $targetPath
- Agent rules: $(Join-Path $targetPath 'AGENTS.md')
- Current task: $(Join-Path $targetPath 'Docs\CURRENT_TASK.md')
- Architecture: $(Join-Path $targetPath 'Docs\ARCHITECTURE.md')
- Graphify: $(Join-Path $targetPath 'graphify-out\graph.json')
"@
$dashboard | Set-Content -LiteralPath (Join-Path $obsidianPath 'AI Project Control Dashboard.md') -Encoding utf8

$dataRoot = Join-Path $env:LOCALAPPDATA 'AI Project Control'
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
$projectsPath = Join-Path $dataRoot 'projects.json'
if (Test-Path -LiteralPath $projectsPath) {
    Copy-Item -LiteralPath $projectsPath -Destination "$projectsPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
}
$projects = @(
    [ordered]@{
        id = 'ai-project-control'
        name = 'AI Project Control'
        repository = $targetPath
        graphPath = (Join-Path $targetPath 'graphify-out\graph.json')
        obsidianPath = $obsidianPath
    }
)
$polisPath = 'C:\Repos\Polis'
if ($RegisterPolis -and (Test-Path -LiteralPath $polisPath)) {
    $projects += [ordered]@{
        id = 'polis'
        name = 'Polis'
        repository = $polisPath
        graphPath = (Join-Path $polisPath 'graphify-out\graph.json')
        obsidianPath = (Join-Path $Vault '10 Projects\Polis')
    }
}
[ordered]@{
    activeProjectId = if ($projects.id -contains 'polis') { 'polis' } else { 'ai-project-control' }
    projects = $projects
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $projectsPath -Encoding utf8

Write-Output "AI_PROJECT_CONTROL_INSTALLED target=$targetPath data=$dataRoot obsidian=$obsidianPath"

