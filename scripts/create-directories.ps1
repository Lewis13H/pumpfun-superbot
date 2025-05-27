# scripts/create-directories.ps1
Write-Host "Creating missing directories..." -ForegroundColor Yellow

# Create directories
New-Item -ItemType Directory -Path "src/analysis" -Force | Out-Null
New-Item -ItemType Directory -Path "src/utils" -Force | Out-Null

Write-Host "✅ Directories created" -ForegroundColor Green
Write-Host "  - src/analysis" -ForegroundColor Cyan
Write-Host "  - src/utils" -ForegroundColor Cyan