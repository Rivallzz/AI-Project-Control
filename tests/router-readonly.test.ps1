[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Equal {
    param([object]$Actual, [object]$Expected, [string]$Message)
    if ($Actual -ne $Expected) { throw "$Message Expected '$Expected', got '$Actual'." }
}

function Invoke-TestPowerShell {
    param([Parameter(Mandatory)][string]$ScriptPath, [Parameter(Mandatory)][string[]]$Arguments)

    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = (& $script:PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1 | Out-String)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

function Read-MockRecord {
    param([Parameter(Mandatory)][string]$Path)

    $record = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $parts = $line.Split(@('='), 2)
        if ($parts.Count -eq 2) { $record[$parts[0]] = $parts[1] }
    }
    return $record
}

function Assert-DisposableCheckoutCleaned {
    param(
        [Parameter(Mandatory)][string]$RepositoryPath,
        [Parameter(Mandatory)][hashtable]$Record,
        [Parameter(Mandatory)][string]$Message
    )

    Assert-True ($Record.ContainsKey('cwd')) "$Message Provider invocation was not recorded."
    Assert-True (-not (Test-Path -LiteralPath $Record.cwd)) "$Message Disposable checkout directory remains on disk."
    $worktreeList = (& git -C $RepositoryPath worktree list --porcelain | Out-String)
    Assert-True ($worktreeList -notmatch [regex]::Escape($Record.cwd)) "$Message Disposable checkout remains registered with Git."
}

$root = Split-Path -Parent $PSScriptRoot
$router = Join-Path $root 'router\Invoke-ProjectAiTask.ps1'
$statusScript = Join-Path $root 'router\Get-AiProviderStatus.ps1'
$script:PowerShellExe = (Get-Command pwsh.exe -ErrorAction Stop).Source
$testRoot = Join-Path $env:TEMP ("ai-project-control-router-test-{0}" -f [guid]::NewGuid().ToString('N'))
$shimRoot = Join-Path $testRoot 'bin'
$repository = Join-Path $testRoot 'repository'
$taskFile = Join-Path $testRoot 'task.md'
$codexHome = Join-Path $testRoot 'codex-home'
$statePath = Join-Path $testRoot 'provider-state.json'
$oldPath = $env:PATH
$oldOpenAiKey = $env:OPENAI_API_KEY
$oldAnthropicKey = $env:ANTHROPIC_API_KEY
$oldAnthropicBaseUrl = $env:ANTHROPIC_BASE_URL
$oldMockBehavior = $env:AI_ROUTER_MOCK_BEHAVIOR
$oldMockRecord = $env:AI_ROUTER_MOCK_RECORD

try {
    New-Item -ItemType Directory -Force -Path $shimRoot, $repository, $codexHome | Out-Null
    $shimSource = @'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$provider = [string]$args[0]
$providerArguments = @($args | Select-Object -Skip 1)
if ($provider -eq 'codex' -and $providerArguments.Count -ge 2 -and $providerArguments[0] -eq 'login') {
    Write-Output 'Logged in using ChatGPT'
    exit 0
}
if ($provider -eq 'claude' -and $providerArguments.Count -ge 2 -and $providerArguments[0] -eq 'auth') {
    Write-Output '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro"}'
    exit 0
}
if ($provider -eq 'ollama' -and $providerArguments.Count -ge 1 -and $providerArguments[0] -eq 'list') {
    Write-Output 'NAME                 ID              SIZE      MODIFIED'
    Write-Output 'polis-coder:latest   111111111111    1 GB      now'
    Write-Output 'custom-model:7b      222222222222    2 GB      now'
    Write-Output 'looks-chat-embed:latest 333333333333 2 GB      now'
    Write-Output 'semantic-vector:latest  444444444444 1 GB      now'
    exit 0
}
if ($provider -eq 'ollama' -and $providerArguments.Count -ge 2 -and $providerArguments[0] -eq 'show') {
    Write-Output '  Model'
    Write-Output '    context length      32768'
    Write-Output ''
    Write-Output '  Capabilities'
    if ($providerArguments[1] -eq 'semantic-vector:latest') {
        Write-Output '    embedding'
    }
    else {
        Write-Output '    completion'
        Write-Output '    tools'
    }
    Write-Output ''
    Write-Output '  Parameters'
    exit 0
}

[Console]::In.ReadToEnd() | Out-Null
$cwd = (Get-Location).Path
$trackedPath = Join-Path $cwd 'tracked.txt'
$untrackedPath = Join-Path $cwd 'untracked.txt'
if ($env:AI_ROUTER_MOCK_RECORD) {
    $recordedArguments = ($providerArguments -join '|') -replace '\r?\n', '<NL>'
    $record = @(
        "provider=$provider"
        "cwd=$cwd"
        "tracked=$(if (Test-Path -LiteralPath $trackedPath) { (Get-Content -LiteralPath $trackedPath -Raw).Trim() } else { '<missing>' })"
        "untracked=$(if (Test-Path -LiteralPath $untrackedPath) { (Get-Content -LiteralPath $untrackedPath -Raw).Trim() } else { '<missing>' })"
        "arguments=$recordedArguments"
    )
    [System.IO.File]::WriteAllLines($env:AI_ROUTER_MOCK_RECORD, $record, [System.Text.UTF8Encoding]::new($false))
}

if ($env:AI_ROUTER_MOCK_BEHAVIOR -eq 'mutate-blocked') {
    [System.IO.File]::WriteAllText($trackedPath, 'dirty-after', [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($untrackedPath, 'untracked-after', [System.Text.UTF8Encoding]::new($false))
    Write-Output 'AI_PROJECT_TASK_BLOCKED: deliberate test blocker'
    exit 0
}
if ($env:AI_ROUTER_MOCK_BEHAVIOR -eq 'fail') {
    [Console]::Error.WriteLine('provider failed deliberately')
    exit 7
}

if ($provider -eq 'hermes') {
    Write-Output 'Initializing agent'
    [Console]::Out.WriteLine(([char]0x2695).ToString() + ' Hermes')
}
Write-Output 'AI_PROJECT_TASK_COMPLETE'
exit 0
'@
    [System.IO.File]::WriteAllText((Join-Path $shimRoot 'provider-shim.ps1'), $shimSource, [System.Text.UTF8Encoding]::new($false))
    foreach ($providerName in @('codex', 'claude', 'ollama', 'hermes')) {
        $wrapper = "@echo off`r`npwsh.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0provider-shim.ps1`" $providerName %*`r`nexit /b %ERRORLEVEL%`r`n"
        [System.IO.File]::WriteAllText((Join-Path $shimRoot "$providerName.cmd"), $wrapper, [System.Text.Encoding]::ASCII)
    }
    $env:PATH = "$shimRoot;$oldPath"
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue

    & git -C $repository init -b main | Out-Null
    Set-Content -LiteralPath (Join-Path $repository 'tracked.txt') -Value 'committed' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $repository 'AGENTS.md') -Value '# Test instructions' -Encoding utf8
    & git -C $repository add tracked.txt AGENTS.md
    & git -C $repository -c user.name='Router Test' -c user.email='router@test.invalid' commit -m 'Initialize router test repository' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the router test repository.' }
    Set-Content -LiteralPath (Join-Path $repository 'tracked.txt') -Value 'dirty-before' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $repository 'untracked.txt') -Value 'untracked-before' -Encoding utf8
    Set-Content -LiteralPath $taskFile -Value "# Task`n`n## Goal`nVerify read-only isolation." -Encoding utf8

    $env:OPENAI_API_KEY = 'blocked-test-key'
    $statusResult = Invoke-TestPowerShell -ScriptPath $statusScript -Arguments @(
        '-Json', '-CodexHome', $codexHome, '-StatePath', $statePath, '-OllamaModel', 'custom-model:7b'
    )
    Assert-Equal $statusResult.ExitCode 0 'Provider status failed.'
    $status = $statusResult.Output | ConvertFrom-Json
    Assert-True (-not [bool]$status.codex.available) 'OPENAI_API_KEY did not make Codex unavailable.'
    Assert-Equal $status.codex.paid_api_guard 'BLOCKED' 'OPENAI_API_KEY guard status is inconsistent.'
    Assert-True ([bool]$status.ollama.available) 'The selected installed Ollama model was not accepted.'
    Assert-Equal $status.ollama.model 'custom-model:7b' 'Provider status did not preserve the selected Ollama model.'
    Assert-True ([bool]$status.ollama.hermes_available) 'The local provider did not require the Hermes command.'
    Assert-True (@($status.ollama.installed_chat_models) -contains 'looks-chat-embed:latest') 'A completion model was excluded because its name contained embed.'
    Assert-True (@($status.ollama.installed_chat_models) -notcontains 'semantic-vector:latest') 'A non-completion model was accepted because its name did not contain embed.'

    $defaultModelResult = Invoke-TestPowerShell -ScriptPath $statusScript -Arguments @(
        '-Json', '-CodexHome', $codexHome, '-StatePath', $statePath, '-OllamaModel', 'default'
    )
    Assert-Equal $defaultModelResult.ExitCode 0 'Provider status failed for the legacy default model.'
    $defaultModelStatus = $defaultModelResult.Output | ConvertFrom-Json
    Assert-True ([bool]$defaultModelStatus.ollama.available) 'The deterministic default Ollama model was not available.'
    Assert-Equal $defaultModelStatus.ollama.model 'custom-model:7b' 'Legacy default did not resolve to the alphabetically first installed chat model.'

    $missingModelResult = Invoke-TestPowerShell -ScriptPath $statusScript -Arguments @(
        '-Json', '-CodexHome', $codexHome, '-StatePath', $statePath, '-OllamaModel', 'missing-model'
    )
    Assert-Equal $missingModelResult.ExitCode 0 'Provider status failed for a missing Ollama model.'
    $missingModelStatus = $missingModelResult.Output | ConvertFrom-Json
    Assert-True (-not [bool]$missingModelStatus.ollama.available) 'A missing selected Ollama model was reported as available.'
    Assert-True ([string]$missingModelStatus.ollama.reason -match 'missing-model') 'Missing-model status did not name the selected model.'
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue

    $unavailableResult = Invoke-TestPowerShell -ScriptPath $router -Arguments @(
        '-TaskFile', $taskFile, '-WorkingDirectory', $repository, '-Provider', 'Ollama',
        '-OllamaModel', 'missing-model', '-Mode', 'ReadOnly',
        '-RunRoot', (Join-Path $testRoot 'runs-unavailable'), '-ProjectName', 'RouterTest'
    )
    Assert-True ($unavailableResult.ExitCode -ne 0) 'A provider with a missing requested model unexpectedly started.'
    Assert-True ($unavailableResult.Output -match 'ollama.+missing-model') 'Unavailable-provider output did not identify Ollama and the missing requested model.'

    $claudeRecordPath = Join-Path $testRoot 'claude-record.txt'
    $env:AI_ROUTER_MOCK_RECORD = $claudeRecordPath
    $env:AI_ROUTER_MOCK_BEHAVIOR = 'complete'
    $claudeRunRoot = Join-Path $testRoot 'runs-claude'
    $claudeResult = Invoke-TestPowerShell -ScriptPath $router -Arguments @(
        '-TaskFile', $taskFile, '-WorkingDirectory', $repository, '-Provider', 'Claude',
        '-ClaudeModel', 'sonnet', '-Mode', 'ReadOnly', '-RunRoot', $claudeRunRoot, '-ProjectName', 'RouterTest'
    )
    Assert-Equal $claudeResult.ExitCode 0 "Claude read-only execution failed. Output: $($claudeResult.Output)"
    Assert-True ($claudeResult.Output -match 'AI_PROJECT_ROUTER_OK provider=claude') 'Claude did not complete through the router.'
    Assert-True ($claudeResult.Output -match 'AI_EVENT provider=claude state=started attempt=1 model=sonnet') 'Claude start event did not expose the selected model.'
    $claudeRecord = Read-MockRecord -Path $claudeRecordPath
    Assert-True ($claudeRecord.arguments -match [regex]::Escape('--model|sonnet')) 'Claude did not receive the selected model argument.'
    Assert-True (-not $claudeRecord.cwd.Equals($repository, [System.StringComparison]::OrdinalIgnoreCase)) 'Claude ran in the canonical checkout.'
    Assert-Equal $claudeRecord.tracked 'dirty-before' 'Claude checkout did not receive dirty tracked content.'
    Assert-Equal $claudeRecord.untracked 'untracked-before' 'Claude checkout did not receive untracked content.'
    Assert-DisposableCheckoutCleaned -RepositoryPath $repository -Record $claudeRecord -Message 'Claude cleanup:'
    $claudeRun = Get-ChildItem -LiteralPath $claudeRunRoot -Directory | Select-Object -First 1
    $claudeRoutingResult = Get-Content -LiteralPath (Join-Path $claudeRun.FullName 'routing-result.json') -Raw | ConvertFrom-Json
    Assert-Equal $claudeRoutingResult.selected_model 'sonnet' 'Claude routing result did not persist the selected model.'
    Assert-Equal $claudeRoutingResult.attempts[0].model 'sonnet' 'Claude attempt did not persist the selected model.'

    $ollamaRecordPath = Join-Path $testRoot 'ollama-record.txt'
    $env:AI_ROUTER_MOCK_RECORD = $ollamaRecordPath
    $env:AI_ROUTER_MOCK_BEHAVIOR = 'complete'
    $ollamaRunRoot = Join-Path $testRoot 'runs-ollama'
    $ollamaResult = Invoke-TestPowerShell -ScriptPath $router -Arguments @(
        '-TaskFile', $taskFile, '-WorkingDirectory', $repository, '-Provider', 'Ollama',
        '-OllamaModel', 'custom-model:7b', '-Mode', 'ReadOnly', '-RunRoot', $ollamaRunRoot, '-ProjectName', 'RouterTest'
    )
    Assert-Equal $ollamaResult.ExitCode 0 "Hermes/Ollama read-only execution failed. Output: $($ollamaResult.Output)"
    Assert-True ($ollamaResult.Output -match 'AI_PROJECT_ROUTER_OK provider=ollama') 'Hermes/Ollama did not complete through the router.'
    Assert-True ($ollamaResult.Output -match 'AI_EVENT provider=ollama state=started attempt=1 model=custom-model:7b') 'Hermes/Ollama start event did not expose the selected model.'
    $ollamaRecord = Read-MockRecord -Path $ollamaRecordPath
    Assert-Equal $ollamaRecord.provider 'hermes' 'The local provider did not execute through Hermes.'
    Assert-True ($ollamaRecord.arguments -match [regex]::Escape('-m|custom-model:7b')) "Hermes did not receive the selected Ollama model argument. Arguments: $($ollamaRecord.arguments)"
    Assert-True (-not $ollamaRecord.cwd.Equals($repository, [System.StringComparison]::OrdinalIgnoreCase)) 'Hermes/Ollama ran in the canonical checkout.'
    Assert-DisposableCheckoutCleaned -RepositoryPath $repository -Record $ollamaRecord -Message 'Hermes/Ollama cleanup:'
    $ollamaRun = Get-ChildItem -LiteralPath $ollamaRunRoot -Directory | Select-Object -First 1
    $ollamaRoutingResult = Get-Content -LiteralPath (Join-Path $ollamaRun.FullName 'routing-result.json') -Raw | ConvertFrom-Json
    Assert-Equal $ollamaRoutingResult.selected_model 'custom-model:7b' 'Hermes/Ollama routing result did not persist the selected model.'
    Assert-Equal $ollamaRoutingResult.attempts[0].model 'custom-model:7b' 'Hermes/Ollama attempt did not persist the selected model.'

    $codexRecordPath = Join-Path $testRoot 'codex-record.txt'
    $env:AI_ROUTER_MOCK_RECORD = $codexRecordPath
    $env:AI_ROUTER_MOCK_BEHAVIOR = 'mutate-blocked'
    $codexRunRoot = Join-Path $testRoot 'runs-codex-violation'
    $codexResult = Invoke-TestPowerShell -ScriptPath $router -Arguments @(
        '-TaskFile', $taskFile, '-WorkingDirectory', $repository, '-Provider', 'Codex',
        '-Mode', 'ReadOnly', '-RunRoot', $codexRunRoot, '-ProjectName', 'RouterTest'
    )
    Assert-True ($codexResult.ExitCode -ne 0 -and $codexResult.ExitCode -ne 2) 'A read-only violation incorrectly finished as controlled BLOCKED.'
    Assert-True ($codexResult.Output -notmatch 'AI_PROJECT_ROUTER_BLOCKED') 'The router emitted BLOCKED after a read-only violation.'
    $codexRecord = Read-MockRecord -Path $codexRecordPath
    Assert-True (-not $codexRecord.cwd.Equals($repository, [System.StringComparison]::OrdinalIgnoreCase)) 'Codex ran in the canonical checkout.'
    Assert-True ($codexRecord.arguments -match [regex]::Escape("-C|$($codexRecord.cwd)")) 'Codex -C did not target the disposable checkout.'
    Assert-Equal $codexRecord.tracked 'dirty-before' 'Codex checkout did not receive dirty tracked content.'
    Assert-Equal $codexRecord.untracked 'untracked-before' 'Codex checkout did not receive untracked content.'
    Assert-Equal ((Get-Content -LiteralPath (Join-Path $repository 'tracked.txt') -Raw).Trim()) 'dirty-before' 'Codex changed the canonical dirty tracked file.'
    Assert-Equal ((Get-Content -LiteralPath (Join-Path $repository 'untracked.txt') -Raw).Trim()) 'untracked-before' 'Codex changed the canonical untracked file.'
    Assert-DisposableCheckoutCleaned -RepositoryPath $repository -Record $codexRecord -Message 'Codex violation cleanup:'

    $codexRun = Get-ChildItem -LiteralPath $codexRunRoot -Directory | Select-Object -First 1
    $routingResult = Get-Content -LiteralPath (Join-Path $codexRun.FullName 'routing-result.json') -Raw | ConvertFrom-Json
    Assert-Equal $routingResult.status 'FAIL' 'Read-only violation did not produce a failed routing result.'
    Assert-True ([bool]$routingResult.repository_changed) 'Read-only violation did not report repository_changed.'
    $violationPath = Join-Path $codexRun.FullName 'attempt-1-codex\read-only-violation.json'
    $violation = Get-Content -LiteralPath $violationPath -Raw | ConvertFrom-Json
    $changedPaths = @($violation.changes | ForEach-Object { $_.path })
    Assert-True ($changedPaths -contains 'tracked.txt') 'A change to an already dirty tracked file was missed.'
    Assert-True ($changedPaths -contains 'untracked.txt') 'A change to an already untracked file was missed.'
    Assert-Equal $violation.git_status_before $violation.git_status_after 'Test setup did not preserve identical Git status across content changes.'

    $failureRecordPath = Join-Path $testRoot 'failure-record.txt'
    $env:AI_ROUTER_MOCK_RECORD = $failureRecordPath
    $env:AI_ROUTER_MOCK_BEHAVIOR = 'fail'
    $failureResult = Invoke-TestPowerShell -ScriptPath $router -Arguments @(
        '-TaskFile', $taskFile, '-WorkingDirectory', $repository, '-Provider', 'Claude',
        '-Mode', 'ReadOnly', '-RunRoot', (Join-Path $testRoot 'runs-provider-failure'), '-ProjectName', 'RouterTest'
    )
    Assert-True ($failureResult.ExitCode -ne 0) "A failing provider unexpectedly succeeded. Output: $($failureResult.Output)"
    $failureRecord = Read-MockRecord -Path $failureRecordPath
    Assert-DisposableCheckoutCleaned -RepositoryPath $repository -Record $failureRecord -Message 'Provider error cleanup:'

    Write-Output 'ROUTER_READONLY_TEST_OK'
}
finally {
    $env:PATH = $oldPath
    foreach ($entry in @(
        @{ Name = 'OPENAI_API_KEY'; Value = $oldOpenAiKey },
        @{ Name = 'ANTHROPIC_API_KEY'; Value = $oldAnthropicKey },
        @{ Name = 'ANTHROPIC_BASE_URL'; Value = $oldAnthropicBaseUrl },
        @{ Name = 'AI_ROUTER_MOCK_BEHAVIOR'; Value = $oldMockBehavior },
        @{ Name = 'AI_ROUTER_MOCK_RECORD'; Value = $oldMockRecord }
    )) {
        if ($null -eq $entry.Value) { Remove-Item ("Env:{0}" -f $entry.Name) -ErrorAction SilentlyContinue }
        else { Set-Item ("Env:{0}" -f $entry.Name) -Value $entry.Value }
    }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
