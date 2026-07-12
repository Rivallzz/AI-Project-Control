[CmdletBinding()]
param([int]$Port = 8765)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$healthUrl = "http://127.0.0.1:$Port/api/health"
try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
}
catch {
    Write-Output 'AI_PROJECT_CONTROL_NOT_RUNNING'
    exit 0
}

$process = Get-Process -Id ([int]$health.pid) -ErrorAction Stop
if ($process.ProcessName -ne 'node') {
    throw "Refusing to stop unexpected process $($process.ProcessName) with PID $($process.Id)."
}
Stop-Process -Id $process.Id
Write-Output "AI_PROJECT_CONTROL_STOPPED pid=$($process.Id)"
