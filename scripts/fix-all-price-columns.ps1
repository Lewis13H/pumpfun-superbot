# Fix all instances of price column to current_price
$files = Get-ChildItem -Path "src" -Recurse -Filter "*.ts" -Exclude "*.backup.ts"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $originalContent = $content
    
    # Fix database updates
    $content = $content -replace '(set\s+.*?)(["`'']?)price(["`'']?\s*=)', '$1$2current_price$3'
    $content = $content -replace '(update\s+.*?)(["`'']?)price(["`'']?\s*:)', '$1$2current_price$3'
    
    # Fix object properties in database operations
    $content = $content -replace '(\{[^}]*?)(\s+)price(\s*:)(?![^}]*current_price)', '$1$2current_price$3'
    
    # Only write if changed
    if ($content -ne $originalContent) {
        Write-Host "Fixing $($file.Name)" -ForegroundColor Yellow
        $content | Set-Content $file.FullName
    }
}

Write-Host "`nDone! Fixed all price column references" -ForegroundColor Green
