param([switch]$Open)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$executable = Join-Path $projectRoot 'build\server\Release\cat_shop_admin.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the project using build.ps1 first.' }
$existing = $null
try { $existing = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/admin/health' -TimeoutSec 2 } catch {}
if ($existing -and $existing.service -ne 'cat-shop-admin') { throw 'Port 8790 is occupied.' }
if (-not $existing) {
    $runDir = Join-Path $projectRoot '.run'
    [System.IO.Directory]::CreateDirectory($runDir) | Out-Null
    $process = Start-Process -FilePath $executable -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir 'admin.log') -RedirectStandardError (Join-Path $runDir 'admin-error.log') -PassThru
    @{pid=$process.Id;path=$executable} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'admin.json')
    $healthy = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        try { $result = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/admin/health' -TimeoutSec 1; if($result.ok){$healthy=$true;break} } catch {}
    }
    if (-not $healthy) { throw 'Admin did not start. Check .run/admin-error.log.' }
}
Write-Host 'Workbench ready: http://127.0.0.1:8790/'
Write-Host 'Local access key: .run/admin-access.key (start-admin.cmd signs you in automatically)'
if ($Open) {
    $accessKey = (Get-Content -LiteralPath (Join-Path $projectRoot '.run/admin-access.key') -Raw).Trim()
    Start-Process ("http://127.0.0.1:8790/#access=" + [uri]::EscapeDataString($accessKey))
}
