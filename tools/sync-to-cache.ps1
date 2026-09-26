param(
    [string]$Repository = 'C:\Users\Andrew\desktop\RamiLabu',
    [string]$Cache = 'C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\plugins\MuvluvMod\translation',
    [string]$Language = 'en'
)

# Fallback for a cache that is a plain directory instead of junctions into the working copy: copies
# every authored category into it. The manifest is not copied (the plugin refreshes it from the CDN on
# every launch) and neither is scene-dump (runtime output of the mod). With the junctions in place the
# script finds a reparse point and does nothing, so it is safe to run at any time.

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Cache)) {
    throw "cache directory not found: $Cache"
}

$root = Get-Item -LiteralPath $Cache
if ($root.LinkType) {
    Write-Host "cache is a $($root.LinkType) to $($root.Target -join ', '): nothing to do"
    return
}

$copied = 0
foreach ($category in 'names', 'static', 'ui', 'scenes') {
    $source = Join-Path $Repository "translation\$category"
    if (-not (Test-Path -LiteralPath $source)) {
        Write-Warning "no $category directory in $Repository"
        continue
    }

    $target = Join-Path $Cache $category
    $existing = Get-Item -LiteralPath $target -ErrorAction SilentlyContinue
    if ($existing -and $existing.LinkType) {
        Write-Host ("{0,-8} junction to {1}: skipped" -f $category, ($existing.Target -join ', '))
        continue
    }

    $files = @(Get-ChildItem -LiteralPath $source -Recurse -File -Filter "$Language.json")
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($source.Length + 1)
        $destination = Join-Path $target $relative
        $directory = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $directory)) {
            New-Item -ItemType Directory -Force -Path $directory | Out-Null
        }
        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
        $copied++
    }
    Write-Host ("{0,-8} {1} file(s)" -f $category, $files.Count)
}

Write-Host "copied $copied file(s) into $Cache"
