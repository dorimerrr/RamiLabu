param(
    [string]$Harvest = 'C:\Users\Andrew\Desktop\RamiLabu\tools\sources\ui-round6-harvest.json',
    [string]$Log = 'C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\LogOutput.log',
    [string]$UiTable = 'C:\Users\Andrew\Desktop\RamiLabu\translation\ui\en.json',
    [string]$UiTranslations = 'C:\Users\Andrew\Desktop\RamiLabu\tools\sources\ui-round6-translations.tsv',
    [string]$UiExtras = 'C:\Users\Andrew\Desktop\RamiLabu\tools\sources\ui-round6-extras.json',
    [string]$UiOutput = 'C:\Users\Andrew\Desktop\RamiLabu\tools\sources\ui-round6.json',
    [string[]]$RetiredKeys = @()
)

# Round 6 builds interface additions only, so it never writes into translation\scenes\ (round 5 did).
# Keys are taken from the harvest itself instead of being retyped, so a table entry can never drift from
# what the game rendered: the digit-run rule and the quoting are the ones the plugin uses at lookup time.
# Defaults point inside this repository; only the harvest log is read from the game.
#
# Additions the harvest cannot supply (a label that was never logged) belong in $UiExtras and are merged
# on top of the TSV entries. Every entry is checked against the failure modes the client silently ignores:
# an empty value, a value equal to its key, a Japanese character in a Latin value, and a template whose
# placeholders do not match the digit runs one-to-one.

function Read-LogEntries([string]$Path) {
    $raw = Read-LogText $Path
    return @(
        [regex]::Matches(
            $raw,
            '\[UI\] untranslated text: "(.*?)"\r?\n',
            [System.Text.RegularExpressions.RegexOptions]::Singleline
        ) | ForEach-Object { $_.Groups[1].Value }
    )
}

# The client keeps LogOutput.log open while it runs, so a plain File.ReadAllText fails with a sharing
# violation mid-session. Request the most permissive sharing and retry a few times.
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

# Mirrors UiTextResolver: digit runs outside a rich text tag become '#'.
function Get-TemplateKey([string]$Text) {
    $builder = New-Object System.Text.StringBuilder
    $inTag = $false
    $inRun = $false
    foreach ($character in $Text.ToCharArray()) {
        if ($character -eq '<') { $inTag = $true }
        $isDigit = (-not $inTag) -and ((($character -ge '0') -and ($character -le '9')) -or (($character -ge [char]0xFF10) -and ($character -le [char]0xFF19)))
        if ($isDigit) {
            if (-not $inRun) { $builder.Append('#') | Out-Null }
            $inRun = $true
            continue
        }
        $inRun = $false
        if ($inTag -and $character -eq '>') { $inTag = $false }
        $builder.Append($character) | Out-Null
    }
    return $builder.ToString()
}

# Counts the digit runs the plugin substitutes. A '#' inside a rich text tag is not a placeholder, so
# counting the placeholders of the derived key would over-count tags such as color=#0096ff.
function Get-DigitRunCount([string]$Text) {
    $count = 0
    $inRun = $false
    $inTag = $false
    foreach ($character in $Text.ToCharArray()) {
        if ($character -eq '<') { $inTag = $true }
        $isDigit = (-not $inTag) -and ((($character -ge '0') -and ($character -le '9')) -or (($character -ge [char]0xFF10) -and ($character -le [char]0xFF19)))
        if ($isDigit) {
            if (-not $inRun) { $count++ }
            $inRun = $true
        }
        else { $inRun = $false }
        if ($inTag -and $character -eq '>') { $inTag = $false }
    }
    return $count
}

# Counts placeholders outside rich text tags, the way UiTextResolver.TrySubstituteDigits does.
function Get-PlaceholderCount([string]$Text) {
    $count = 0
    $inTag = $false
    foreach ($character in $Text.ToCharArray()) {
        if ($character -eq '<') { $inTag = $true }
        elseif ($inTag -and $character -eq '>') { $inTag = $false }
        elseif ($character -eq '#' -and -not $inTag) { $count++ }
    }
    return $count
}

# Mirrors UiTextResolver.IsJapanese: a hit means the client keeps full-width digits in the result.
function Test-Japanese([string]$Text) {
    foreach ($character in $Text.ToCharArray()) {
        $code = [int][char]$character
        if (($code -ge 0x3000 -and $code -le 0x30FF) -or
            ($code -ge 0x3400 -and $code -le 0x4DBF) -or
            ($code -ge 0x4E00 -and $code -le 0x9FFF) -or
            ($code -ge 0xF900 -and $code -le 0xFAFF) -or
            ($code -ge 0xFF00 -and $code -le 0xFFEF)) {
            return $true
        }
    }
    return $false
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
    # A plain hashtable, not [ordered]: an OrderedDictionary treats an integer key as a positional index.
    $entries = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
        $parts = $line -split "`t"
        $entries[[int]$parts[0]] = $parts
    }
    return $entries
}

function Read-Table([string]$Path) {
    $table = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
    $strings = @{}
    foreach ($property in $table.strings.PSObject.Properties) { $strings[$property.Name] = $property.Value }
    $templates = @{}
    foreach ($property in $table.templates.PSObject.Properties) { $templates[$property.Name] = $property.Value }
    return @{ Strings = $strings; Templates = $templates }
}

# Validates one entry and files it under strings or templates. The table objects and the problem list are
# reference types, so the caller sees every addition.
function Add-Entry([string]$Label, [string]$Key, [string]$Value, [int]$Runs, [switch]$Template) {
    if ($Value.Length -eq 0) { [void]$problems.Add("$Label has an empty value"); return }
    if ($Value -eq $Key) { [void]$problems.Add("$Label is identical to its key, the client drops it") }
    if (Test-Japanese $Value) {
        [void]$problems.Add("$Label contains a Japanese character, which keeps full-width digits in the result")
    }
    if ($Template) {
        $placeholders = Get-PlaceholderCount $Value
        if ($placeholders -ne $Runs) {
            [void]$problems.Add("$Label has $placeholders placeholders for $Runs digit runs")
        }
        $templates[$Key] = $Value
    }
    else {
        $strings[$Key] = $Value
    }
}

# The client rewrites LogOutput.log on every launch, so the round reads its keys from the frozen harvest
# kept in tools\sources. Pass -Harvest '' to read the live log instead, which is how the harvest in that
# file was collected (Translation.Ui.LogSeenText = true, then play the screens to cover).
if ($Harvest -and (Test-Path -LiteralPath $Harvest)) {
    # Assigned first: wrapping the pipeline itself in @() produces a one-element array holding the array.
    $harvestEntries = [System.IO.File]::ReadAllText($Harvest) | ConvertFrom-Json
    $sources = @($harvestEntries)
    Write-Host "harvest keys from $Harvest : $($sources.Count)"
}
else {
    $sources = Read-LogEntries $Log
    Write-Host "harvest keys from the live log $Log : $($sources.Count)"
}

$existing = Read-Table $UiTable
$strings = [ordered]@{}
$templates = [ordered]@{}
$problems = New-Object System.Collections.ArrayList

$translationLines = Read-TranslationLines $UiTranslations
foreach ($index in $translationLines.Keys) {
    $parts = $translationLines[$index]
    if ($index -ge $sources.Count) { [void]$problems.Add("[$index] index is outside the harvest"); continue }
    $source = $sources[$index]
    $form = $parts[1].Trim().ToUpperInvariant()
    $value = Expand-Markers ($parts[2..($parts.Count - 1)] -join "`t")
    $runs = Get-DigitRunCount $source

    switch ($form) {
        'S' {
            if ($existing.Strings.ContainsKey($source) -and $existing.Strings[$source] -ne $value) {
                Write-Host "overwrites existing string: $index"
            }
            Add-Entry "[$index] string" $source $value $runs
        }
        'T' {
            $key = Get-TemplateKey $source
            if ($key -eq $source) { [void]$problems.Add("[$index] template form on a source without digit runs") }
            if ($existing.Templates.ContainsKey($key) -and $existing.Templates[$key] -ne $value) {
                Write-Host "overwrites existing template: $index"
            }
            Add-Entry "[$index] template" $key $value $runs -Template
        }
        default { [void]$problems.Add("[$index] unknown form '$form'") }
    }
}

# Additions the harvest cannot supply, e.g. a label the game never logged.
if (Test-Path -LiteralPath $UiExtras) {
    $extra = Read-Table $UiExtras
    foreach ($key in $extra.Strings.Keys) {
        Add-Entry 'extras string' $key $extra.Strings[$key] (Get-DigitRunCount $key)
    }
    foreach ($key in $extra.Templates.Keys) {
        Add-Entry 'extras template' $key $extra.Templates[$key] (Get-DigitRunCount $key) -Template
    }
    Write-Host "extras: strings=$($extra.Strings.Count) templates=$($extra.Templates.Count)"
}
else {
    Write-Host "no extras file at $UiExtras"
}

$uiJson = [ordered]@{
    strings   = $strings
    templates = $templates
    remove    = [ordered]@{ strings = $RetiredKeys }
}
Save-Text $UiOutput (ConvertTo-TableJson $uiJson)
Write-Host "wrote $UiOutput (strings=$($strings.Count), templates=$($templates.Count), retired=$($RetiredKeys.Count))"

foreach ($key in $RetiredKeys) {
    if (-not $existing.Strings.ContainsKey($key)) { [void]$problems.Add("retired key is not present in the table: $key") }
}

# What the harvest still cannot resolve, using the existing table plus this round's additions.
$unresolved = @()
for ($index = 0; $index -lt $sources.Count; $index++) {
    $source = $sources[$index]
    if ($existing.Strings.ContainsKey($source) -or $strings.Contains($source)) { continue }
    $key = Get-TemplateKey $source
    if (($key -ne $source) -and ($existing.Templates.ContainsKey($key) -or $templates.Contains($key))) { continue }
    $unresolved += "[$index] $source"
}
Write-Host "unresolved after this round: $($unresolved.Count) of $($sources.Count)"
foreach ($entry in $unresolved) { Write-Host "   $entry" }

if ($problems.Count -gt 0) {
    Write-Host '--- PROBLEMS ---'
    foreach ($problem in $problems) { Write-Host $problem }
}
else {
    Write-Host 'no problems detected'
}
