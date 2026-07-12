[CmdletBinding()]
param(
    [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$requirements = @(
    @{ Name = 'Node.js LTS'; Command = 'node.exe'; Package = 'OpenJS.NodeJS.LTS' },
    @{ Name = 'Git'; Command = 'git.exe'; Package = 'Git.Git' },
    @{ Name = 'PowerShell 7'; Command = 'pwsh.exe'; Package = 'Microsoft.PowerShell' }
)

if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw 'Windows Package Manager (winget) fehlt. Installiere zuerst Microsoft App Installer und starte bootstrap.ps1 erneut.'
}

$missing = @($requirements | Where-Object { -not (Get-Command $_.Command -ErrorAction SilentlyContinue) })
if ($missing.Count -gt 0) {
    Write-Host 'AI Project Control benötigt:' -ForegroundColor Cyan
    $missing | ForEach-Object { Write-Host ("- {0}" -f $_.Name) }
    $answer = Read-Host 'Fehlende Basis jetzt über winget installieren? [J/N]'
    if ($answer -notmatch '^(j|ja|y|yes)$') { throw 'Einrichtung wurde ohne Änderungen beendet.' }
    foreach ($requirement in $missing) {
        Write-Host ("Installiere {0}..." -f $requirement.Name) -ForegroundColor Cyan
        & winget.exe install --id $requirement.Package --exact --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw ("Installation von {0} ist fehlgeschlagen." -f $requirement.Name) }
    }
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
    $nodeCandidate = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path -LiteralPath $nodeCandidate) { $node = Get-Item -LiteralPath $nodeCandidate }
}
if (-not $node) { throw 'Node.js wurde installiert, ist aber in dieser Sitzung noch nicht erreichbar. Öffne ein neues Terminal und starte bootstrap.ps1 erneut.' }
$nodePath = if ($node.PSObject.Properties.Name -contains 'Source') { $node.Source } else { $node.FullName }

if (-not $NoStart) {
    Start-Process -FilePath $nodePath -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden
    Write-Host 'AI Project Control läuft unter http://127.0.0.1:8765/' -ForegroundColor Green
}
