$ErrorActionPreference = "Stop"

Write-Host "== Gate: changed-files eslint + build =="

$changed = @()
$changed += (git diff --name-only --diff-filter=ACMRT --relative)
$changed += (git diff --cached --name-only --diff-filter=ACMRT --relative)
$changed = $changed | Sort-Object -Unique

$eslintTargets = $changed | Where-Object { $_ -match '\.(ts|tsx|js|jsx)$' }

if ($eslintTargets.Count -gt 0) {
  Write-Host "Running eslint for changed files:"
  $eslintTargets | ForEach-Object { Write-Host " - $_" }
  npx eslint $eslintTargets
} else {
  Write-Host "No JS/TS changes detected. Skipping eslint."
}

npm run build
Write-Host "== Gate passed ✅ =="
