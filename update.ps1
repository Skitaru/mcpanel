# =============================================================================
#  MCPanel — Update Script (PowerShell)
#  Baut, deployed und startet Services neu. ~15-30 Sekunden.
#
#  Verwendung:
#    .\update.ps1                          # Standard-Update
#    .\update.ps1 -Server "root@1.2.3.4"   # Anderer Server
#    .\update.ps1 -Quick                   # Nur rebuild ohne npm install
#    .\update.ps1 -Help                    # Hilfe anzeigen
# =============================================================================
param(
  [string]$Server   = "root@84.234.99.121",
  [string]$Deploy   = "/opt/mcpanel",
  [int]$Port        = 3000,
  [int]$FePort      = 3001,
  [string]$Domain   = "84.234.99.121",
  [switch]$Quick,   # Skip npm install (assumes deps unchanged)
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$TarFile = "$env:TEMP\mcpanel-update.tar.gz"

# ── Help ──────────────────────────────────────────────────────────
if ($Help) {
  Write-Host @"

  MCPanel Update Script

  Usage: .\update.ps1 [OPTIONS]

  Options:
    -Server  STRING   SSH target (default: root@84.234.99.121)
    -Deploy  STRING   Server directory (default: /opt/mcpanel)
    -Port    INT      Backend port (default: 3000)
    -FePort  INT      Frontend port (default: 3001)
    -Domain  STRING   Public IP/domain for frontend API URL
    -Quick            Skip npm install — only rebuild
    -Help             This help text

  Examples:
    .\update.ps1
    .\update.ps1 -Server "root@my-server.com" -Domain "mc.example.com"
    .\update.ps1 -Quick

"@ -ForegroundColor White
  exit 0
}

# ── Banner ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  MCPanel Updater" -ForegroundColor Cyan
Write-Host "  $(('─' * 50))" -ForegroundColor DarkGray
Write-Host "  Target  : $Server" -ForegroundColor Gray
Write-Host "  Path    : $Deploy" -ForegroundColor Gray
Write-Host "  Mode    : $(if ($Quick) { 'Quick (skip npm install)' } else { 'Full (npm install + build)' })" -ForegroundColor Gray
Write-Host ""

# ── Confirm ───────────────────────────────────────────────────────
$confirm = Read-Host "  Proceed? [Y/n]"
if ($confirm -ne "" -and $confirm -notmatch "^[yY]") {
  Write-Host "  Cancelled." -ForegroundColor Yellow
  exit 0
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()

# ── Step 1: Pack & Upload ─────────────────────────────────────────
Write-Host "[1/4] Packing & uploading…" -ForegroundColor Cyan -NoNewline

try {
  Set-Location $PSScriptRoot

  # Pack project (exclude build artifacts and dev files)
  $excludes = @(
    "--exclude=node_modules",
    "--exclude=dist",
    "--exclude=.next",
    "--exclude=data",
    "--exclude=.git",
    "--exclude=.deepcode",
    "--exclude=*.tar.gz"
  )
  $tarArgs = @("czf", $TarFile) + $excludes + @(".")
  & tar $tarArgs 2>$null

  if (-not (Test-Path $TarFile)) {
    throw "tar failed — is tar installed? (Windows 10 1803+ or Git Bash)"
  }

  $sizeMB = [math]::Round((Get-Item $TarFile).Length / 1MB, 1)
  Write-Host "`r[1/4] Packed ${sizeMB}MB, uploading…" -ForegroundColor Cyan -NoNewline

  scp -q $TarFile ${Server}:/tmp/ 2>$null
  if ($LASTEXITCODE -ne 0) { throw "SCP upload failed — check SSH connection to $Server" }

  Write-Host "`r[1/4] Uploaded ${sizeMB}MB                    " -ForegroundColor Green
} catch {
  Write-Host "`r[1/4] FAILED: $_" -ForegroundColor Red
  Remove-Item $TarFile -Force -ErrorAction SilentlyContinue
  exit 1
}

# ── Step 2: Extract ────────────────────────────────────────────────
Write-Host "[2/4] Extracting on server…" -ForegroundColor Cyan -NoNewline

try {
  $extractResult = ssh $Server "tar xzf /tmp/mcpanel-update.tar.gz -C $Deploy 2>&1 && rm /tmp/mcpanel-update.tar.gz && echo OK" 2>&1
  if ($LASTEXITCODE -ne 0) { throw $extractResult }

  Write-Host "`r[2/4] Extracted                           " -ForegroundColor Green
} catch {
  Write-Host "`r[2/4] FAILED: $_" -ForegroundColor Red
  Remove-Item $TarFile -Force -ErrorAction SilentlyContinue
  exit 1
}

# ── Step 3: Build & Restart ───────────────────────────────────────
Write-Host "[3/4] Building on server…" -ForegroundColor Cyan

try {
  if ($Quick) {
    # Quick mode: just rebuild, skip npm install
    $buildCmd = "cd $Deploy && npx tsc 2>&1 && cd frontend && NEXT_PUBLIC_API_URL=http://${Domain}:${Port} npx next build 2>&1"
  } else {
    # Full mode: install + build
    $buildCmd = "cd $Deploy && npm install --silent 2>&1 && npx tsc 2>&1 && cd frontend && npm install --silent 2>&1 && NEXT_PUBLIC_API_URL=http://${Domain}:${Port} npx next build 2>&1"
  }

  # Stream build output in real-time
  ssh $Server $buildCmd

  if ($LASTEXITCODE -ne 0) {
    throw "Build failed on server — check output above"
  }

  # Restart services
  Write-Host "[4/4] Restarting services…" -ForegroundColor Cyan -NoNewline
  $restartResult = ssh $Server "systemctl restart mcpanel-backend mcpanel-frontend 2>&1 && echo OK" 2>&1
  if ($LASTEXITCODE -ne 0) { throw $restartResult }

  Write-Host "`r[4/4] Services restarted                  " -ForegroundColor Green
} catch {
  Write-Host "`r[3/4] FAILED: $_" -ForegroundColor Red
  Remove-Item $TarFile -Force -ErrorAction SilentlyContinue
  exit 1
}

# ── Cleanup ───────────────────────────────────────────────────────
Remove-Item $TarFile -Force -ErrorAction SilentlyContinue

# ── Health Check ──────────────────────────────────────────────────
Write-Host ""
Write-Host "  Health check…" -ForegroundColor DarkGray -NoNewline
Start-Sleep -Seconds 3

try {
  $health = Invoke-RestMethod -Uri "http://${Domain}:${Port}/api/health" -TimeoutSec 5 -ErrorAction Stop
  if ($health.ok) {
    Write-Host "`r  Health check: OK                          " -ForegroundColor Green
  }
} catch {
  Write-Host "`r  Health check: unreachable (may need a moment) " -ForegroundColor Yellow
}

# ── Done ──────────────────────────────────────────────────────────
$sw.Stop()
Write-Host ""
Write-Host "  Done in $([math]::Round($sw.Elapsed.TotalSeconds, 0))s" -ForegroundColor Green
Write-Host "  Panel : http://${Domain}:${FePort}" -ForegroundColor White
Write-Host "  API   : http://${Domain}:${Port}/api/health" -ForegroundColor DarkGray
Write-Host ""
