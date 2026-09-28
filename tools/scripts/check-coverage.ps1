param(
    [string]$UiTable = 'C:\Users\Andrew\Desktop\RamiLabu\translation\ui\en.json',
    [string]$Additions = 'C:\Users\Andrew\Desktop\RamiLabu\tools\sources\ui-round4.json',
    [string]$Log = 'C:\Users\Andrew\muv_luv_girlsgardenx_cl\BepInEx\LogOutput.log',
    [string]$Harvest = '',
    [string]$SceneFile = 'C:\Users\Andrew\Desktop\RamiLabu\translation\scenes\61001401\en.json',
    [switch]$ShowEscapes,
    [switch]$Resolve
)

# Loads a UI table (strings/templates) into two hashtables.
function Read-Table([string]$Path) {
    $table = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
    $strings = @{}
    foreach ($property in $table.strings.PSObject.Properties) { $strings[$property.Name] = $property.Value }
    $templates = @{}
    foreach ($property in $table.templates.PSObject.Properties) { $templates[$property.Name] = $property.Value }
    return @{ Strings = $strings; Templates = $templates }
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

# Shows backslashes and newlines explicitly so escape drift stays visible.
function Format-Line([string]$Text) {
    if (-not $ShowEscapes) { return $Text }
    return ($Text -replace '\\', '[BS]' -replace "`r", '<CR>' -replace "`n", '<LF>')
}

# Turns full-width digits into half-width ones, the way the plugin does for a Latin template.
function ConvertTo-AsciiDigits([string]$Run) {
    $builder = New-Object System.Text.StringBuilder
    foreach ($character in $Run.ToCharArray()) {
        $code = [int][char]$character
        if ($code -ge 0xFF10 -and $code -le 0xFF19) {
            $builder.Append([char]($code - 0xFF10 + 0x30)) | Out-Null
        }
        else { $builder.Append($character) | Out-Null }
    }
    return $builder.ToString()
}

# Mirrors UiTextResolver.TrySubstituteDigits: one placeholder per digit run, tags are not touched.
function Substitute-Digits([string]$Template, [string]$Original) {
    $runs = New-Object System.Collections.ArrayList
    $inTag = $false
    $runStart = -1
    for ($index = 0; $index -lt $Original.Length; $index++) {
        $character = $Original[$index]
        if ($character -eq '<') { $inTag = $true }
        elseif ($inTag -and $character -eq '>') { $inTag = $false }
        if (-not $inTag -and $character -ge '0' -and $character -le '9') {
            if ($runStart -lt 0) { $runStart = $index }
            continue
        }
        if ($runStart -ge 0) {
            [void]$runs.Add($Original.Substring($runStart, $index - $runStart))
            $runStart = -1
        }
    }
    if ($runStart -ge 0) { [void]$runs.Add($Original.Substring($runStart)) }
    if ($runs.Count -eq 0) { return $null }

    $builder = New-Object System.Text.StringBuilder
    $runIndex = 0
    $inTemplateTag = $false
    foreach ($character in $Template.ToCharArray()) {
        if ($character -eq '<') { $inTemplateTag = $true }
        elseif ($inTemplateTag -and $character -eq '>') { $inTemplateTag = $false }
        if ($character -ne '#' -or $inTemplateTag) {
            $builder.Append($character) | Out-Null
            continue
        }
        if ($runIndex -ge $runs.Count) { return '[placeholder mismatch]' }
        $builder.Append((ConvertTo-AsciiDigits $runs[$runIndex])) | Out-Null
        $runIndex++
    }
    if ($runIndex -ne $runs.Count) { return '[placeholder mismatch]' }
    return $builder.ToString()
}

# Mirrors UiTextResolver.TryResolve: exact matches first, then the template table.
function Resolve-Text([string]$Text) {
    if ($table.Strings.ContainsKey($Text)) { return $table.Strings[$Text] }
    $key = Get-TemplateKey $Text
    if ($table.Templates.ContainsKey($key)) { return (Substitute-Digits $table.Templates[$key] $Text) }
    if ($extra.Strings.ContainsKey($Text)) { return $extra.Strings[$Text] }
    if ($extra.Templates.ContainsKey($key)) { return (Substitute-Digits $extra.Templates[$key] $Text) }
    return $null
}

$table = Read-Table $UiTable
$extra = Read-Table $Additions

# The client rewrites LogOutput.log on every launch, so -Harvest can point at a frozen harvest JSON from
# tools\sources (the shape the round builders write). Otherwise the live log is read; a running client
# keeps it open, so request permissive sharing instead of a plain File.ReadAllText.
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

if ($Harvest -and (Test-Path -LiteralPath $Harvest)) {
    # Assigned first: wrapping the pipeline itself in @() produces a one-element array holding the array.
    $harvestEntries = [System.IO.File]::ReadAllText($Harvest) | ConvertFrom-Json
    $seen = @($harvestEntries)
    Write-Host "harvest loaded from $Harvest"
}
else {
    $raw = Read-LogText $Log
    # A rendered string may contain literal newlines, so an entry is delimited by the closing quote
    # that ends a line rather than by the end of the physical line.
    $seen = @(
        [regex]::Matches(
            $raw,
            '\[UI\] untranslated text: "(.*?)"\r?\n',
            [System.Text.RegularExpressions.RegexOptions]::Singleline
        ) | ForEach-Object { $_.Groups[1].Value }
    )
}

$missing = @()
$pending = @()
$covered = @()
foreach ($text in $seen) {
    if ($table.Strings.ContainsKey($text)) { $covered += $text; continue }
    $key = Get-TemplateKey $text
    if ($table.Templates.ContainsKey($key)) { $covered += $text; continue }
    if ($extra.Strings.ContainsKey($text)) { $pending += $text; continue }
    if ($extra.Templates.ContainsKey($key)) { $pending += $text; continue }
    $missing += $text
}

Write-Host "log=$($seen.Count) covered=$($covered.Count) pending=$($pending.Count) missing=$($missing.Count)"
Write-Host '--- PENDING ---'
foreach ($text in $pending) { Write-Host ("PENDING  " + (Format-Line $text)) }
Write-Host '--- MISSING ---'
foreach ($text in $missing) { Write-Host ("MISSING  " + (Format-Line $text)) }

if ($Resolve) {
    Write-Host '--- RESOLVED ---'
    foreach ($text in $seen) {
        $resolved = Resolve-Text $text
        if ($null -eq $resolved) { Write-Host ("UNRESOLVED  " + (Format-Line $text)); continue }
        Write-Host ("{0}`n    => {1}" -f (Format-Line $text), (Format-Line $resolved))
    }
}

if (Test-Path -LiteralPath $SceneFile) {
    $scene = [System.IO.File]::ReadAllText($SceneFile) | ConvertFrom-Json
    $sceneCount = 0
    $blank = 0
    foreach ($property in $scene.PSObject.Properties) {
        $sceneCount++
        if ([string]::IsNullOrEmpty($property.Value)) { $blank++ }
    }
    Write-Host "scene file entries=$sceneCount empty=$blank"
}
