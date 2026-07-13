[CmdletBinding()]
param([int]$Port = 8876)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $env:TEMP ("ai-project-control-smoke-{0}" -f [guid]::NewGuid().ToString('N'))
$repository = Join-Path $testRoot 'ExampleProject'
$obsidianPath = Join-Path $testRoot 'vault\10 Projects\ExampleProject'
$stdout = Join-Path $testRoot 'stdout.log'
$stderr = Join-Path $testRoot 'stderr.log'
$process = $null

function Invoke-JsonPost {
    param([string]$Path, [hashtable]$Body)
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port$Path" -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 8) -TimeoutSec 30
}

function Assert-Rejected {
    param([scriptblock]$Action, [string]$FailureMessage)
    try {
        & $Action | Out-Null
        throw $FailureMessage
    }
    catch {
        if ($_.Exception.Message -eq $FailureMessage) { throw }
    }
}

New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
    & node.exe --check (Join-Path $root 'server.js')
    if ($LASTEXITCODE -ne 0) { throw 'Server syntax validation failed.' }
    & node.exe --check (Join-Path $root 'public\app.js')
    if ($LASTEXITCODE -ne 0) { throw 'Client syntax validation failed.' }

    $env:AI_PROJECT_CONTROL_HOST = '127.0.0.1'
    $env:AI_PROJECT_CONTROL_PORT = [string]$Port
    $env:AI_PROJECT_CONTROL_DATA = (Join-Path $testRoot 'data')
    $env:AI_PROJECT_CONTROL_RUN_ROOT = (Join-Path $testRoot 'runs')
    $env:AI_PROJECT_CONTROL_WORKTREE_ROOT = (Join-Path $testRoot 'worktrees')
    $env:AI_PROJECT_CONTROL_OBSIDIAN_VAULT = (Join-Path $testRoot 'vault')
    $env:AI_PROJECT_CONTROL_ECC_ROOT = (Join-Path $testRoot 'missing-ecc')
    $env:AI_PROJECT_CONTROL_GRAPHIFY_PYTHON = (Join-Path $testRoot 'disabled-graphify.exe')
    $env:AI_PROJECT_CONTROL_SKIP_UPDATE_CHECKS = '1'

    $process = Start-Process node.exe -ArgumentList (Join-Path $root 'server.js') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $health = $null
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        Start-Sleep -Milliseconds 100
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
            if ($health.status -eq 'ok') { break }
        }
        catch {}
    }
    if ($null -eq $health -or $health.status -ne 'ok' -or $health.port -ne $Port) { throw 'Health endpoint did not become ready on the isolated port.' }

    New-Item -ItemType Directory -Force -Path $repository | Out-Null
    & git.exe -C $repository init -b main | Out-Null
    Set-Content -LiteralPath (Join-Path $repository 'README.md') -Value '# Test Repository' -Encoding utf8
    & git.exe -C $repository add README.md
    & git.exe -C $repository -c user.name='AI Project Control Test' -c user.email='test@localhost' commit -m 'Initialize test repository' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the test repository.' }

    $project = Invoke-JsonPost '/api/projects' @{
        name = 'ExampleProject'
        repository = $repository
        graphPath = (Join-Path $repository 'graphify-out\graph.json')
        obsidianPath = $obsidianPath
    }
    if ($project.name -ne 'ExampleProject' -or -not (Test-Path -LiteralPath $obsidianPath)) { throw 'Project registration or Obsidian initialization failed.' }
    if ((Get-ChildItem -LiteralPath $obsidianPath -Recurse -Filter '*.md').Count -lt 8) { throw 'The Obsidian working area is incomplete.' }

    $portfolio = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/portfolio?projectId=$($project.id)" -TimeoutSec 20
    if ($portfolio.project.id -ne $project.id -or -not ($portfolio.projects | Where-Object { $_.id -eq $project.id })) { throw 'Portfolio did not include and focus the active project.' }

    $inventory = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/systems?projectId=$($project.id)&force=1" -TimeoutSec 60
    $nodeSystem = $inventory.global | Where-Object { $_.name -eq 'Node.js' }
    if ($null -eq $nodeSystem -or $nodeSystem.tier -ne 'required' -or $null -eq $nodeSystem.updateStatus) { throw 'Catalog-backed system inventory is incomplete.' }
    $catalog = Get-Content -Raw -LiteralPath (Join-Path $root 'config\systems.json') | ConvertFrom-Json
    if ($catalog.schemaVersion -ne 3 -or $catalog.sources.Count -lt 4 -or $catalog.packages.Count -lt 10) { throw 'System catalog schema or source coupling is invalid.' }

    Assert-Rejected { Invoke-JsonPost '/api/systems/install' @{ projectId = $project.id; installKey = 'not-approved' } } 'Unknown installer was accepted.'
    Assert-Rejected { Invoke-JsonPost '/api/systems/update' @{ projectId = $project.id; updateKey = 'not-approved' } } 'Unknown updater was accepted.'
    Assert-Rejected { Invoke-JsonPost '/api/tasks' @{
        projectId = $project.id; task = 'Attachment validation'; provider = 'Ollama'; mode = 'ReadOnly'; useSubscriptionTokens = $false
        attachments = @(@{ name = 'unsafe.txt'; type = 'text/plain'; dataUrl = 'data:text/plain;base64,dGVzdA==' })
    } } 'Unsupported attachment type was accepted.'

    $clean = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git?projectId=$($project.id)" -TimeoutSec 15
    if (-not $clean.clean -or $clean.branch -ne 'main') { throw 'Git endpoint did not report the clean repository.' }
    Set-Content -LiteralPath (Join-Path $repository 'review-me.txt') -Value 'review only' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $repository 'other.txt') -Value 'must not appear' -Encoding utf8
    [System.IO.File]::WriteAllBytes((Join-Path $repository 'preview.png'), [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
    $fileDiff = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git/diff?projectId=$($project.id)&path=review-me.txt" -TimeoutSec 15
    if ($fileDiff.diff -notmatch 'review only' -or $fileDiff.diff -match 'must not appear') { throw 'File diff was not isolated to the selected file.' }
    $imageDiff = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git/diff?projectId=$($project.id)&path=preview.png" -TimeoutSec 15
    if (-not $imageDiff.binary -or -not $imageDiff.imageUrl) { throw 'Changed image did not expose a preview URL.' }
    $imageResponse = Invoke-WebRequest -Uri "http://127.0.0.1:$Port$($imageDiff.imageUrl)" -TimeoutSec 15
    if ($imageResponse.Headers.'Content-Type' -ne 'image/png' -or $imageResponse.RawContentLength -lt 60) { throw 'Image preview returned invalid content.' }

    Remove-Item -LiteralPath (Join-Path $repository 'review-me.txt'), (Join-Path $repository 'other.txt'), (Join-Path $repository 'preview.png') -Force
    $taskWorktree = Join-Path $testRoot 'task-worktree'
    & git.exe -C $repository worktree add -b ai/smoke-task $taskWorktree HEAD | Out-Null
    Set-Content -LiteralPath (Join-Path $taskWorktree 'task-change.txt') -Value 'task worktree change' -Encoding utf8
    & git.exe -C $taskWorktree add task-change.txt
    & git.exe -C $taskWorktree -c user.name='AI Project Control Test' -c user.email='test@localhost' commit -m 'Add task worktree change' | Out-Null
    $encodedWorktree = [uri]::EscapeDataString($taskWorktree)
    $ready = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git?projectId=$($project.id)&worktree=$encodedWorktree" -TimeoutSec 15
    if (-not $ready.integration.canFastForward -or $ready.integration.branch -ne 'main') { throw 'Task worktree was not ready for safe integration.' }
    $integrated = Invoke-JsonPost '/api/git/integrate' @{ projectId = $project.id; worktree = $taskWorktree }
    if ($integrated.state.branch -ne 'main' -or $integrated.deletedRemoteBranch -ne $false -or (Test-Path -LiteralPath $taskWorktree)) { throw 'Local integration or remote-branch preservation failed.' }

    $taskFile = Join-Path $testRoot 'task.md'
    Set-Content -LiteralPath $taskFile -Value "# Goal`n`nDry-run routing validation." -Encoding utf8
    $routerOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'router\Invoke-ProjectAiTask.ps1') -TaskFile $taskFile -WorkingDirectory $repository -ProjectName 'ExampleProject' -Provider Auto -Mode ReadOnly -RunRoot (Join-Path $testRoot 'router-runs') -LocalOnly -DryRun
    if ($LASTEXITCODE -ne 0 -or ($routerOutput -join "`n") -notmatch 'ollama') { throw 'Read-only local router dry-run failed.' }

    Write-Output 'AI_PROJECT_CONTROL_SMOKE_OK'
}
finally {
    if ($null -ne $process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
