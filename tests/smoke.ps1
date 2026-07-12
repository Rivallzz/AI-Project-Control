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

    $systemBody = @{ name = 'Example Tool'; type = 'Test'; path = $testRepository; scope = 'project'; projectId = $project.id } | ConvertTo-Json
    $system = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/systems" -ContentType 'application/json' -Body $systemBody -TimeoutSec 10
    if ($system.name -ne 'Example Tool') { throw 'System registration failed.' }

    Set-Content -LiteralPath $testTask -Value "# Goal`n`nDry-run routing validation." -Encoding utf8
    $router = Join-Path $root 'router\Invoke-ProjectAiTask.ps1'
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
