# ═══════════════════════════════════════════════════════════════
# TDE PATCH DEPLOY
# Run from inside TargetedDecomposition folder:
#   cd C:\Users\SteveWinfiel_12vs805\Documents\TargetedDecomposition
#   .\deploy.ps1
# ═══════════════════════════════════════════════════════════════

Write-Host "`n=== TDE Patch Deploy ===" -ForegroundColor Cyan

# ── Step 1: Delete the stale GitHub download ──
if (Test-Path "TargetedDecomposition-main") {
    Remove-Item -Recurse -Force "TargetedDecomposition-main"
    Write-Host "  DELETED  TargetedDecomposition-main (stale GitHub download)" -ForegroundColor DarkGray
}

# ── Step 2: Ensure directories exist ──
if (-not (Test-Path "src\routes")) {
    New-Item -ItemType Directory -Path "src\routes" -Force | Out-Null
    Write-Host "  CREATED  src\routes\" -ForegroundColor Green
}

# ── Step 3: Move patch files from project root to correct locations ──
$moves = @(
    @{ file="config.js";           dest="src\config.js" },
    @{ file="munger.js";           dest="src\core\munger.js" },
    @{ file="tagger.js";           dest="src\core\tagger.js" },
    @{ file="truegraph.js";        dest="src\core\truegraph.js" },
    @{ file="truegraph-routes.js"; dest="src\routes\truegraph-routes.js" }
)

foreach ($m in $moves) {
    if (Test-Path $m.file) {
        if (Test-Path $m.dest) {
            $bak = "$($m.dest).bak"
            Copy-Item $m.dest $bak -Force
            Write-Host "  BACKUP  $($m.dest) -> .bak" -ForegroundColor DarkGray
        }
        Move-Item $m.file $m.dest -Force
        Write-Host "  MOVED   $($m.file) -> $($m.dest)" -ForegroundColor Green
    } else {
        Write-Host "  SKIP    $($m.file) (not found in root)" -ForegroundColor Yellow
    }
}

# ── Step 4: Syntax check ──
Write-Host "`n=== Syntax Check ===" -ForegroundColor Cyan
node --check src/server.js 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  PASS" -ForegroundColor Green
} else {
    Write-Host "  FAIL - fix before pushing!" -ForegroundColor Red
}

Write-Host "`n=== Manual steps remaining ===" -ForegroundColor Yellow
Write-Host "  1. Edit src/core/engine.js   (2 changes - see PATCH_GUIDE)"
Write-Host "  2. Edit src/core/store.js    (6 changes - see PATCH_GUIDE)"
Write-Host "  3. Add to src/server.js:     require('./routes/truegraph-routes')(app, auth, engine);"
Write-Host "  4. Run:  npm install falkordb --save"
Write-Host "  5. Deploy FalkorDB on Railway (Docker: falkordb/falkordb:latest)"
Write-Host "  6. Set Railway env vars: FALKORDB_HOST, FALKORDB_PORT"
Write-Host "  7. Push local to GitHub (your local is ahead!)"
Write-Host "  8. node --check src/server.js`n"
