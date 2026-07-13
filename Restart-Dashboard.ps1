[CmdletBinding()]
param([int]$Port = 8765)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'Stop-Dashboard.ps1') -Port $Port
& (Join-Path $PSScriptRoot 'Open-Dashboard.ps1') -Port $Port
