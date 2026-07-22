# Re-despliega la web de Trackpi a GitHub Pages (https://osantanaleal-ship-it.github.io/trackpi/).
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-pages.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> Build con base /trackpi/ ..." -ForegroundColor Cyan
$env:VITE_BASE_PATH = '/trackpi/'
npm run build
New-Item -ItemType File -Path "dist\.nojekyll" -Force | Out-Null

Write-Host "==> Publicando en la rama gh-pages ..." -ForegroundColor Cyan
Push-Location dist
try {
  if (Test-Path .git) { Remove-Item -Recurse -Force .git }
  git init -q -b gh-pages
  git config user.name  "osantanaleal-ship-it"
  git config user.email "osantanaleal-ship-it@users.noreply.github.com"
  git add -A
  git commit -q -m "Deploy Trackpi to GitHub Pages"
  git remote add origin https://github.com/osantanaleal-ship-it/trackpi.git
  git push -f -q origin gh-pages
} finally {
  Pop-Location
}
Write-Host "==> Listo: https://osantanaleal-ship-it.github.io/trackpi/" -ForegroundColor Green
