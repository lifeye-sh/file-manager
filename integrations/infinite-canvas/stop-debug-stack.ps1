param(
  [string]$RuntimeBase = (Join-Path $env:LOCALAPPDATA 'FileManager\Infinite-Canvas')
)

foreach ($pidName in 'file-manager.pid', 'sidecar.pid', 'upstream.pid') {
  $pidPath = Join-Path $RuntimeBase $pidName
  if (-not (Test-Path -LiteralPath $pidPath)) { continue }
  $processId = [int](Get-Content -LiteralPath $pidPath)
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

# Older script versions recorded a PowerShell wrapper instead of the Python
# adapter. Bound the cleanup to the integration's two loopback ports.
netstat -ano -p tcp | Select-String -Pattern '^\s*TCP\s+127\.0\.0\.1:(7862|7863)\s+.*LISTENING\s+(\d+)\s*$' |
  ForEach-Object {
    if ($_.Matches.Count) {
      Stop-Process -Id ([int]$_.Matches[0].Groups[2].Value) -Force -ErrorAction SilentlyContinue
    }
  }
