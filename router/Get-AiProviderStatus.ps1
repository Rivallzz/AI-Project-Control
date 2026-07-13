[CmdletBinding()]
param(
    [switch]$Json,
    [string]$CodexHome = (Join-Path $env:USERPROFILE '.codex'),
    [string]$StatePath = (Join-Path (Join-Path $env:LOCALAPPDATA 'AI Project Control') 'provider-state.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-ObjectProperty {
    param([object]$Object, [string]$Name)

    return $null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]
}

function Get-ObjectPropertyValue {
    param([object]$Object, [string]$Name)

    if (-not (Test-ObjectProperty -Object $Object -Name $Name)) { return $null }
    return $Object.PSObject.Properties[$Name].Value
}

function Convert-ResetTime {
    param([object]$Epoch)

    if ($null -eq $Epoch) {
        return $null
    }

    $value = [long]$Epoch
    return [DateTimeOffset]::FromUnixTimeSeconds($value)
}

function Get-LatestCodexRateLimit {
    param([string]$CodexRoot)

    $sessions = Join-Path $CodexRoot 'sessions'
    if (-not (Test-Path -LiteralPath $sessions)) {
        return $null
    }

    $files = Get-ChildItem -LiteralPath $sessions -Recurse -File -Filter '*.jsonl' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 20
    $latest = $null

    foreach ($file in $files) {
        $stream = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $readLength = [int][Math]::Min($stream.Length, 16MB)
            [void]$stream.Seek(-$readLength, [System.IO.SeekOrigin]::End)
            $buffer = [byte[]]::new($readLength)
            $actualLength = $stream.Read($buffer, 0, $readLength)
            $tailText = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $actualLength)
        }
        finally {
            $stream.Dispose()
        }

        $lines = $tailText -split "`r?`n"
        for ($index = $lines.Count - 1; $index -ge 0; $index--) {
            $line = $lines[$index]
            try {
                $event = $line | ConvertFrom-Json
            }
            catch {
                continue
            }

            if (
                -not (Test-ObjectProperty $event 'type') -or
                $event.type -ne 'event_msg' -or
                -not (Test-ObjectProperty $event 'payload') -or
                -not (Test-ObjectProperty $event.payload 'type') -or
                $event.payload.type -ne 'token_count'
            ) {
                continue
            }

            if (-not (Test-ObjectProperty $event.payload 'rate_limits')) {
                continue
            }
            $limits = $event.payload.rate_limits
            if ($null -eq $limits -or $limits.limit_id -ne 'codex') {
                continue
            }

            $candidate = [pscustomobject]@{
                Timestamp = [DateTimeOffset]::Parse(
                    [string]$event.timestamp,
                    [System.Globalization.CultureInfo]::InvariantCulture,
                    [System.Globalization.DateTimeStyles]::RoundtripKind
                )
                Limits = $limits
                Source = $file.FullName
            }
            if ($null -eq $latest -or $candidate.Timestamp -gt $latest.Timestamp) {
                $latest = $candidate
            }
            break
        }
    }

    return $latest
}

function Get-CodexStatus {
    $command = Get-Command codex -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return [pscustomobject]@{ available = $false; reason = 'codex command not found' }
    }

    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $loginText = (& codex login status 2>&1 | Out-String).Trim()
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    $chatGptAuth = $loginText -match 'ChatGPT'
    $latest = Get-LatestCodexRateLimit -CodexRoot $CodexHome
    if ($null -eq $latest) {
        return [pscustomobject]@{
            available = $chatGptAuth
            authenticated_with_chatgpt = $chatGptAuth
            quota_known = $false
            reason = 'No recent Codex rate-limit event was found.'
        }
    }

    $now = [DateTimeOffset]::Now
    $primary = Get-ObjectPropertyValue -Object $latest.Limits -Name 'primary'
    $secondary = Get-ObjectPropertyValue -Object $latest.Limits -Name 'secondary'
    $primaryReset = Convert-ResetTime (Get-ObjectPropertyValue -Object $primary -Name 'resets_at')
    $secondaryReset = Convert-ResetTime (Get-ObjectPropertyValue -Object $secondary -Name 'resets_at')
    $primaryUsedValue = Get-ObjectPropertyValue -Object $primary -Name 'used_percent'
    $secondaryUsedValue = Get-ObjectPropertyValue -Object $secondary -Name 'used_percent'
    $primaryUsed = if ($null -ne $primaryUsedValue) { [double]$primaryUsedValue } else { 0.0 }
    $secondaryUsed = if ($null -ne $secondaryUsedValue) { [double]$secondaryUsedValue } else { $null }

    if ($null -ne $primaryReset -and $now -ge $primaryReset) {
        $primaryUsed = 0
    }
    if ($null -ne $secondaryUsed -and $null -ne $secondaryReset -and $now -ge $secondaryReset) {
        $secondaryUsed = 0
    }

    $available = $chatGptAuth -and $primaryUsed -lt 100 -and ($null -eq $secondaryUsed -or $secondaryUsed -lt 100)
    return [pscustomobject]@{
        available = $available
        authenticated_with_chatgpt = $chatGptAuth
        quota_known = $true
        primary_used_percent = $primaryUsed
        primary_window_minutes = Get-ObjectPropertyValue -Object $primary -Name 'window_minutes'
        primary_resets_local = if ($null -ne $primaryReset) { $primaryReset.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss zzz') } else { $null }
        secondary_used_percent = $secondaryUsed
        secondary_window_minutes = Get-ObjectPropertyValue -Object $secondary -Name 'window_minutes'
        secondary_resets_local = if ($null -ne $secondaryReset) { $secondaryReset.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss zzz') } else { $null }
        rate_limit_reached_type = Get-ObjectPropertyValue -Object $latest.Limits -Name 'rate_limit_reached_type'
        credits = Get-ObjectPropertyValue -Object $latest.Limits -Name 'credits'
        observed_at = $latest.Timestamp.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss zzz')
        source = $latest.Source
    }
}

function Get-ClaudeStatus {
    $command = Get-Command claude -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return [pscustomobject]@{ available = $false; reason = 'claude command not found' }
    }

    if ([bool]$env:ANTHROPIC_API_KEY -or [bool]$env:ANTHROPIC_BASE_URL) {
        return [pscustomobject]@{
            available = $false
            paid_api_guard = 'BLOCKED'
            reason = 'ANTHROPIC_API_KEY or ANTHROPIC_BASE_URL is set; subscription-only routing refuses this configuration.'
        }
    }

    try {
        $auth = (& claude auth status 2>$null | Out-String) | ConvertFrom-Json
    }
    catch {
        return [pscustomobject]@{ available = $false; reason = 'Claude auth status could not be parsed.' }
    }

    $subscription = [string]$auth.subscriptionType
    $subscriptionAuth = [bool]$auth.loggedIn -and [string]$auth.authMethod -eq 'claude.ai' -and $subscription -in @('pro', 'max', 'team', 'enterprise')
    $retryNotBefore = $null
    if (Test-Path -LiteralPath $StatePath) {
        try {
            $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
            if ($null -ne $state.claude_retry_not_before) {
                $retryNotBefore = [DateTimeOffset]::Parse([string]$state.claude_retry_not_before)
            }
        }
        catch {
            $retryNotBefore = $null
        }
    }

    $backoffActive = $null -ne $retryNotBefore -and [DateTimeOffset]::Now -lt $retryNotBefore
    return [pscustomobject]@{
        available = $subscriptionAuth -and -not $backoffActive
        authenticated_with_subscription = $subscriptionAuth
        subscription_type = $subscription
        paid_api_guard = 'PASS'
        exact_reset_known = $false
        retry_not_before_local = if ($backoffActive) { $retryNotBefore.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss zzz') } else { $null }
        note = 'Claude exposes the exact reset in interactive /status or a limit message, not through claude auth status.'
    }
}

function Get-OllamaStatus {
    $command = Get-Command ollama -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return [pscustomobject]@{ available = $false; reason = 'ollama command not found' }
    }

    $models = (& ollama list 2>$null | Out-String)
    $hasModel = $models -match '(?m)^polis-coder(?::latest)?\s'
    return [pscustomobject]@{
        available = $hasModel
        model = 'polis-coder'
        local_only = $true
        reason = if ($hasModel) { $null } else { 'polis-coder model not found' }
    }
}

$result = [pscustomobject]@{
    observed_at = [DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz')
    routing_priority = @('codex', 'claude', 'ollama')
    subscription_only = $true
    codex = Get-CodexStatus
    claude = Get-ClaudeStatus
    ollama = Get-OllamaStatus
}

if ($Json) {
    $result | ConvertTo-Json -Depth 8
    exit 0
}

$result | Format-List
$result.codex | Format-List
$result.claude | Format-List
$result.ollama | Format-List
