$ErrorActionPreference = 'Stop'
$statePath = Join-Path $PSScriptRoot '.run\admin.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host 'Admin is not running.'; exit 0 }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
$expected = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'build\server\Release\cat_shop_admin.exe'))
if ($process -and $process.Path -eq $expected) { Stop-Process -Id $process.Id; Write-Host 'Admin stopped.' }
elseif ($process) { throw 'Process identity changed; no process was stopped.' }
Remove-Item -LiteralPath $statePath
