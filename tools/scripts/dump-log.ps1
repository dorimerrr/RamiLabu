param(
    [string]$UiTable = 'C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\plugins\MuvluvMod\translation\ui\en.json',
    [string]$Log = 'C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\LogOutput.log',
    [string]$SceneDump = 'C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\plugins\MuvluvMod\translation\scene-dump\61001401.json'
)

# Shows a string with the characters that JSON has to escape made explicit, so a source can be
# copied into a table without guessing the escape level.
function Format-Line([string]$Text) {
    return ($Text -replace '\\', '[BS]' -replace "`r", '<CR>' -replace "`n", '<LF>')
}

function Read-Table([string]$Path) {
    $table = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
    $strings = @{}
    foreach ($property in $table.strings.PSObject.Properties) { $strings[$property.Name] = $property.Value }
    $templates = @{}
    foreach ($property in $table.templates.PSObject.Properties) { $templates[$property.Name] = $property.Value }
    return @{ Strings = $strings; Templates = $templates }
}

function Get-TemplateKey([string]$Text) {
    $builder = New-Object System.Text.StringBuilder
    $inTag = $false
    foreach ($character in $Text.ToCharArray()) {
        if ($character -eq '<') { $inTag = $true }
        if (-not $inTag -and $character -ge '0' -and $character -le '9') {
            if ($builder.Length -gt 0 -and $builder[$builder.Length - 1] -ne '#') { $builder.Append('#') | Out-Null }
            continue
        }
        if ($inTag -and $character -eq '>') { $inTag = $false }
        $builder.Append($character) | Out-Null
    }
    return $builder.ToString()
}

$table = Read-Table $UiTable
$raw = [System.IO.File]::ReadAllText($Log)
$seen = [regex]::Matches(
    $raw,
    '\[UI\] untranslated text: "(.*?)"\r?\n',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
) | ForEach-Object { $_.Groups[1].Value }

$sceneKeys = @()
if (Test-Path -LiteralPath $SceneDump) {
    $sceneMap = [System.IO.File]::ReadAllText($SceneDump) | ConvertFrom-Json
    foreach ($property in $sceneMap.PSObject.Properties) { $sceneKeys += $property.Name }
}

Write-Host "=== LOG ENTRIES ($($seen.Count)) ==="
for ($index = 0; $index -lt $seen.Count; $index++) {
    $text = $seen[$index]
    $status = 'NEEDS'
    if ($table.Strings.ContainsKey($text)) { $status = 'STRING' }
    elseif ($table.Templates.ContainsKey((Get-TemplateKey $text))) { $status = 'TEMPLATE' }
    $scene = ''
    if ($sceneKeys -contains ($text -replace '^<line-height=2\.000em>', '')) { $scene = ' [SCENE]' }
    $truncated = ''
    if ($text.EndsWith([char]0x2026)) { $truncated = ' [TRUNCATED]' }
    Write-Host ("[{0:D3}] {1}{2}{3} :: {4}" -f $index, $status, $scene, $truncated, (Format-Line $text))
}

Write-Host ''
Write-Host "=== SCENE DUMP ($($sceneKeys.Count)) ==="
for ($index = 0; $index -lt $sceneKeys.Count; $index++) {
    Write-Host ("[{0:D3}] {1}" -f $index, (Format-Line $sceneKeys[$index]))
}
