$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$api = Join-Path $root "victory-check-api"
$urlAdmin = "http://localhost:4000/admin/"
$urlMobile = "http://localhost:4000/mobile/"

Clear-Host
Write-Host ""
Write-Host "  ================================" -ForegroundColor DarkCyan
Write-Host "   Victory Check demo" -ForegroundColor White
Write-Host "  ================================" -ForegroundColor DarkCyan
Write-Host ""

Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

if (-not (Test-Path (Join-Path $api "node_modules"))) {
    Write-Host "  Installing dependencies..." -ForegroundColor Cyan
    Push-Location $api
    npm install --omit=optional
    if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
    Pop-Location
}

Write-Host "  Starting API on http://localhost:4000" -ForegroundColor Cyan
Write-Host "  Admin:  $urlAdmin" -ForegroundColor Yellow
Write-Host "  Mobile: $urlMobile" -ForegroundColor Yellow
Write-Host "  Login:  admin@demo.local / 123" -ForegroundColor Yellow
Write-Host "  Keep this window open." -ForegroundColor DarkGray
Write-Host ""

$helper = Join-Path $root "open-browser.ps1"
Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $helper, "-Url", $urlAdmin
) -WindowStyle Hidden | Out-Null

Set-Location $api
node server.js
