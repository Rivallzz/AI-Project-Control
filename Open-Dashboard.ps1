[CmdletBinding()]
param([int]$Port = 8765)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'Start-Dashboard.ps1') -Port $Port
Start-Process "http://127.0.0.1:$Port/"
