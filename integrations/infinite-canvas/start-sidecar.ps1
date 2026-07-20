param(
  [Parameter(Mandatory = $true)]
  [string]$UpstreamDir,

  [Parameter(Mandatory = $true)]
  [string]$StagingDir,

  [string]$ArchivePath,

  [ValidateRange(1024, 65535)]
  [int]$Port = 7862
)

$ErrorActionPreference = 'Stop'
$resolvedUpstream = (Resolve-Path -LiteralPath $UpstreamDir).Path
$entrypoint = Join-Path $resolvedUpstream 'main.py'
if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) {
  throw "Infinite-Canvas main.py was not found under the supplied checkout."
}
$manifest = Get-Content -Raw (Join-Path $PSScriptRoot 'upstream.json') | ConvertFrom-Json
$gitMetadata = Join-Path $resolvedUpstream '.git'
if (Test-Path -LiteralPath $gitMetadata) {
  $actualCommit = (& git -C $resolvedUpstream rev-parse HEAD 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $manifest.pinnedCommit) {
    throw "Infinite-Canvas checkout HEAD does not match pinned commit $($manifest.pinnedCommit)."
  }
} else {
  if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
    throw "ArchivePath is required when the pinned source is not a Git checkout."
  }
  $resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
  $archiveHash = (Get-FileHash -LiteralPath $resolvedArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($archiveHash -ne $manifest.archiveSha256) {
    throw "Infinite-Canvas archive SHA-256 does not match the reviewed manifest."
  }
  if ((Split-Path -Leaf $resolvedUpstream) -ne $manifest.archiveRoot) {
    throw "Infinite-Canvas archive root does not match the reviewed manifest."
  }
}
if ([string]::IsNullOrWhiteSpace($env:INFINITE_CANVAS_GATEWAY_TOKEN) -or $env:INFINITE_CANVAS_GATEWAY_TOKEN.Length -lt 32) {
  throw "Set INFINITE_CANVAS_GATEWAY_TOKEN to a random value of at least 32 characters."
}

$env:INFINITE_CANVAS_UPSTREAM_DIR = $resolvedUpstream
$resolvedStaging = [IO.Path]::GetFullPath($StagingDir)
New-Item -ItemType Directory -Force -Path $resolvedStaging | Out-Null
$env:INFINITE_CANVAS_STAGING_DIR = $resolvedStaging
$runner = Join-Path $PSScriptRoot 'sidecar\run.py'
python $runner --port $Port
