param([switch]$Lan, [switch]$Open)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$executable = Join-Path $projectRoot 'build\server\Release\cat_shop_server.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the project using build.ps1 first.' }
$existing = $null
try { $existing = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2 } catch {}
if ($existing) {
    if ($existing.service -ne 'cat-shop-cpp') { throw 'Port 8787 is being used by another application.' }
    Write-Host 'Game is already running: http://127.0.0.1:8787'
} else {
    $runDir = Join-Path $projectRoot '.run'
    [System.IO.Directory]::CreateDirectory($runDir) | Out-Null
    $bindAddress = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
    $process = Start-Process -FilePath $executable -ArgumentList @('--bind',$bindAddress,'--port','8787','--web','client/dist') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir 'server.log') -RedirectStandardError (Join-Path $runDir 'server-error.log') -PassThru
    @{pid=$process.Id;path=$executable;bind=$bindAddress} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'server.json')
    $healthy = $false
    for($attempt=0;$attempt -lt 30;$attempt++){
        Start-Sleep -Milliseconds 200
        try { $result = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 1; if($result.ok){$healthy=$true;break} } catch {}
    }
    if(-not $healthy){throw 'Game did not start. Check .run/server-error.log.'}
    Write-Host 'Game ready: http://127.0.0.1:8787'
    if($Lan){
        Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.PrefixOrigin -ne 'WellKnown' } | ForEach-Object { Write-Host ("LAN: http://{0}:8787" -f $_.IPAddress) }
    }
}
if($Open){Start-Process 'http://127.0.0.1:8787'}
