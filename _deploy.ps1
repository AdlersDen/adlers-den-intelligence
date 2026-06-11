# =============================================================
# Adlers Den - one-shot Vercel deploy helper
#
# Run from the project root in PowerShell:
#     .\_deploy.ps1
#
# What it does:
#   1. Verifies you are logged into Vercel (prompts login if not)
#   2. Pushes all 6 API keys from .env.local to the Vercel project
#      (Production environment), replacing any existing values
#   3. Builds + deploys to production and prints the live URL
#
# Re-run any time to redeploy.
# =============================================================

# NOTE: do NOT set $ErrorActionPreference = 'Stop' here. In Windows
# PowerShell 5.1 that turns a native command's stderr (e.g. vercel's
# "Not authorized" message) into a terminating error, which would abort
# this script at the login check. We check exit codes explicitly instead.
$ErrorActionPreference = 'Continue'
$envFile = '.env.local'
$keys = @(
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'SERP_API_KEY',
  'BROWSERLESS_API_KEY',
  'WC_CONSUMER_KEY',
  'WC_CONSUMER_SECRET'
)

Write-Host ""
Write-Host "=== Adlers Den -> Vercel deploy ===" -ForegroundColor Cyan
Write-Host ""

# 1. Auth check - use exit code, not stderr parsing (5.1-safe)
Write-Host "[1/3] Checking Vercel login..." -ForegroundColor Yellow
$who = npx vercel whoami 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($who)) {
  Write-Host "  Not logged in. Launching vercel login - follow the browser prompt." -ForegroundColor Yellow
  npx vercel login
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  Login failed or was cancelled. Re-run .\_deploy.ps1 after logging in." -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "  Logged in as: $who" -ForegroundColor Green
}

# 2. Ensure the project is linked under THIS account.
#    A pre-existing .vercel may point at a team/project you cannot access
#    (that was the "Could not retrieve Project Settings" error). Probe the
#    link; if it fails, remove the stale .vercel and link fresh.
Write-Host ""
Write-Host "[2/4] Verifying project link..." -ForegroundColor Yellow
npx vercel pull --yes --environment=production *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "  Link missing or inaccessible - relinking under your account." -ForegroundColor Yellow
  if (Test-Path .vercel) { Remove-Item -Recurse -Force .vercel }
  Write-Host "  Answer the prompts: confirm setup, pick your scope, do NOT link to" -ForegroundColor Yellow
  Write-Host "  an existing project (choose 'no'), accept the default name + ./ dir." -ForegroundColor Yellow
  npx vercel link
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  Linking failed. Re-run .\_deploy.ps1 to try again." -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "  Project link OK." -ForegroundColor Green
}

# 3. Parse .env.local and push each key to Production (honest reporting)
Write-Host ""
Write-Host "[3/4] Pushing environment variables to Production..." -ForegroundColor Yellow
$envMap = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
    $envMap[$matches[1]] = $matches[2].Trim('"').Trim("'")
  }
}

$pushed = 0
foreach ($k in $keys) {
  $val = $envMap[$k]
  if ([string]::IsNullOrWhiteSpace($val)) {
    Write-Host "  ! $k is empty in $envFile - skipping" -ForegroundColor Red
    continue
  }
  # Remove any existing value first (ok if absent), then add fresh.
  npx vercel env rm $k production -y *> $null
  $val | npx vercel env add $k production *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  + $k" -ForegroundColor Green
    $pushed++
  } else {
    Write-Host "  x $k FAILED to push" -ForegroundColor Red
  }
}
Write-Host "  ($pushed of $($keys.Count) variables pushed)" -ForegroundColor Cyan

# 4. Deploy to production
Write-Host ""
Write-Host "[4/4] Deploying to production..." -ForegroundColor Yellow
npx vercel --prod
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Deploy failed. See the error above." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "=== Done. The production URL is printed above. ===" -ForegroundColor Cyan
Write-Host "Share that URL - it is the live tool." -ForegroundColor Cyan
Write-Host ""
