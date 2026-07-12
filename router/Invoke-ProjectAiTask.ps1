[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TaskFile,
    [string]$WorkingDirectory = (Get-Location).Path,
    [ValidateSet('Auto', 'Codex', 'Claude', 'Ollama')]
    [string]$Provider = 'Auto',
    [ValidateSet('ReadOnly', 'Write')]
    [string]$Mode = 'ReadOnly',
    [string]$ProjectName = 'Project',
    [string]$ClaudeModel = 'sonnet',
    [string]$OllamaModel = 'polis-coder',
    [string]$RunRoot = (Join-Path $env:USERPROFILE 'Documents\AI-Runs'),
    [switch]$LocalOnly,
    [switch]$AllowDirtyWorkingTree,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$InputText,
        [Parameter(Mandatory)][string]$Cwd,
        [Parameter(Mandatory)][string]$ProviderName
    )

    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $FilePath
    $start.WorkingDirectory = $Cwd
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.CreateNoWindow = $true
    foreach ($argument in $Arguments) {
        [void]$start.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $start
    [void]$process.Start()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.Write($InputText)
    $process.StandardInput.Close()
    $stdout = [System.Text.StringBuilder]::new()
    while (-not $process.StandardOutput.EndOfStream) {
        $line = $process.StandardOutput.ReadLine()
        [void]$stdout.AppendLine($line)
        [Console]::Out.WriteLine("AI_STREAM provider=$ProviderName $line")
        [Console]::Out.Flush()
    }
    $process.WaitForExit()

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $stdout.ToString()
        Stderr = $stderrTask.GetAwaiter().GetResult()
    }
}

function Test-UsageLimitFailure {
    param([string]$Text)

    return $Text -match '(?is)(usage|rate|quota).{0,120}(limit|exhaust|reset)' -or
        $Text -match '(?is)(limit).{0,120}(reached|exceeded|reset)' -or
        $Text -match '(?i)insufficient_quota|too many requests|http\s*429'
}

function Write-ClaudeBackoffState {
    param([string]$Message)

    $stateRoot = Join-Path $env:LOCALAPPDATA 'AI Project Control'
    New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
    $statePath = Join-Path $stateRoot 'provider-state.json'
    $state = [pscustomobject]@{
        claude_limit_detected_at = [DateTimeOffset]::Now.ToString('o')
        claude_retry_not_before = [DateTimeOffset]::Now.AddMinutes(5).ToString('o')
        limit_message_excerpt = if ($Message.Length -gt 500) { $Message.Substring(0, 500) } else { $Message }
        note = 'Five-minute probe backoff only. The authoritative reset remains Claude /status or the provider limit message.'
    }
    $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
}

if (-not (Test-Path -LiteralPath $TaskFile -PathType Leaf)) {
    throw "Task file not found: $TaskFile"
}
if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
    throw "Working directory not found: $WorkingDirectory"
}

$taskPath = (Resolve-Path -LiteralPath $TaskFile).Path
$workingPath = (Resolve-Path -LiteralPath $WorkingDirectory).Path
$statusScript = Join-Path $PSScriptRoot 'Get-AiProviderStatus.ps1'
$status = (& $statusScript -Json | Out-String) | ConvertFrom-Json

$gitBefore = (& git -C $workingPath status --porcelain=v1 --untracked-files=all | Out-String).TrimEnd()
if ($Mode -eq 'Write' -and $gitBefore -and -not $AllowDirtyWorkingTree) {
    throw 'Write mode requires a clean worktree unless -AllowDirtyWorkingTree is explicitly supplied.'
}

$taskName = [System.IO.Path]::GetFileNameWithoutExtension($taskPath) -replace '[^A-Za-z0-9_-]', '-'
$runDir = Join-Path $RunRoot ("{0}_{1}" -f (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'), $taskName)
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
Copy-Item -LiteralPath $taskPath -Destination (Join-Path $runDir 'task-package.md')
$status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'provider-status.json') -Encoding utf8

$prompt = @"
You are executing a controlled task for the local project "$ProjectName".

Mandatory workflow:
1. Read AGENTS.md before any project analysis or change when it exists. For Polis, AGENTS.md is mandatory.
2. Treat Git and current repository files as authoritative.
3. Use Graphify for focused discovery when graphify-out/graph.json exists, then read every relevant original file directly.
4. Treat an associated Obsidian area as working context, never as a competing source of truth.
5. Do not commit, push, create a pull request, merge, or approve lifecycle promotion.
6. Do not change unrelated files. Stop when a permanent design decision needs owner approval.
7. Run the task's required validation and finish with changed files, tests, risks, and open gates.
8. End the final response with exactly AI_PROJECT_TASK_COMPLETE only when the task is complete. Otherwise end with AI_PROJECT_TASK_BLOCKED: followed by the reason.

Execution mode: $Mode

Task package:

$(Get-Content -LiteralPath $taskPath -Raw)
"@
$executionPromptPath = Join-Path $runDir 'execution-prompt.md'
$prompt | Set-Content -LiteralPath $executionPromptPath -Encoding utf8

$sandbox = if ($Mode -eq 'Write') { 'workspace-write' } else { 'read-only' }
$claudePermission = if ($Mode -eq 'Write') { 'acceptEdits' } else { 'plan' }

$candidates = @(
    if ($LocalOnly) {
        if ($Provider -in @('Codex', 'Claude')) {
            throw 'Codex or Claude was selected while subscription-token usage is disabled.'
        }
        if ($status.ollama.available) { 'ollama' }
    }
    elseif ($Provider -ne 'Auto') {
        $Provider.ToLowerInvariant()
    }
    else {
        if ($status.codex.available) { 'codex' }
        if ($status.claude.available) { 'claude' }
        if ($status.ollama.available) { 'ollama' }
    }
)

if ($candidates.Count -eq 0) {
    throw 'No provider is currently available under the subscription-only policy.'
}

if ($DryRun) {
    [pscustomobject]@{
        run_directory = $runDir
        selected_order = $candidates
        mode = $Mode
        repository_status_unchanged = $true
    } | ConvertTo-Json -Depth 5
    exit 0
}

$attempts = [System.Collections.Generic.List[object]]::new()
$handoffs = [System.Collections.Generic.List[object]]::new()
$handoffPath = $null
foreach ($candidate in $candidates) {
    $attemptDir = Join-Path $runDir ("attempt-{0}-{1}" -f ($attempts.Count + 1), $candidate)
    New-Item -ItemType Directory -Force -Path $attemptDir | Out-Null

    $attemptPrompt = $prompt
    if ($null -ne $handoffPath) {
        $attemptPrompt += @"

Provider handoff:
- Continue the same task from the current worktree state.
- Read the handoff package at: $handoffPath
- Inspect the existing git status and diff before changing anything.
- Preserve correct prior work, repair incomplete work, and do not broaden scope.
"@
    }
    $attemptPromptPath = Join-Path $attemptDir 'provider-prompt.md'
    $attemptPrompt | Set-Content -LiteralPath $attemptPromptPath -Encoding utf8
    [Console]::Out.WriteLine("AI_EVENT provider=$candidate state=started attempt=$($attempts.Count + 1)")
    [Console]::Out.Flush()

    if ($candidate -eq 'codex') {
        if ([bool]$env:OPENAI_API_KEY) {
            throw 'OPENAI_API_KEY is set. Subscription-only routing refuses to risk API billing.'
        }
        $command = (Get-Command codex).Source
        $arguments = @('exec', '--json', '--color', 'never', '--ephemeral', '-C', $workingPath, '-s', $sandbox, '-c', 'approval_policy="never"', '-')
        $processInput = $attemptPrompt
    }
    elseif ($candidate -eq 'claude') {
        if ([bool]$env:ANTHROPIC_API_KEY -or [bool]$env:ANTHROPIC_BASE_URL) {
            throw 'Anthropic API configuration is present. Subscription-only routing refuses to risk API billing.'
        }
        $command = (Get-Command claude).Source
        $arguments = @('-p', '--output-format', 'json', '--no-session-persistence', '--model', $ClaudeModel, '--effort', 'high', '--permission-mode', $claudePermission)
        $processInput = $attemptPrompt
    }
    else {
        $command = (Get-Command hermes).Source
        $hermesPrompt = "Read and execute the complete controlled instructions at $attemptPromptPath. End with AI_PROJECT_TASK_COMPLETE only if complete; otherwise end with AI_PROJECT_TASK_BLOCKED: reason."
        $arguments = @('-z', $hermesPrompt, '--usage-file', (Join-Path $attemptDir 'usage.json'), '--provider', 'ollama-launch', '-m', $OllamaModel)
        if ($ProjectName -eq 'Polis') { $arguments += @('--skills', 'polis-controlled-development') }
        $processInput = ''
    }

    $started = [DateTimeOffset]::Now
    $result = Invoke-CapturedProcess -FilePath $command -Arguments $arguments -InputText $processInput -Cwd $workingPath -ProviderName $candidate
    $finished = [DateTimeOffset]::Now
    $result.Stdout | Set-Content -LiteralPath (Join-Path $attemptDir 'stdout.log') -Encoding utf8
    $result.Stderr | Set-Content -LiteralPath (Join-Path $attemptDir 'stderr.log') -Encoding utf8
    $combined = $result.Stdout + "`n" + $result.Stderr
    $limited = Test-UsageLimitFailure -Text $combined
    $completionConfirmed = $result.ExitCode -eq 0 -and $result.Stdout -match 'AI_PROJECT_TASK_COMPLETE'

    $attempt = [pscustomobject]@{
        provider = $candidate
        exit_code = $result.ExitCode
        success = $completionConfirmed
        completion_sentinel = $completionConfirmed
        usage_limit_detected = $limited
        started_at = $started.ToString('o')
        finished_at = $finished.ToString('o')
        output_directory = $attemptDir
    }
    $attempts.Add($attempt)
    [Console]::Out.WriteLine("AI_EVENT provider=$candidate state=finished exit=$($result.ExitCode) complete=$completionConfirmed quota=$limited")
    [Console]::Out.Flush()

    $gitAfter = (& git -C $workingPath status --porcelain=v1 --untracked-files=all | Out-String).TrimEnd()
    $repoChanged = $gitAfter -ne $gitBefore
    if ($completionConfirmed) {
        if ($Mode -eq 'ReadOnly' -and $repoChanged) {
            throw "Provider $candidate changed the worktree during a read-only task. Inspect $attemptDir."
        }
        [pscustomobject]@{
            status = 'PASS'
            selected_provider = $candidate
            mode = $Mode
            repository_changed = $repoChanged
            attempts = $attempts
            handoffs = $handoffs
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'routing-result.json') -Encoding utf8
        Write-Output "AI_PROJECT_ROUTER_OK provider=$candidate run=$runDir"
        exit 0
    }

    if ($Mode -eq 'ReadOnly' -and $repoChanged) {
        throw "Provider $candidate changed the worktree during a read-only task. Automatic fallback stopped; inspect $attemptDir."
    }
    if ($result.ExitCode -eq 0 -and -not $completionConfirmed -and -not $limited) {
        throw "Provider $candidate exited without the required completion sentinel. Automatic fallback stopped; inspect $attemptDir."
    }
    if (-not $limited) {
        throw "Provider $candidate failed for a non-quota reason. Automatic fallback stopped; inspect $attemptDir."
    }

    $priorHandoffPath = $handoffPath
    $handoffPath = Join-Path $runDir ("handoff-{0}-to-next.md" -f $candidate)
    $diffPath = Join-Path $attemptDir 'working-tree.diff'
    (& git -C $workingPath diff --no-ext-diff | Out-String) | Set-Content -LiteralPath $diffPath -Encoding utf8
    $handoffDocument = @"
# Provider Handoff

Project: $ProjectName
Execution mode: $Mode
Previous provider: $candidate
Failure class: usage or quota limit
Worktree changed: $repoChanged

## Required continuation

Continue the original task in the same worktree. Read the original task package and inspect the current files,
git status and diff. Preserve correct completed work, finish incomplete work, rerun validation, and keep scope fixed.

## Artifacts

- Original task: $taskPath
- Previous stdout: $(Join-Path $attemptDir 'stdout.log')
- Previous stderr: $(Join-Path $attemptDir 'stderr.log')
- Working-tree diff: $diffPath
- Prior handoff: $(if ($null -ne $priorHandoffPath) { $priorHandoffPath } else { 'none' })

## Git status

``````text
$gitAfter
``````
"@
    $handoffDocument | Set-Content -LiteralPath $handoffPath -Encoding utf8
    $handoffs.Add([pscustomobject]@{
        from_provider = $candidate
        handoff_path = $handoffPath
        worktree_changed = $repoChanged
        created_at = [DateTimeOffset]::Now.ToString('o')
    })
    [Console]::Out.WriteLine("AI_EVENT provider=$candidate state=handoff path=$handoffPath")
    [Console]::Out.Flush()
    if ($candidate -eq 'claude') {
        Write-ClaudeBackoffState -Message $combined
    }
}

[pscustomobject]@{
    status = 'FAIL'
    reason = 'All allowed providers were exhausted.'
    attempts = $attempts
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'routing-result.json') -Encoding utf8
throw "All allowed providers were exhausted. See $runDir"
