# =============================================================================
#  MCPanel — Deploy Script (PowerShell)
#  Ein Befehl, alles auf den Server schicken + deployen.
#
#  Verwendung:
#    .\deploy.ps1
#
#  Server in Zeile 14 anpassen.
# =============================================================================

$Server   = "root@84.234.99.121"
$Deploy   = "/opt/mcpanel"
$TarFile  = "$env:TEMP\mcpanel.tar.gz"

# 1. Projekt packen
Write-Host "[1/3] Packing project..." -ForegroundColor Cyan
Set-Location $PSScriptRoot
tar czf $TarFile --% --exclude=node_modules --exclude=dist --exclude=.next --exclude=data --exclude=.git --exclude=.deepcode .

# 2. Auf Server übertragen
Write-Host "[2/3] Uploading to $Server..." -ForegroundColor Cyan
scp $TarFile ${Server}:/tmp/

# 3. Entpacken & deployen
Write-Host "[3/3] Deploying..." -ForegroundColor Cyan
ssh $Server "tar xzf /tmp/mcpanel.tar.gz -C $Deploy && rm /tmp/mcpanel.tar.gz && cd $Deploy && bash deploy.sh"

# Aufräumen
Remove-Item $TarFile -Force -ErrorAction SilentlyContinue

Write-Host "Done. Panel: http://84.234.99.121:3001" -ForegroundColor Green
