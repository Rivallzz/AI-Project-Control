[CmdletBinding()]
param([int]$Port = 8876)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dataRoot = Join-Path $env:TEMP ("ai-project-control-test-{0}" -f [guid]::NewGuid().ToString('N'))
$stdout = Join-Path $dataRoot 'stdout.log'
$stderr = Join-Path $dataRoot 'stderr.log'
$testRepository = Join-Path $dataRoot 'ExampleProject'
$testObsidian = Join-Path $dataRoot 'vault\10 Projects\ExampleProject'
$testTask = Join-Path $dataRoot 'task.md'
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
$process = $null
$health = $null

try {
    & node.exe --check (Join-Path $root 'server.js')
    & node.exe --check (Join-Path $root 'public\app.js')
    $env:AI_PROJECT_CONTROL_PORT = [string]$Port
    $env:AI_PROJECT_CONTROL_DATA = $dataRoot
    $env:AI_PROJECT_CONTROL_RUN_ROOT = (Join-Path $dataRoot 'runs')
    $env:AI_PROJECT_CONTROL_WORKTREE_ROOT = (Join-Path $dataRoot 'worktrees')
    $env:AI_PROJECT_CONTROL_OBSIDIAN_VAULT = (Join-Path $dataRoot 'vault')
    $process = Start-Process node.exe -ArgumentList (Join-Path $root 'server.js') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
            if ($health.status -eq 'ok') { break }
        }
        catch {}
    }
    if ($null -eq $health -or $health.status -ne 'ok') { throw 'Health endpoint did not become ready.' }
    $projects = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/projects" -TimeoutSec 5
    if ($projects.projects.Count -lt 1) { throw 'No default project was returned.' }
    $config = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/config" -TimeoutSec 5
    if ($config.dataRoot -ne $dataRoot) { throw 'Runtime data did not use the isolated test directory.' }

    New-Item -ItemType Directory -Force -Path $testRepository | Out-Null
    & git.exe -C $testRepository init -b main | Out-Null
    Set-Content -LiteralPath (Join-Path $testRepository 'README.md') -Value '# Test Repository' -Encoding utf8
    & git.exe -C $testRepository add README.md
    & git.exe -C $testRepository -c user.name='AI Project Control Test' -c user.email='test@localhost' commit -m 'Initialize test repository' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create initial test commit.' }
    $projectBody = @{
        name = 'ExampleProject'
        repository = $testRepository
        graphPath = (Join-Path $testRepository 'graphify-out\graph.json')
        obsidianPath = $testObsidian
    } | ConvertTo-Json
    $project = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/projects" -ContentType 'application/json' -Body $projectBody -TimeoutSec 10
    if ($project.name -ne 'ExampleProject' -or -not (Test-Path -LiteralPath $testObsidian)) { throw 'Project registration or Obsidian integration failed.' }
    $obsidianNotes = Get-ChildItem -LiteralPath $testObsidian -Recurse -Filter '*.md'
    if ($obsidianNotes.Count -lt 8) { throw 'Obsidian working area was not initialized with useful indexes.' }

    $portfolio = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/portfolio" -TimeoutSec 20
    if ($portfolio.project.id -ne $project.id -or $null -eq $portfolio.project.obsidian) { throw 'Portfolio did not focus the active project.' }

    $badAttachmentBody = @{
        projectId = $project.id
        task = 'Attachment validation only'
        provider = 'Ollama'
        mode = 'ReadOnly'
        useSubscriptionTokens = $false
        attachments = @(@{ name = 'unsafe.txt'; type = 'text/plain'; dataUrl = 'data:text/plain;base64,dGVzdA==' })
    } | ConvertTo-Json -Depth 5
    try {
        Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/tasks" -ContentType 'application/json' -Body $badAttachmentBody -TimeoutSec 10 | Out-Null
        throw 'Unsupported attachment type was accepted.'
    }
    catch {
        if ($_.Exception.Message -eq 'Unsupported attachment type was accepted.') { throw }
    }

    $indexSource = Get-Content -Raw -LiteralPath (Join-Path $root 'public\index.html')
    $appSource = Get-Content -Raw -LiteralPath (Join-Path $root 'public\app.js')
    if ($indexSource -notmatch 'attachmentInput' -or $indexSource -notmatch 'data-view="portfolio"' -or $indexSource -notmatch 'busyOverlay') { throw 'Responsive chat, portfolio or loading controls are missing.' }
    if ($indexSource -notmatch 'data-view="git"' -or $indexSource -notmatch 'knowledgeSearch' -or $indexSource -match 'Notizen laden') { throw 'Git review or automatic unified knowledge controls are missing.' }
    if ($indexSource -match 'data-view="projects"' -or $indexSource -match 'graphZoomIn') { throw 'Redundant project navigation or graph zoom buttons are still present.' }
    if ($appSource -notmatch '\[\.\.\.runs\]\.reverse\(\)') { throw 'Conversation history is not rendered oldest-first.' }
    if ($appSource -notmatch "addEventListener\('paste'" -or $appSource -match 'data-open-run') { throw 'Chat paste support or simplified conversation actions are incorrect.' }
    if ($indexSource -notmatch 'class="provider-overview"' -or $indexSource -notmatch 'id="backgroundActivity"') { throw 'Compact provider header or background task activity is missing.' }
    if ($indexSource -notmatch 'id="workflowContext"' -or $appSource -notmatch 'function renderJobActivity' -or $appSource -notmatch 'needsCodeTools') { throw 'Project-specific workflow filtering is missing.' }
    if ($indexSource -notmatch 'id="globalTrackerList"' -or $appSource -notmatch 'function renderGlobalTracker' -or $appSource -notmatch 'data-tracker-project') { throw 'Global cross-project task tracker is missing.' }
    if ($appSource -match "componentRow\('ECC'" -or $appSource -match "componentRow\('Hermes'" ) { throw 'Workflow sidebar still renders unrelated global inventory rows.' }
    if ($indexSource -notmatch 'id="gitTargetSelect"' -or $appSource -notmatch 'worktree=\$\{encodeURIComponent\(gitData\.worktree\)\}') { throw 'Git review is not connected to selectable task worktrees.' }
    if ($indexSource -notmatch 'id="gitIntegrateButton"' -or $indexSource -notmatch 'id="gitBranchFlow"' -or $appSource -notmatch '/api/git/integrate') { throw 'Task-to-integration-branch promotion controls are missing.' }

    $systemBody = @{ name = 'Example Tool'; type = 'Test'; path = $testRepository; scope = 'project'; projectId = $project.id } | ConvertTo-Json
    $system = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/systems" -ContentType 'application/json' -Body $systemBody -TimeoutSec 10
    if ($system.name -ne 'Example Tool') { throw 'System registration failed.' }

    $inventory = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/systems?projectId=$($project.id)" -TimeoutSec 30
    $nodeSystem = $inventory.global | Where-Object { $_.name -eq 'Node.js' }
    if ($null -eq $nodeSystem -or $nodeSystem.tier -ne 'required') { throw 'System inventory does not classify required foundations.' }
    $serverSource = Get-Content -Raw -LiteralPath (Join-Path $root 'server.js')
    if ($serverSource -match 'SYSTEM_METADATA|INSTALL_CATALOG') { throw 'System definitions are still hardcoded in server.js.' }
    $catalog = Get-Content -Raw -LiteralPath (Join-Path $root 'config\systems.json') | ConvertFrom-Json
    if ($catalog.schemaVersion -ne 1 -or $catalog.systems.Count -lt 10) { throw 'Versioned system catalog is invalid.' }
    $serenaSystem = $catalog.systems | Where-Object { $_.id -eq 'serena' }
    $continuesSystem = $catalog.systems | Where-Object { $_.id -eq 'cli-continues' }
    if ($null -eq $serenaSystem -or -not $serenaSystem.workflowRole -or -not $serenaSystem.activation) { throw 'Serena integration metadata is missing.' }
    if ($null -eq $continuesSystem -or -not $continuesSystem.workflowRole -or -not $continuesSystem.costPolicy) { throw 'cli-continues integration metadata is missing.' }
    $ignoreSource = Get-Content -Raw -LiteralPath (Join-Path $root '.gitignore')
    if ($ignoreSource -match '(?m)^systems\.json$') { throw 'The versioned system catalog is hidden by an overly broad ignore rule.' }

    $gitState = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git?projectId=$($project.id)" -TimeoutSec 10
    if ($gitState.branch -ne 'main' -or -not $gitState.clean) { throw 'Git review endpoint did not report the clean test repository.' }
    Set-Content -LiteralPath (Join-Path $testRepository 'review-me.txt') -Value 'review only' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $testRepository 'other.txt') -Value 'must not appear' -Encoding utf8
    $dirtyGitState = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git?projectId=$($project.id)" -TimeoutSec 10
    if ($dirtyGitState.clean -or -not ($dirtyGitState.files | Where-Object { $_.path -eq 'review-me.txt' })) { throw 'Git review endpoint did not expose the changed file.' }
    if ($dirtyGitState.PSObject.Properties.Name -contains 'diff') { throw 'Git status endpoint still exposes a combined repository diff.' }
    $fileDiff = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git/diff?projectId=$($project.id)&path=review-me.txt" -TimeoutSec 10
    if ($fileDiff.diff -notmatch 'review only' -or $fileDiff.diff -match 'must not appear') { throw 'Git file diff did not isolate the requested file.' }
    $reviewWorktree = Join-Path $dataRoot 'review-worktree'
    $worktreeErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & git -C $testRepository worktree add -b ai/dashboard-review-test $reviewWorktree HEAD 2>$null | Out-Null
    $worktreeExitCode = $LASTEXITCODE
    $ErrorActionPreference = $worktreeErrorAction
    if ($worktreeExitCode -ne 0) { throw 'Could not create test worktree.' }
    Set-Content -LiteralPath (Join-Path $reviewWorktree 'task-change.txt') -Value 'task worktree change' -Encoding utf8
    $worktreeGitState = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git?projectId=$($project.id)" -TimeoutSec 10
    if ($worktreeGitState.branch -ne 'ai/dashboard-review-test' -or $worktreeGitState.mainCheckout -or $worktreeGitState.worktree -ne $reviewWorktree) { throw 'Git review did not prioritize the changed task worktree.' }
    if ($worktreeGitState.targets.Count -lt 2 -or -not ($worktreeGitState.files | Where-Object { $_.path -eq 'task-change.txt' })) { throw 'Git review did not expose all worktrees or the task change.' }
    $encodedWorktree = [uri]::EscapeDataString($reviewWorktree)
    $worktreeDiff = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git/diff?projectId=$($project.id)&worktree=$encodedWorktree&path=task-change.txt" -TimeoutSec 10
    if ($worktreeDiff.diff -notmatch 'task worktree change') { throw 'Git worktree file diff did not use the selected task worktree.' }
    Remove-Item -LiteralPath (Join-Path $testRepository 'review-me.txt'), (Join-Path $testRepository 'other.txt') -Force
    & git.exe -C $reviewWorktree add task-change.txt
    & git.exe -C $reviewWorktree -c user.name='AI Project Control Test' -c user.email='test@localhost' commit -m 'Add task worktree change' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not commit the test worktree change.' }
    $readyToIntegrate = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git?projectId=$($project.id)&worktree=$encodedWorktree" -TimeoutSec 10
    if ($readyToIntegrate.integration.branch -ne 'main' -or -not $readyToIntegrate.integration.canFastForward) { throw 'Clean task branch was not approved for a safe integration-branch fast-forward.' }
    $integrateBody = @{ projectId = $project.id; worktree = $reviewWorktree } | ConvertTo-Json
    $integrated = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/git/integrate" -ContentType 'application/json' -Body $integrateBody -TimeoutSec 15
    if ($integrated.state.branch -ne 'main' -or $integrated.state.lastCommit.subject -ne 'Add task worktree change') { throw 'Task branch was not fast-forwarded into the integration branch.' }
    if ($appSource -notmatch "addEventListener\('wheel'" -or $appSource -notmatch "addEventListener\('pointermove'") { throw 'Graph mouse zoom or pan controls are missing.' }

    $invalidInstallerBody = @{ projectId = $project.id; installKey = 'not-approved' } | ConvertTo-Json
    try {
        Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/systems/install" -ContentType 'application/json' -Body $invalidInstallerBody -TimeoutSec 10 | Out-Null
        throw 'Unknown installer was accepted.'
    }
    catch {
        if ($_.Exception.Message -eq 'Unknown installer was accepted.') { throw }
    }

    Set-Content -LiteralPath $testTask -Value "# Goal`n`nPrüfe UTF-8: äöü ß → Dry-run routing validation." -Encoding utf8
    $router = Join-Path $root 'router\Invoke-ProjectAiTask.ps1'
    $routerSource = Get-Content -Raw -LiteralPath $router
    if ($routerSource -notmatch 'StandardInputEncoding.*\$utf8') { throw 'Router does not explicitly enforce UTF-8 stdin when the runtime supports it.' }
    if ($routerSource -notmatch '\[Console\]::OutputEncoding\s*=\s*\$consoleUtf8') { throw 'Router does not explicitly enforce UTF-8 console output.' }
    if ($routerSource -notmatch 'Read-only context policy') { throw 'Router does not define the lightweight advisory context policy.' }
    if ($routerSource -notmatch 'New-ContinuesHandoffArtifact') { throw 'Router does not create controlled cli-continues handoff artifacts.' }
    if ($routerSource -notmatch '\[AllowEmptyString\(\)\]\[string\]\$InputText') { throw 'Router does not accept empty stdin for non-interactive Hermes execution.' }
    if ($routerSource -notmatch 'Execute this controlled \$Mode task now') { throw 'Hermes does not receive the compact controlled goal prompt.' }
    if ($routerSource -notmatch 'safe Windows command-line budget') { throw 'Hermes prompt size is not guarded for Windows.' }
    if ($routerSource -notmatch 'mcp__serena__initial_instructions') { throw 'Hermes does not receive the native Serena MCP tool name.' }
    if ($routerSource -notmatch 'worktree add --detach' -or $routerSource -notmatch 'local-hermes-write-not-approved') { throw 'Local Hermes read-only isolation or write-task block is missing.' }
    if ($routerSource -notmatch "'chat', '-q'" -or $routerSource -match "@\('-z'") { throw 'Hermes still hides live tool progress in one-shot mode.' }
    if ($routerSource -match "'--ephemeral'" -or $routerSource -match "'--no-session-persistence'") { throw 'Provider sessions are still disabled, so cli-continues cannot hand work off.' }
    if ($routerSource -notmatch 'Serena') { throw 'Router does not describe the Serena symbol-navigation boundary.' }
    if ($appSource -notmatch 'system\.workflowRole' -or $appSource -notmatch 'Hermes \+ Ollama') { throw 'System integration metadata or Hermes orchestration label is missing from the UI.' }
    $routerOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $router -TaskFile $testTask -WorkingDirectory $testRepository -ProjectName 'ExampleProject' -Provider Auto -Mode ReadOnly -RunRoot (Join-Path $dataRoot 'router-runs') -LocalOnly -DryRun
    if ($LASTEXITCODE -ne 0 -or ($routerOutput -join "`n") -notmatch 'ollama') { throw 'Local-only provider routing dry-run failed.' }

    Set-Content -LiteralPath (Join-Path $testRepository 'dirty.txt') -Value 'dirty' -Encoding utf8
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $null = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $router -TaskFile $testTask -WorkingDirectory $testRepository -ProjectName 'ExampleProject' -Provider Auto -Mode Write -RunRoot (Join-Path $dataRoot 'router-runs-dirty') -LocalOnly -DryRun 2>$null
    $ErrorActionPreference = $previousErrorAction
    if ($LASTEXITCODE -eq 0) { throw 'Dirty write-worktree guard did not reject the repository.' }

    Write-Output 'AI_PROJECT_CONTROL_SMOKE_OK'
}
finally {
    if ($null -ne $process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    if (Test-Path -LiteralPath $dataRoot) { Remove-Item -LiteralPath $dataRoot -Recurse -Force }
}
