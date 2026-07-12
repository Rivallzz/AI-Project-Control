[CmdletBinding()]
param([int]$Port = 8765)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$dataRoot = if ($env:AI_PROJECT_CONTROL_DATA) { $env:AI_PROJECT_CONTROL_DATA } else { Join-Path $env:LOCALAPPDATA 'AI Project Control' }
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
$pidFile = Join-Path $dataRoot 'dashboard.pid.json'
$stdout = Join-Path $dataRoot 'dashboard.stdout.log'
$stderr = Join-Path $dataRoot 'dashboard.stderr.log'
$healthUrl = "http://127.0.0.1:$Port/api/health"

try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.status -eq 'ok') {
        Write-Output "AI_PROJECT_CONTROL_ALREADY_RUNNING $healthUrl"
        exit 0
    }
}
catch {
}

$env:AI_PROJECT_CONTROL_PORT = [string]$Port
$process = Start-Process -FilePath 'node.exe' -ArgumentList (Join-Path $root 'server.js') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
[pscustomobject]@{
    pid = $process.Id
    started_at = [DateTimeOffset]::Now.ToString('o')
    url = $healthUrl.Replace('/api/health', '')
} | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding utf8

for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        if ($health.status -eq 'ok') {
            Write-Output "AI_PROJECT_CONTROL_READY $($healthUrl.Replace('/api/health', ''))"
            exit 0
        }
    }
    catch {
    }
}

throw "Dashboard did not become ready. Check $stderr"
