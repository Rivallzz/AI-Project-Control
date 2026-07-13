[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TaskFile,
    [string]$WorkingDirectory = (Get-Location).Path,
    [ValidateSet('Auto', 'Codex', 'Claude', 'Ollama')]
    [string]$Provider = 'Auto',
    [string]$ProviderOrder = '',
    [ValidateSet('ReadOnly', 'Write')]
    [string]$Mode = 'ReadOnly',
    [string]$ProjectName = 'Project',
    [string]$CodexModel = 'default',
    [string]$ClaudeModel = 'default',
    [string]$OllamaModel = 'default',
    [string]$RunRoot = (Join-Path $env:USERPROFILE 'Documents\AI-Runs'),
    [switch]$LocalOnly,
    [switch]$AllowDirtyWorkingTree,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$consoleUtf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $consoleUtf8
[Console]::OutputEncoding = $consoleUtf8
$OutputEncoding = $consoleUtf8

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][AllowEmptyString()][string]$InputText,
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
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    if ($start.PSObject.Properties.Name -contains 'StandardInputEncoding') { $start.StandardInputEncoding = $utf8 }
    if ($start.PSObject.Properties.Name -contains 'StandardOutputEncoding') { $start.StandardOutputEncoding = $utf8 }
    if ($start.PSObject.Properties.Name -contains 'StandardErrorEncoding') { $start.StandardErrorEncoding = $utf8 }
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
    $emitStreamLine = $ProviderName -ne 'ollama'
    while (-not $process.StandardOutput.EndOfStream) {
        $line = $process.StandardOutput.ReadLine()
        [void]$stdout.AppendLine($line)
        if (-not $emitStreamLine -and $line -match 'Initializing agent') { $emitStreamLine = $true }
        if ($emitStreamLine) {
            [Console]::Out.WriteLine("AI_STREAM provider=$ProviderName $line")
            [Console]::Out.Flush()
        }
    }
    $process.WaitForExit()

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $stdout.ToString()
        Stderr = $stderrTask.GetAwaiter().GetResult()
    }
}

function Test-PathWithinRoot {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Root
    )

    $comparison = if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) {
        [System.StringComparison]::OrdinalIgnoreCase
    }
    else {
        [System.StringComparison]::Ordinal
    }
    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    if ($fullPath.Equals($fullRoot, $comparison)) { return $true }
    return $fullPath.StartsWith($fullRoot + [System.IO.Path]::DirectorySeparatorChar, $comparison)
}

function Get-GitNulPathList {
    param(
        [Parameter(Mandatory)][string]$RepositoryPath,
        [Parameter(Mandatory)][string[]]$Arguments
    )

    $output = (& git -c core.quotePath=false -C $RepositoryPath @Arguments | Out-String -NoNewline)
    if ($LASTEXITCODE -ne 0) {
        throw "Git could not enumerate the repository snapshot: git $($Arguments -join ' ')"
    }
    return @($output.Split([char]0, [System.StringSplitOptions]::RemoveEmptyEntries))
}

function Copy-RepositoryContentSnapshot {
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$DestinationPath
    )

    $headPaths = Get-GitNulPathList -RepositoryPath $SourcePath -Arguments @('ls-tree', '-r', '-z', '--name-only', 'HEAD')
    $workingPaths = Get-GitNulPathList -RepositoryPath $SourcePath -Arguments @('ls-files', '-z', '--cached', '--others', '--exclude-standard')
    $snapshotPaths = @((@($headPaths) + @($workingPaths)) | Sort-Object -Unique)

    foreach ($relativePath in $snapshotPaths) {
        if ([System.IO.Path]::IsPathRooted($relativePath)) {
            throw "Git returned an unsafe rooted snapshot path: $relativePath"
        }
        $sourceItemPath = [System.IO.Path]::GetFullPath((Join-Path $SourcePath $relativePath))
        $destinationItemPath = [System.IO.Path]::GetFullPath((Join-Path $DestinationPath $relativePath))
        if (-not (Test-PathWithinRoot -Path $sourceItemPath -Root $SourcePath) -or
            -not (Test-PathWithinRoot -Path $destinationItemPath -Root $DestinationPath)) {
            throw "Git returned an unsafe snapshot path: $relativePath"
        }

        $sourceItem = Get-Item -LiteralPath $sourceItemPath -Force -ErrorAction SilentlyContinue
        $destinationItem = Get-Item -LiteralPath $destinationItemPath -Force -ErrorAction SilentlyContinue
        if ($null -eq $sourceItem) {
            if ($null -ne $destinationItem) {
                Remove-Item -LiteralPath $destinationItemPath -Recurse -Force
            }
            continue
        }

        if ($null -ne $destinationItem -and $sourceItem.PSIsContainer -ne $destinationItem.PSIsContainer) {
            Remove-Item -LiteralPath $destinationItemPath -Recurse -Force
            $destinationItem = $null
        }
        $destinationParent = Split-Path -Parent $destinationItemPath
        New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
        if ($sourceItem.PSIsContainer) {
            if ($null -ne $destinationItem) { Remove-Item -LiteralPath $destinationItemPath -Recurse -Force }
            Copy-Item -LiteralPath $sourceItemPath -Destination $destinationItemPath -Recurse -Force
        }
        else {
            Copy-Item -LiteralPath $sourceItemPath -Destination $destinationItemPath -Force
        }
    }

    # Graphify output is intentionally ignored by Git but remains relevant read-only context.
    $sourceGraph = Join-Path $SourcePath 'graphify-out\graph.json'
    if (Test-Path -LiteralPath $sourceGraph -PathType Leaf) {
        $destinationGraph = Join-Path $DestinationPath 'graphify-out\graph.json'
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationGraph) | Out-Null
        Copy-Item -LiteralPath $sourceGraph -Destination $destinationGraph -Force
    }
}

function New-DisposableReadOnlyCheckout {
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$CheckoutPath
    )

    if (Test-PathWithinRoot -Path $CheckoutPath -Root $SourcePath) {
        throw 'Read-only isolation requires RunRoot to be outside the canonical checkout.'
    }
    if (Test-Path -LiteralPath $CheckoutPath) {
        throw "Disposable read-only checkout already exists: $CheckoutPath"
    }

    $worktreeAdded = $false
    try {
        & git -C $SourcePath worktree add --detach $CheckoutPath HEAD | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the disposable read-only checkout.' }
        $worktreeAdded = $true
        Copy-RepositoryContentSnapshot -SourcePath $SourcePath -DestinationPath $CheckoutPath
        return $CheckoutPath
    }
    catch {
        if ($worktreeAdded) {
            Remove-DisposableReadOnlyCheckout -SourcePath $SourcePath -CheckoutPath $CheckoutPath -ExpectedParent (Split-Path -Parent $CheckoutPath)
        }
        throw
    }
}

function Get-ContentManifest {
    param([Parameter(Mandatory)][string]$RootPath)

    $manifest = @{}
    $fullRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd('\', '/')
    $gitMarker = Join-Path $fullRoot '.git'
    $files = Get-ChildItem -LiteralPath $fullRoot -Recurse -Force -File |
        Where-Object { $_.FullName -ne $gitMarker } |
        Sort-Object FullName
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($fullRoot.Length).TrimStart('\', '/').Replace('\', '/')
        $linkType = if ($file.PSObject.Properties['LinkType']) { [string]$file.LinkType } else { '' }
        if ($linkType) {
            $linkTarget = if ($file.PSObject.Properties['Target']) { @($file.Target) -join '|' } else { '' }
            $manifest[$relativePath] = "link:${linkType}:$linkTarget"
        }
        else {
            $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            $manifest[$relativePath] = "file:$($file.Length):$hash"
        }
    }
    return $manifest
}

function Compare-ContentManifest {
    param(
        [Parameter(Mandatory)][hashtable]$Before,
        [Parameter(Mandatory)][hashtable]$After
    )

    $changes = @(
        foreach ($relativePath in @((@($Before.Keys) + @($After.Keys)) | Sort-Object -Unique)) {
            if (-not $Before.ContainsKey($relativePath)) {
                [pscustomobject]@{ path = $relativePath; change = 'added'; before = $null; after = $After[$relativePath] }
            }
            elseif (-not $After.ContainsKey($relativePath)) {
                [pscustomobject]@{ path = $relativePath; change = 'deleted'; before = $Before[$relativePath]; after = $null }
            }
            elseif ($Before[$relativePath] -ne $After[$relativePath]) {
                [pscustomobject]@{ path = $relativePath; change = 'modified'; before = $Before[$relativePath]; after = $After[$relativePath] }
            }
        }
    )
    return $changes
}

function Remove-DisposableReadOnlyCheckout {
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$CheckoutPath,
        [Parameter(Mandatory)][string]$ExpectedParent
    )

    if (-not (Test-PathWithinRoot -Path $CheckoutPath -Root $ExpectedParent)) {
        throw "Refusing to clean a disposable checkout outside its attempt directory: $CheckoutPath"
    }

    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & git -C $SourcePath worktree remove --force $CheckoutPath 2>&1 | Out-Null
        if (Test-Path -LiteralPath $CheckoutPath) {
            Remove-Item -LiteralPath $CheckoutPath -Recurse -Force -ErrorAction Continue
        }
        & git -C $SourcePath worktree prune 2>&1 | Out-Null
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }

    if (Test-Path -LiteralPath $CheckoutPath) {
        throw "Could not clean the disposable read-only checkout: $CheckoutPath"
    }
    [Console]::Out.WriteLine("AI_EVENT provider=router state=sandbox-cleaned path=$CheckoutPath")
    [Console]::Out.Flush()
}

function Test-UsageLimitFailure {
    param([string]$Text)

    return $Text -match '(?is)(usage|rate|quota).{0,120}(limit|exhaust|reset)' -or
        $Text -match '(?is)(limit).{0,120}(reached|exceeded|reset)' -or
        $Text -match '(?i)insufficient_quota|too many requests|http\s*429'
}

function New-ContinuesHandoffArtifact {
    param(
        [Parameter(Mandatory)][ValidateSet('codex', 'claude')][string]$SourceProvider,
        [Parameter(Mandatory)][string]$Cwd,
        [Parameter(Mandatory)][DateTimeOffset]$StartedAt,
        [Parameter(Mandatory)][DateTimeOffset]$FinishedAt,
        [Parameter(Mandatory)][string]$OutputDirectory
    )

    $continuesCommand = Get-Command continues -ErrorAction SilentlyContinue
    if ($null -eq $continuesCommand) {
        [Console]::Out.WriteLine('AI_EVENT provider=continues state=skipped reason=command-not-found')
        return $null
    }

    try {
        & $continuesCommand.Source scan --rebuild | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'session index rebuild failed' }
        $sessionJson = (& $continuesCommand.Source list --source $SourceProvider --json -n 40 | Out-String)
        if ($LASTEXITCODE -ne 0) { throw 'session listing failed' }
        $expectedPath = [System.IO.Path]::GetFullPath($Cwd).TrimEnd('\')
        $windowStart = $StartedAt.AddMinutes(-2)
        $windowEnd = $FinishedAt.AddMinutes(2)
        $sessions = @($sessionJson | ConvertFrom-Json)
        $session = $sessions | Where-Object {
            if (-not $_.cwd -or -not $_.updatedAt) { return $false }
            try {
                $sessionPath = [System.IO.Path]::GetFullPath([string]$_.cwd).TrimEnd('\')
                $updatedAt = [DateTimeOffset]::Parse([string]$_.updatedAt)
                return $sessionPath -eq $expectedPath -and $updatedAt -ge $windowStart -and $updatedAt -le $windowEnd
            }
            catch { return $false }
        } | Sort-Object { [DateTimeOffset]::Parse([string]$_.updatedAt) } -Descending | Select-Object -First 1

        if ($null -eq $session) {
            [Console]::Out.WriteLine("AI_EVENT provider=continues state=skipped reason=no-exact-$SourceProvider-session")
            return $null
        }

        $artifactPath = Join-Path $OutputDirectory 'continues-handoff.md'
        & $continuesCommand.Source inspect ([string]$session.id) --preset minimal --write-md $artifactPath | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $artifactPath)) { throw 'session export failed' }
        [Console]::Out.WriteLine("AI_EVENT provider=continues state=created source=$SourceProvider path=$artifactPath")
        return $artifactPath
    }
    catch {
        $reason = ($_.Exception.Message -replace '[\r\n]+', ' ' -replace '\s+', '-').Trim('-')
        [Console]::Out.WriteLine("AI_EVENT provider=continues state=skipped reason=$reason")
        return $null
    }
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

function Get-ProviderStatusValue {
    param(
        [object]$ProviderStatus,
        [Parameter(Mandatory)][string]$Name
    )

    if ($null -eq $ProviderStatus) { return $null }
    $property = $ProviderStatus.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-ProviderUnavailableReason {
    param(
        [Parameter(Mandatory)][string]$ProviderKey,
        [object]$ProviderStatus
    )

    $reportedReason = [string](Get-ProviderStatusValue -ProviderStatus $ProviderStatus -Name 'reason')
    if ($reportedReason.Trim()) { return $reportedReason.Trim() }

    if ($ProviderKey -eq 'codex') {
        if (-not [bool](Get-ProviderStatusValue -ProviderStatus $ProviderStatus -Name 'authenticated_with_chatgpt')) {
            return 'Codex is not authenticated with a ChatGPT subscription.'
        }
        if ([bool](Get-ProviderStatusValue -ProviderStatus $ProviderStatus -Name 'quota_known')) {
            return 'Codex subscription quota is currently exhausted.'
        }
        return 'Codex is currently unavailable.'
    }
    if ($ProviderKey -eq 'claude') {
        $retryNotBefore = [string](Get-ProviderStatusValue -ProviderStatus $ProviderStatus -Name 'retry_not_before_local')
        if ($retryNotBefore.Trim()) { return "Claude is in quota backoff until $($retryNotBefore.Trim())." }
        if (-not [bool](Get-ProviderStatusValue -ProviderStatus $ProviderStatus -Name 'authenticated_with_subscription')) {
            return 'Claude Code is not authenticated with an eligible subscription.'
        }
        return 'Claude Code is currently unavailable.'
    }
    if ($ProviderKey -eq 'ollama') {
        return 'Hermes/Ollama is unavailable for the selected local model.'
    }
    return "$ProviderKey is currently unavailable."
}

if (-not (Test-Path -LiteralPath $TaskFile -PathType Leaf)) {
    throw "Task file not found: $TaskFile"
}
if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
    throw "Working directory not found: $WorkingDirectory"
}

$taskPath = (Resolve-Path -LiteralPath $TaskFile).Path
$workingPath = (Resolve-Path -LiteralPath $WorkingDirectory).Path
$taskPackageRaw = Get-Content -LiteralPath $taskPath -Raw
$goalMatch = [regex]::Match($taskPackageRaw, '(?s)## Goal\s*(.+)$')
$taskGoal = if ($goalMatch.Success) { $goalMatch.Groups[1].Value.Trim() } else { $taskPackageRaw.Trim() }
$CodexModel = $CodexModel.Trim()
$ClaudeModel = $ClaudeModel.Trim()
$OllamaModel = $OllamaModel.Trim()
if (-not $CodexModel) { $CodexModel = 'default' }
if (-not $ClaudeModel) { $ClaudeModel = 'default' }
if (-not $OllamaModel) { $OllamaModel = 'default' }
$statusScript = Join-Path $PSScriptRoot 'Get-AiProviderStatus.ps1'
$status = (& $statusScript -Json -OllamaModel $OllamaModel | Out-String) | ConvertFrom-Json
if ($status.ollama.model) { $OllamaModel = [string]$status.ollama.model }
$providerModels = @{
    codex = $CodexModel
    claude = $ClaudeModel
    ollama = $OllamaModel
}

$gitBefore = (& git -C $workingPath status --porcelain=v1 --untracked-files=all | Out-String).TrimEnd()
if ($Mode -eq 'Write' -and $gitBefore -and -not $AllowDirtyWorkingTree) {
    throw 'Write mode requires a clean worktree unless -AllowDirtyWorkingTree is explicitly supplied.'
}

$taskName = [System.IO.Path]::GetFileNameWithoutExtension($taskPath) -replace '[^A-Za-z0-9_-]', '-'
$runDir = Join-Path $RunRoot ("{0}_{1}" -f (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'), $taskName)
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
[Console]::Out.WriteLine("AI_RUN_DIRECTORY $runDir")
[Console]::Out.Flush()
Copy-Item -LiteralPath $taskPath -Destination (Join-Path $runDir 'task-package.md')
$status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'provider-status.json') -Encoding utf8

$contextPolicy = if ($Mode -eq 'ReadOnly') {
@"
Read-only context policy:
- Treat ordinary questions and ideation requests as concise advisory work.
- Read AGENTS.md, then use Graphify for focused discovery when available.
- Use Serena only when symbol-level code relationships would reduce broad file reads; activate the current worktree first.
- Read only the minimum original files required to answer; do not scan the complete repository or documentation tree by default.
- Do not run the full test suite for an advisory answer unless the task explicitly requests validation or a repository-wide audit.
- Broaden context only when the task explicitly requires cross-project, architecture-wide, consistency, security or release analysis.
"@
}
else {
@"
Write-task context policy:
- Follow the complete project workflow and read every owner document required by AGENTS.md.
- Use Graphify to focus discovery, then verify every changed or decision-owning file directly.
- Activate the current worktree with Serena for symbol-level code discovery and edits when available.
- Run the validation required for the affected systems.
"@
}

$deliveryMetadataPolicy = if ($Mode -eq 'Write') {
@"
Write-task delivery metadata:
- Immediately before the final completion sentinel, include exactly one line `Suggested branch name: ai/<concise-outcome-name>`.
- Immediately before the final completion sentinel, include exactly one line `Suggested commit message: <imperative summary>`.
- The branch suffix must describe the implemented outcome in 2-5 lowercase kebab-case words, not repeat the user's conversational opening.
- The commit message must be imperative, concrete, at most 72 characters and match the actual changed files.
"@
}
else { '' }

$prompt = @"
You are executing a controlled task for the local project "$ProjectName".

Mandatory workflow:
1. Read AGENTS.md before any project analysis or change when it exists.
2. Treat Git and current repository files as authoritative.
3. Use Graphify for focused discovery when graphify-out/graph.json exists, then read every relevant original file directly.
4. For code work, use Serena's `initial_instructions` and symbol tools when available. Clients started with `--project-from-cwd` are already activated; call `activate_project` only when that tool exists.
5. Treat an associated Obsidian area as working context, never as a competing source of truth.
6. Do not commit, push, create a pull request, merge, or approve lifecycle promotion.
7. Do not change unrelated files. Stop when a permanent design decision needs owner approval.
8. Run the task's required validation and finish with changed files, tests, risks, and open gates.
9. End the final response with exactly AI_PROJECT_TASK_COMPLETE only when the task is complete. Otherwise end with AI_PROJECT_TASK_BLOCKED: followed by the reason.

Execution mode: $Mode

$contextPolicy

$deliveryMetadataPolicy

Task package:

$taskPackageRaw
"@
$executionPromptPath = Join-Path $runDir 'execution-prompt.md'
$prompt | Set-Content -LiteralPath $executionPromptPath -Encoding utf8

$sandbox = if ($Mode -eq 'Write') { 'workspace-write' } else { 'read-only' }
$claudePermission = if ($Mode -eq 'Write') { 'acceptEdits' } else { 'plan' }

$knownProviders = @('Codex', 'Claude', 'Ollama')
$requestedProviders = @(
    if ($ProviderOrder.Trim()) {
        $ProviderOrder.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }
    elseif ($Provider -ne 'Auto') { $Provider }
    else { 'Codex', 'Claude', 'Ollama' }
)

if ($requestedProviders.Count -eq 0) { throw 'Provider order is empty.' }
if (@($requestedProviders | Select-Object -Unique).Count -ne $requestedProviders.Count) { throw 'Provider order contains duplicates.' }
foreach ($requestedProvider in $requestedProviders) {
    if ($requestedProvider -notin $knownProviders) { throw "Unknown provider in routing order: $requestedProvider" }
}

if ($LocalOnly) { $requestedProviders = @('Ollama') }
$attempts = [System.Collections.Generic.List[object]]::new()
$handoffs = [System.Collections.Generic.List[object]]::new()
$unavailableProviders = [System.Collections.Generic.List[object]]::new()
$candidates = @(
    foreach ($requestedProvider in $requestedProviders) {
        $providerKey = $requestedProvider.ToLowerInvariant()
        $providerStatus = $status.PSObject.Properties[$providerKey].Value
        if ($providerStatus.available) {
            $providerKey
            continue
        }
        $reason = Get-ProviderUnavailableReason -ProviderKey $providerKey -ProviderStatus $providerStatus
        $model = [string]$providerModels[$providerKey]
        [void]$unavailableProviders.Add([pscustomobject]@{
            provider = $providerKey
            model = $model
            reason = $reason
        })
        [Console]::Out.WriteLine("AI_EVENT provider=$providerKey state=unavailable model=$model reason=$reason")
        [Console]::Out.Flush()
    }
)

if ($candidates.Count -eq 0) {
    $reasonSummary = @($unavailableProviders | ForEach-Object { "$($_.provider) model=$($_.model): $($_.reason)" }) -join '; '
    [pscustomobject]@{
        status = 'FAIL'
        reason = "No requested provider is currently available. $reasonSummary"
        selected_provider = $null
        selected_model = $null
        mode = $Mode
        attempts = $attempts
        handoffs = $handoffs
        unavailable_providers = $unavailableProviders
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'routing-result.json') -Encoding utf8
    throw "No requested provider is currently available. $reasonSummary"
}

if ($DryRun) {
    [pscustomobject]@{
        run_directory = $runDir
        selected_order = $candidates
        selected_models = $providerModels
        unavailable_providers = $unavailableProviders
        mode = $Mode
        repository_status_unchanged = $true
    } | ConvertTo-Json -Depth 5
    exit 0
}

$handoffPath = $null
$selectedModel = $null
foreach ($candidate in $candidates) {
    $candidateModel = [string]$providerModels[$candidate]
    $selectedModel = $candidateModel
    $attemptDir = Join-Path $runDir ("attempt-{0}-{1}" -f ($attempts.Count + 1), $candidate)
    New-Item -ItemType Directory -Force -Path $attemptDir | Out-Null
    if ($candidate -eq 'ollama' -and $Mode -eq 'Write') {
        [Console]::Out.WriteLine('AI_EVENT provider=ollama state=blocked reason=local-hermes-write-not-approved')
        throw 'Local Hermes/Ollama write tasks are disabled until the read-only instruction-adherence gate passes.'
    }
    $providerWorkingPath = $workingPath
    $disposableReadOnlyCheckout = $null
    $providerDiffAfter = ''
    $contentChanges = @()

    try {
        if ($Mode -eq 'ReadOnly') {
            $checkoutPath = Join-Path $attemptDir 'readonly-worktree'
            $providerWorkingPath = New-DisposableReadOnlyCheckout -SourcePath $workingPath -CheckoutPath $checkoutPath
            $disposableReadOnlyCheckout = $providerWorkingPath
            [Console]::Out.WriteLine("AI_EVENT provider=$candidate state=sandbox-ready path=$disposableReadOnlyCheckout")
            [Console]::Out.Flush()
        }
        $providerGitBefore = (& git -C $providerWorkingPath status --porcelain=v1 --untracked-files=all | Out-String).TrimEnd()
        $providerContentBefore = if ($Mode -eq 'ReadOnly') { Get-ContentManifest -RootPath $providerWorkingPath } else { $null }

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
        [Console]::Out.WriteLine("AI_EVENT provider=$candidate state=started attempt=$($attempts.Count + 1) model=$candidateModel")
        [Console]::Out.Flush()

        if ($candidate -eq 'codex') {
            if ([bool]$env:OPENAI_API_KEY) {
                throw 'OPENAI_API_KEY is set. Subscription-only routing refuses to risk API billing.'
            }
            $command = (Get-Command codex).Source
            $arguments = @('exec', '--json', '--color', 'never', '-C', $providerWorkingPath, '-s', $sandbox, '-c', 'approval_policy="never"', '-')
            if ($CodexModel -and $CodexModel -ne 'default') { $arguments = @('exec', '--json', '--color', 'never', '-m', $CodexModel, '-C', $providerWorkingPath, '-s', $sandbox, '-c', 'approval_policy="never"', '-') }
            $processInput = $attemptPrompt
        }
        elseif ($candidate -eq 'claude') {
            if ([bool]$env:ANTHROPIC_API_KEY -or [bool]$env:ANTHROPIC_BASE_URL) {
                throw 'Anthropic API configuration is present. Subscription-only routing refuses to risk API billing.'
            }
            $command = (Get-Command claude).Source
            $arguments = @('-p', '--output-format', 'json', '--effort', 'high', '--permission-mode', $claudePermission)
            if ($ClaudeModel -and $ClaudeModel -ne 'default') { $arguments += @('--model', $ClaudeModel) }
            $processInput = $attemptPrompt
        }
        else {
            $command = (Get-Command hermes).Source
            $hermesPrompt = @"
Execute this controlled $Mode task now in the current repository.

Goal:
$taskGoal

Required workflow:
1. Read AGENTS.md first and obey it.
2. Use Graphify only for focused discovery, then verify claims in original repository files.
3. Use Serena only when symbol-level code inspection is necessary. Start with `mcp__serena__initial_instructions`; all exact Serena names start with `mcp__serena__`. Never invent shorter names.
4. Do not change files in ReadOnly mode. Never commit, push, merge or start follow-up work.
5. Continue until every requested output item is answered or a concrete blocker is found.

Final response requirements:
- Answer the goal directly and cite the original repository paths used.
- State whether Graphify and Serena were used or skipped, with one short reason each.
- State repository changes, risks and open gates.
$deliveryMetadataPolicy
- End the final line with exactly AI_PROJECT_TASK_COMPLETE when all requested items are answered.
- Otherwise end the final line with AI_PROJECT_TASK_BLOCKED: followed by the concrete reason.
- Do not offer a menu, ask what to inspect, or stop after a partial summary.
"@
            if ($hermesPrompt.Length -gt 24000) {
                throw 'The local Hermes prompt exceeds the safe Windows command-line budget. Narrow the task package or use Codex/Claude.'
            }
            $hermesPrompt | Set-Content -LiteralPath $attemptPromptPath -Encoding utf8
            # `-z` deliberately hides tool previews. The non-interactive chat query keeps
            # progress visible on stdout so the dashboard can stream it in real time.
            $hermesToolsets = if ($Mode -eq 'ReadOnly') { 'terminal,serena' } else { 'terminal,file,skills,todo,serena' }
            $arguments = @('chat', '-m', $OllamaModel, '-q', $hermesPrompt, '--provider', 'ollama-launch', '--source', 'tool', '--max-turns', '60', '--toolsets', $hermesToolsets)
            $arguments += @('--skills', 'controlled-project-development')
            $processInput = ''
        }

        $started = [DateTimeOffset]::Now
        $result = Invoke-CapturedProcess -FilePath $command -Arguments $arguments -InputText $processInput -Cwd $providerWorkingPath -ProviderName $candidate
        $finished = [DateTimeOffset]::Now
        $result.Stdout | Set-Content -LiteralPath (Join-Path $attemptDir 'stdout.log') -Encoding utf8
        $result.Stderr | Set-Content -LiteralPath (Join-Path $attemptDir 'stderr.log') -Encoding utf8
        $combined = $result.Stdout + "`n" + $result.Stderr
        $limited = $result.ExitCode -ne 0 -and (Test-UsageLimitFailure -Text $combined)
        $providerReportedFailure = $combined -match '(?im)(API call failed|Non-retryable (?:client )?error|HTTP [45][0-9]{2}:|Traceback \(most recent call last\)|Fatal error)'
        $completionText = $result.Stdout
        if ($candidate -eq 'ollama') {
            # `hermes chat -q` echoes the submitted query, which itself documents the
            # sentinel. Only the rendered final Hermes panel may confirm completion.
            $finalPanel = $result.Stdout.LastIndexOf([char]0x2695 + ' Hermes')
            $completionText = if ($finalPanel -ge 0) { $result.Stdout.Substring($finalPanel) } else { '' }
        }
        $completionConfirmed = $result.ExitCode -eq 0 -and -not $providerReportedFailure -and $completionText -match 'AI_PROJECT_TASK_COMPLETE'
        $blockedMatch = [regex]::Match($completionText, '(?im)^AI_PROJECT_TASK_BLOCKED:\s*(.+)$')
        $blockedConfirmed = $result.ExitCode -eq 0 -and -not $providerReportedFailure -and $blockedMatch.Success
        $blockedReason = if ($blockedConfirmed) { $blockedMatch.Groups[1].Value.Trim() } else { $null }
        # Codex and Claude may wrap the final response in JSON, so metadata values
        # stop at either a real line break or an escaped JSON boundary.
        $suggestedCommitMatch = [regex]::Match($completionText, '(?i)Suggested commit message:\s*`?([^\\\r\n"]{1,200})')
        $suggestedBranchMatch = [regex]::Match($completionText, '(?i)Suggested branch name:\s*(ai/[a-z0-9][a-z0-9-]{1,63})')
        $suggestedCommitMessage = $null
        if ($suggestedCommitMatch.Success) {
            $commitCandidate = $suggestedCommitMatch.Groups[1].Value.Trim().Trim('`')
            if ($commitCandidate.Length -gt 200) { $commitCandidate = $commitCandidate.Substring(0, 200) }
            if ($commitCandidate.Length -gt 0) { $suggestedCommitMessage = $commitCandidate }
        }
        $suggestedBranchName = if ($suggestedBranchMatch.Success) { $suggestedBranchMatch.Groups[1].Value.Trim() } else { $null }

        $gitAfter = (& git -C $providerWorkingPath status --porcelain=v1 --untracked-files=all | Out-String).TrimEnd()
        $providerDiffAfter = (& git -C $providerWorkingPath diff --no-ext-diff | Out-String)
        if ($Mode -eq 'ReadOnly') {
            $providerContentAfter = Get-ContentManifest -RootPath $providerWorkingPath
            $contentChanges = @(Compare-ContentManifest -Before $providerContentBefore -After $providerContentAfter)
            $repoChanged = $contentChanges.Count -gt 0
            if ($repoChanged) {
                $providerDiffAfter | Set-Content -LiteralPath (Join-Path $attemptDir 'read-only-violation.diff') -Encoding utf8
                $gitAfter | Set-Content -LiteralPath (Join-Path $attemptDir 'read-only-violation.status') -Encoding utf8
                [pscustomobject]@{
                    provider = $candidate
                    canonical_checkout = $workingPath
                    isolated_checkout = $providerWorkingPath
                    git_status_before = $providerGitBefore
                    git_status_after = $gitAfter
                    changes = $contentChanges
                } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $attemptDir 'read-only-violation.json') -Encoding utf8
            }
        }
        else {
            $repoChanged = $gitAfter -ne $providerGitBefore
        }
    }
    finally {
        if ($null -ne $disposableReadOnlyCheckout) {
            Remove-DisposableReadOnlyCheckout -SourcePath $workingPath -CheckoutPath $disposableReadOnlyCheckout -ExpectedParent $attemptDir
        }
    }

    $attempt = [pscustomobject]@{
        provider = $candidate
        model = $candidateModel
        exit_code = $result.ExitCode
        success = $completionConfirmed -and -not ($Mode -eq 'ReadOnly' -and $repoChanged)
        completion_sentinel = $completionConfirmed
        blocked_sentinel = $blockedConfirmed
        usage_limit_detected = $limited
        started_at = $started.ToString('o')
        finished_at = $finished.ToString('o')
        output_directory = $attemptDir
    }
    $attempts.Add($attempt)
    [Console]::Out.WriteLine("AI_EVENT provider=$candidate state=finished exit=$($result.ExitCode) complete=$completionConfirmed quota=$limited")
    [Console]::Out.Flush()

    if ($Mode -eq 'ReadOnly' -and $repoChanged) {
        [pscustomobject]@{
            status = 'FAIL'
            reason = 'Provider changed content during a read-only task.'
            selected_provider = $candidate
            selected_model = $candidateModel
            mode = $Mode
            repository_changed = $true
            content_changes = $contentChanges
            attempts = $attempts
            handoffs = $handoffs
            unavailable_providers = $unavailableProviders
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'routing-result.json') -Encoding utf8
        throw "Provider $candidate changed content during a read-only task. Automatic fallback and blocked completion were rejected; inspect $attemptDir."
    }
    if ($completionConfirmed) {
        [pscustomobject]@{
            status = 'PASS'
            selected_provider = $candidate
            selected_model = $candidateModel
            mode = $Mode
            repository_changed = $repoChanged
            suggested_commit_message = $suggestedCommitMessage
            suggested_branch_name = $suggestedBranchName
            attempts = $attempts
            handoffs = $handoffs
            unavailable_providers = $unavailableProviders
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'routing-result.json') -Encoding utf8
        Write-Output "AI_PROJECT_ROUTER_OK provider=$candidate run=$runDir"
        exit 0
    }

    if ($blockedConfirmed) {
        [pscustomobject]@{
            status = 'BLOCKED'
            reason = $blockedReason
            selected_provider = $candidate
            selected_model = $candidateModel
            mode = $Mode
            repository_changed = $repoChanged
            attempts = $attempts
            handoffs = $handoffs
            unavailable_providers = $unavailableProviders
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'routing-result.json') -Encoding utf8
        Write-Output "AI_PROJECT_ROUTER_BLOCKED provider=$candidate run=$runDir"
        exit 2
    }

    if ($result.ExitCode -eq 0 -and -not $completionConfirmed -and -not $limited) {
        [pscustomobject]@{
            status = 'FAIL'
            reason = 'Provider exited without the required completion sentinel.'
            selected_provider = $candidate
            selected_model = $candidateModel
            mode = $Mode
            attempts = $attempts
            handoffs = $handoffs
            unavailable_providers = $unavailableProviders
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'routing-result.json') -Encoding utf8
        throw "Provider $candidate exited without the required completion sentinel. Automatic fallback stopped; inspect $attemptDir."
    }
    if (-not $limited) {
        [pscustomobject]@{
            status = 'FAIL'
            reason = 'Provider failed for a non-quota reason.'
            selected_provider = $candidate
            selected_model = $candidateModel
            mode = $Mode
            attempts = $attempts
            handoffs = $handoffs
            unavailable_providers = $unavailableProviders
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'routing-result.json') -Encoding utf8
        throw "Provider $candidate failed for a non-quota reason. Automatic fallback stopped; inspect $attemptDir."
    }

    $continuesHandoffPath = if ($candidate -in @('codex', 'claude')) {
        New-ContinuesHandoffArtifact -SourceProvider $candidate -Cwd $providerWorkingPath -StartedAt $started -FinishedAt $finished -OutputDirectory $attemptDir
    }
    else { $null }
    $priorHandoffPath = $handoffPath
    $handoffPath = Join-Path $runDir ("handoff-{0}-to-next.md" -f $candidate)
    $diffPath = Join-Path $attemptDir 'working-tree.diff'
    $providerDiffAfter | Set-Content -LiteralPath $diffPath -Encoding utf8
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
- Minimal cli-continues session extract: $(if ($null -ne $continuesHandoffPath) { $continuesHandoffPath } else { 'not available; use the task package and process logs' })
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
        continues_handoff_path = $continuesHandoffPath
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
    selected_model = $selectedModel
    attempts = $attempts
    handoffs = $handoffs
    unavailable_providers = $unavailableProviders
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'routing-result.json') -Encoding utf8
throw "All allowed providers were exhausted. See $runDir"
