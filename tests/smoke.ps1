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
    if (-not ($portfolio.projects | Where-Object { $_.id -eq $project.id })) { throw 'Portfolio did not include the registered project.' }

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
    if ($appSource -notmatch '\[\.\.\.runs\]\.reverse\(\)') { throw 'Conversation history is not rendered oldest-first.' }
    if ($appSource -notmatch "addEventListener\('paste'" -or $appSource -match 'data-open-run') { throw 'Chat paste support or simplified conversation actions are incorrect.' }

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
    $ignoreSource = Get-Content -Raw -LiteralPath (Join-Path $root '.gitignore')
    if ($ignoreSource -match '(?m)^systems\.json$') { throw 'The versioned system catalog is hidden by an overly broad ignore rule.' }

    $gitState = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git?projectId=$($project.id)" -TimeoutSec 10
    if ($gitState.branch -ne 'main' -or -not $gitState.clean) { throw 'Git review endpoint did not report the clean test repository.' }
    Set-Content -LiteralPath (Join-Path $testRepository 'review-me.txt') -Value 'review only' -Encoding utf8
    $dirtyGitState = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/git?projectId=$($project.id)" -TimeoutSec 10
    if ($dirtyGitState.clean -or -not ($dirtyGitState.files | Where-Object { $_.path -eq 'review-me.txt' })) { throw 'Git review endpoint did not expose the changed file.' }

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
    if ($routerSource -notmatch 'StandardInputEncoding\s*=\s*\$utf8') { throw 'Router does not explicitly enforce UTF-8 stdin.' }
    if ($routerSource -notmatch '\[Console\]::OutputEncoding\s*=\s*\$consoleUtf8') { throw 'Router does not explicitly enforce UTF-8 console output.' }
    if ($routerSource -notmatch 'Read-only context policy') { throw 'Router does not define the lightweight advisory context policy.' }
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
