param(
    [string]$Log = 'C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\LogOutput.log',
    [string]$UiTable = 'C:\Users\Andrew\Desktop\RamiLabu\translation\ui\en.json',
    [string]$UiTranslations = 'C:\Users\Andrew\Desktop\RamiLabu\tools\sources\ui-round5-translations.tsv',
    [string]$UiOutput = 'C:\Users\Andrew\Desktop\RamiLabu\tools\sources\ui-round5.json',
    [string]$SceneDump = 'C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\plugins\MuvluvMod\translation\scene-dump\30010101.json',
    [string]$SceneTranslations = 'C:\Users\Andrew\Desktop\RamiLabu\tools\sources\scene-30010101-translations.tsv',
    [string]$SceneOutput = 'C:\Users\Andrew\Desktop\RamiLabu\translation\scenes\30010101\en.json',
    [string]$SceneArchive = 'C:\Users\Andrew\Desktop\RamiLabu\tools\snapshots\scenes\30010101\en.json'
)

# Builds the interface additions and the scene file from the harvested log. Keys are taken from the
# harvest itself instead of being retyped, so a table entry can never drift from what the game
# renders: the digit-run rule and the quoting are the ones the plugin uses at lookup time.
# The defaults point inside this repository (translation\, tools\sources\); only the harvest log and
# scene-dump are read from the game.

# Round 5 retired no key: the two doubled-backslash entries retired in round 4 are already gone from
# the cached table, and every source in this harvest carries at most one backslash per escape.
$retiredKeys = @()

# The client keeps LogOutput.log open while it runs, so share the file instead of using ReadAllText.
function Read-LogText([string]$Path) {
    $lastError = $null
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $stream = $null
        try {
            $stream = [System.IO.File]::Open(
                $Path,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::ReadWrite
            )
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
            try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
        }
        catch {
            $lastError = $_
            Start-Sleep -Milliseconds 250
        }
        finally {
            if ($stream) { $stream.Dispose() }
        }
    }
    throw "cannot read $Path : $($lastError.Exception.Message)"
}

function Read-LogEntries([string]$Path) {
    # The client keeps LogOutput.log open while it runs: Read-LogText shares instead of ReadAllText.
    $raw = Read-LogText $Path
    return @(
        [regex]::Matches(
            $raw,
            '\[UI\] untranslated text: "(.*?)"\r?\n',
            [System.Text.RegularExpressions.RegexOptions]::Singleline
        ) | ForEach-Object { $_.Groups[1].Value }
    )
}

# Mirrors UiTextResolver: digit runs outside a rich text tag become '#'.
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

# Counts the digit runs the plugin substitutes. A '#' inside a rich text tag is not a placeholder,
# so counting the placeholders of the derived key would over-count tags such as color=#0096ff.
function Get-DigitRunCount([string]$Text) {
    $count = 0
    $inRun = $false
    $inTag = $false
    foreach ($character in $Text.ToCharArray()) {
        if ($character -eq '<') { $inTag = $true }
        $isDigit = -not $inTag -and $character -ge '0' -and $character -le '9'
        if ($isDigit) {
            if (-not $inRun) { $count++ }
            $inRun = $true
        }
        else { $inRun = $false }
        if ($inTag -and $character -eq '>') { $inTag = $false }
    }
    return $count
}

function Expand-Markers([string]$Value) {
    return ($Value -replace '<LF>', "`n" -replace '<CRLF>', "`r`n")
}

# PowerShell escapes the characters a browser would treat as markup; the tables keep them literal.
function ConvertTo-TableJson($Object, [switch]$Compress) {
    $json = if ($Compress) { $Object | ConvertTo-Json -Depth 6 -Compress } else { $Object | ConvertTo-Json -Depth 6 }
    return ($json -replace '\\u003c', '<' -replace '\\u003e', '>' -replace '\\u0026', '&' -replace '\\u0027', "'")
}

function Save-Text([string]$Path, [string]$Text) {
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Read-TranslationLines([string]$Path) {
    $entries = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
        $parts = $line -split "`t"
        $entries[[int]$parts[0]] = $parts
    }
    return $entries
}


$sources = Read-LogEntries $Log
Write-Host "harvested interface strings: $($sources.Count)"

$existing = [System.IO.File]::ReadAllText($UiTable) | ConvertFrom-Json
$existingStrings = @{}
foreach ($property in $existing.strings.PSObject.Properties) { $existingStrings[$property.Name] = $property.Value }
$existingTemplates = @{}
foreach ($property in $existing.templates.PSObject.Properties) { $existingTemplates[$property.Name] = $property.Value }

$strings = [ordered]@{}
$templates = [ordered]@{}
$problems = @()

$translationLines = Read-TranslationLines $UiTranslations
foreach ($index in $translationLines.Keys) {
    $parts = $translationLines[$index]
    if ($index -ge $sources.Count) { $problems += "[$index] index is outside the harvest"; continue }
    $source = $sources[$index]
    $form = $parts[1].Trim().ToUpperInvariant()
    $value = Expand-Markers ($parts[2..($parts.Count - 1)] -join "`t")

    switch ($form) {
        'S' {
            if ($existingStrings.ContainsKey($source)) { Write-Host "overwrites existing string: $index" }
            $strings[$source] = $value
        }
        'T' {
            $key = Get-TemplateKey $source
            $runs = Get-DigitRunCount $source
            $placeholders = 0
            $inTag = $false
            foreach ($character in $value.ToCharArray()) {
                if ($character -eq '<') { $inTag = $true }
                elseif ($inTag -and $character -eq '>') { $inTag = $false }
                elseif ($character -eq '#' -and -not $inTag) { $placeholders++ }
            }
            if ($placeholders -ne $runs) {
                $problems += "[$index] template has $placeholders placeholders for $runs digit runs"
            }
            if ($existingTemplates.ContainsKey($key)) { Write-Host "overwrites existing template: $index" }
            $templates[$key] = $value
        }
        default { $problems += "[$index] unknown form '$form'" }
    }
}


$uiJson = [ordered]@{
    strings   = $strings
    templates = $templates
    remove    = [ordered]@{ strings = $retiredKeys }
}
Save-Text $UiOutput (ConvertTo-TableJson $uiJson)
Write-Host "wrote $UiOutput (strings=$($strings.Count), templates=$($templates.Count), retired=$($retiredKeys.Count))"

foreach ($key in $retiredKeys) {
    if (-not $existingStrings.ContainsKey($key)) { $problems += "retired key is not present in the table: $key" }
}

# Scene file: the dump keys are the rendered phrases, the TSV only supplies the values. Once the
# dump has been published the archived copy keeps the same keys, so the build stays reproducible.
$sceneKeySource = $SceneDump
if (-not (Test-Path -LiteralPath $sceneKeySource) -and (Test-Path -LiteralPath $SceneArchive)) {
    Write-Host "no scene dump found, using the archived keys at $SceneArchive"
    $sceneKeySource = $SceneArchive
}

if (Test-Path -LiteralPath $sceneKeySource) {
    $dump = [System.IO.File]::ReadAllText($sceneKeySource) | ConvertFrom-Json
    $sceneKeys = @()
    foreach ($property in $dump.PSObject.Properties) { $sceneKeys += $property.Name }

    $sceneLines = Read-TranslationLines $SceneTranslations
    $scene = [ordered]@{}
    $translated = 0
    for ($index = 0; $index -lt $sceneKeys.Count; $index++) {
        if ($sceneLines.ContainsKey($index)) {
            $parts = $sceneLines[$index]
            $scene[$sceneKeys[$index]] = Expand-Markers ($parts[1..($parts.Count - 1)] -join "`t")
            $translated++
        }
    }
    Save-Text $SceneOutput (ConvertTo-TableJson $scene -Compress)
    Save-Text $SceneArchive (ConvertTo-TableJson $scene -Compress)
    Write-Host "wrote $SceneOutput (translated=$translated, dumped=$($sceneKeys.Count))"
    Write-Host "archived to $SceneArchive"
}
else {
    Write-Host "no scene dump found at $SceneDump"
}

if ($problems.Count -gt 0) {
    Write-Host '--- PROBLEMS ---'
    foreach ($problem in $problems) { Write-Host $problem }
}
else {
    Write-Host 'no problems detected'
}
