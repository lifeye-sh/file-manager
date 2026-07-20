param(
  [string]$ComfyUiUrl = 'http://192.168.3.34:8870',
  [string]$RuntimeBase = (Join-Path $env:LOCALAPPDATA 'FileManager\Infinite-Canvas')
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$manifest = Get-Content -Raw (Join-Path $PSScriptRoot 'upstream.json') | ConvertFrom-Json
$source = Join-Path $RuntimeBase "upstream-archive-$($manifest.pinnedCommit)\$($manifest.archiveRoot)"
$archive = Join-Path $RuntimeBase "$($manifest.pinnedCommit).zip"
$runtime = Join-Path $RuntimeBase 'runtime'
$staging = Join-Path $RuntimeBase 'staging'

foreach ($pidName in 'file-manager.pid', 'sidecar.pid', 'upstream.pid') {
  $pidPath = Join-Path $RuntimeBase $pidName
  if (Test-Path -LiteralPath $pidPath) {
    $oldPid = [int](Get-Content -LiteralPath $pidPath)
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
  }
}
netstat -ano -p tcp | Select-String -Pattern '^\s*TCP\s+127\.0\.0\.1:(7862|7863)\s+.*LISTENING\s+(\d+)\s*$' |
  ForEach-Object {
    if ($_.Matches.Count) {
      Stop-Process -Id ([int]$_.Matches[0].Groups[2].Value) -Force -ErrorAction SilentlyContinue
    }
  }

New-Item -ItemType Directory -Force -Path $RuntimeBase, $runtime, $staging | Out-Null
$tokenBytes = New-Object byte[] 48
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $random.GetBytes($tokenBytes)
} finally {
  $random.Dispose()
}
$env:INFINITE_CANVAS_GATEWAY_TOKEN = [Convert]::ToBase64String($tokenBytes)
$env:INFINITE_CANVAS_UPSTREAM_DIR = $source
$env:INFINITE_CANVAS_STAGING_DIR = $staging

$logs = @{}
foreach ($name in 'sidecar.out', 'sidecar.err', 'upstream.out', 'upstream.err', 'file-manager.out', 'file-manager.err') {
  $logs[$name] = Join-Path $RuntimeBase "$name.log"
  Remove-Item -LiteralPath $logs[$name] -Force -ErrorAction SilentlyContinue
}

$sidecar = Start-Process python.exe -ArgumentList @(
  (Join-Path $PSScriptRoot 'sidecar\run.py'), '--port', '7862'
) -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $logs['sidecar.out'] -RedirectStandardError $logs['sidecar.err'] -PassThru

$upstream = Start-Process python.exe -ArgumentList @(
  (Join-Path $PSScriptRoot 'upstream-runner.py'), '--source', $source, '--runtime', $runtime,
  '--port', '7863', '--comfyui', $ComfyUiUrl
) -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $logs['upstream.out'] -RedirectStandardError $logs['upstream.err'] -PassThru

$fileManager = Start-Process (Get-Command node).Source -ArgumentList @('server.js', '--bind=127.0.0.1') `
  -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $logs['file-manager.out'] `
  -RedirectStandardError $logs['file-manager.err'] -PassThru

Set-Content -LiteralPath (Join-Path $RuntimeBase 'sidecar.pid') -Value $sidecar.Id -Encoding ascii
Set-Content -LiteralPath (Join-Path $RuntimeBase 'upstream.pid') -Value $upstream.Id -Encoding ascii
Set-Content -LiteralPath (Join-Path $RuntimeBase 'file-manager.pid') -Value $fileManager.Id -Encoding ascii

$headers = @{ 'X-File-Manager-Gateway-Token' = $env:INFINITE_CANVAS_GATEWAY_TOKEN }
$adapter = $null
$canvas = $null
$main = $null
$lastError = ''
for ($attempt = 1; $attempt -le 30; $attempt++) {
  try {
    if ($sidecar.HasExited -or $upstream.HasExited -or $fileManager.HasExited) {
      throw 'A debug stack process exited before becoming healthy.'
    }
    $adapter = Invoke-RestMethod 'http://127.0.0.1:7862/health' -Headers $headers -TimeoutSec 5
    $canvas = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:7863/' -Headers $headers -TimeoutSec 5
    $main = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000/api/csrf-token' -TimeoutSec 5
    if ($adapter.ok -and $canvas.StatusCode -eq 200 -and $main.StatusCode -eq 200) {
      break
    }
  } catch {
    $lastError = $_.Exception.Message
  }
  if ($attempt -lt 30) { Start-Sleep -Seconds 2 }
}
if (-not $adapter.ok -or $canvas.StatusCode -ne 200 -or $main.StatusCode -ne 200) {
  $tails = foreach ($name in 'sidecar.err', 'upstream.err', 'file-manager.err') {
    $logPath = $logs[$name]
    if (Test-Path -LiteralPath $logPath) {
      "$name`n$((Get-Content -LiteralPath $logPath -Tail 20) -join "`n")"
    }
  }
  throw "Infinite-Canvas debug stack health check failed: $lastError`n$($tails -join "`n")"
}

[pscustomobject]@{
  FileManagerPid = $fileManager.Id
  AdapterPid = $sidecar.Id
  UpstreamPid = $upstream.Id
  UpstreamCommit = $adapter.upstreamCommit
  UpstreamVersion = $adapter.version
  ComfyUiUrl = $ComfyUiUrl
}
