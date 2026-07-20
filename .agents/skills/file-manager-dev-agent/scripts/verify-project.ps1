param(
  [ValidateSet('Full', 'Syntax')]
  [string]$Mode = 'Full',
  [string]$ProjectRoot = ''
)

$ErrorActionPreference = 'Stop'

if (-not $ProjectRoot) {
  $ProjectRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\..\..\..')
  )
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'package.json'))) {
  throw "package.json not found under project root: $ProjectRoot"
}

Push-Location $ProjectRoot
try {
  $failures = [System.Collections.Generic.List[string]]::new()

  Write-Output '[verify] JavaScript syntax'
  $jsFiles = @(rg --files -g '*.js' -g '!node_modules' -g '!.aiworkbench')
  foreach ($file in $jsFiles) {
    & node --check $file
    if ($LASTEXITCODE -ne 0) {
      $failures.Add("JavaScript syntax: $file")
    }
  }

  if ($Mode -eq 'Full') {
    Write-Output '[verify] Dependency tree'
    & npm ls --depth=0
    if ($LASTEXITCODE -ne 0) {
      $failures.Add('npm dependency tree')
    }

    Write-Output '[verify] Merge conflict markers'
    $conflicts = @(
      rg -n --no-ignore '^(<<<<<<<|=======|>>>>>>>)' `
        -g '!node_modules/**' -g '!.git/**' -g '!.aiworkbench/**' .
    )
    if ($LASTEXITCODE -eq 0 -and $conflicts.Count -gt 0) {
      $conflicts | ForEach-Object { Write-Output $_ }
      $failures.Add('merge conflict markers')
    } elseif ($LASTEXITCODE -gt 1) {
      $failures.Add('merge marker scan')
    }

    Write-Output '[verify] Whitespace and patch integrity'
    & git diff --check
    if ($LASTEXITCODE -ne 0) {
      $failures.Add('git diff --check')
    }

    Write-Output '[verify] Working tree'
    & git status --short
  }

  if ($failures.Count -gt 0) {
    Write-Output ('[verify] FAILED: ' + ($failures -join ', '))
    exit 1
  }

  Write-Output ("[verify] PASSED ($Mode)")
} finally {
  Pop-Location
}
