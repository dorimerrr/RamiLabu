param(
    [string]$Target = 'C:\Users\Andrew\Desktop\RamiLabu\translation\ui\en.json',
    [string]$Additions = 'C:\Users\Andrew\Desktop\RamiLabu\tools\sources\ui-additions.json',
    [switch]$Prune
)

# Merges new interface translations into the repository table without retyping the existing entries.
# The defaults point inside the repository; only the harvest log and scene-dump are read from the game.
# -Prune also drops the keys listed under "remove", which is how a superseded entry is retired.
$existing = ([System.IO.File]::ReadAllText($Target)) | ConvertFrom-Json
$extra = ([System.IO.File]::ReadAllText($Additions)) | ConvertFrom-Json

function Merge-Table($base, $added) {
    $map = @{}
    foreach ($property in $base.PSObject.Properties) { $map[$property.Name] = $property.Value }
    foreach ($property in $added.PSObject.Properties) { $map[$property.Name] = $property.Value }
    return $map
}

function Remove-Keys($map, $removed) {
    if ($null -eq $removed) { return $map }
    foreach ($key in $removed) {
        if (-not $map.ContainsKey($key)) { Write-Warning "remove: $key is not present" }
        else { $map.Remove($key) | Out-Null }
    }
    return $map
}

function ConvertTo-OrderedMap($map) {
    $ordered = [ordered]@{}
    foreach ($key in ($map.Keys | Sort-Object)) { $ordered[$key] = $map[$key] }
    return $ordered
}

$removed = if ($Prune) { $extra.remove } else { $null }
$strings = Remove-Keys (Merge-Table $existing.strings $extra.strings) $removed.strings
$templates = Remove-Keys (Merge-Table $existing.templates $extra.templates) $removed.templates

$output = [ordered]@{
    strings   = ConvertTo-OrderedMap $strings
    templates = ConvertTo-OrderedMap $templates
} | ConvertTo-Json -Depth 6

# PowerShell escapes the characters a browser would treat as markup; the tables keep them literal.
$output = $output -replace '\\u003c', '<' -replace '\\u003e', '>' -replace '\\u0026', '&' -replace '\\u0027', "'"

[System.IO.File]::WriteAllText($Target, $output + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host "strings=$($strings.Count) templates=$($templates.Count) bytes=$((Get-Item $Target).Length)"
