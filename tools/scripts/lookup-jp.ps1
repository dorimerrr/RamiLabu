param(
    [Parameter(Mandatory=$true)][string[]]$Snippet,
    [int]$Max = 2
)
$ErrorActionPreference = 'Stop'
$base = 'C:\Users\Andrew\Desktop\RamiLabu\translation'

function Flatten($obj, [string]$prefix, $ht) {
    foreach ($p in $obj.PSObject.Properties) {
        $path = if ($prefix) { "$prefix/$($p.Name)" } else { $p.Name }
        if ($p.Value -is [string]) { $ht[$path] = $p.Value }
        elseif ($p.Value -is [System.Management.Automation.PSCustomObject]) { Flatten $p.Value $path $ht }
    }
}

function Read-Table([string]$path) {
    $obj = [System.IO.File]::ReadAllText($path) | ConvertFrom-Json
    $ht = @{}
    Flatten $obj '' $ht
    return $ht
}

$zh = Read-Table "$base\static\zh_Hans.json"
$en = Read-Table "$base\static\en.json"
Write-Output "flattened: zh=$($zh.Count) en=$($en.Count)"

function Esc([string]$t) { return $t.Replace("`r", '\r').Replace("`n", '\n') }

foreach ($s in $Snippet) {
    Write-Output "### QUERY: $s"
    $hits = 0
    foreach ($k in $zh.Keys) {
        if ($zh[$k].ToString() -like "*$s*") {
            $hits++
            Write-Output ("  PATH: " + $k)
            Write-Output ("  ZH  : " + (Esc $zh[$k]))
            if ($en.ContainsKey($k)) { Write-Output ("  EN  : " + (Esc $en[$k])) }
            else { Write-Output "  EN  : (no matching path in en.json)" }
            if ($hits -ge $Max) { break }
        }
    }
    if ($hits -eq 0) { Write-Output "  (no zh_Hans value match)" }
    Write-Output ""
}

foreach ($s in $Snippet) {
    Write-Output "### QUERY: $s"
    $hits = 0
    $khits = 0
    foreach ($k in $en.Keys) {
        if ($k -like "*$s*") {
            $khits++
            Write-Output ("  KEYMATCH: " + $k.Replace("`r", '\r').Replace("`n", '\n'))
            Write-Output ("  EN      : " + $en[$k].ToString().Replace("`r", '\r').Replace("`n", '\n'))
            if ($khits -ge $Max) { break }
        }
    }
    foreach ($k in $zh.Keys) {
        if ($zh[$k] -and ($zh[$k].ToString() -like "*$s*")) {
            $hits++
            Write-Output ("  KEY: " + $k.Replace("`r", '\r').Replace("`n", '\n'))
            Write-Output ("  ZH : " + $zh[$k].ToString().Replace("`r", '\r').Replace("`n", '\n'))
            if ($en.ContainsKey($k)) {
                Write-Output ("  EN : " + $en[$k].ToString().Replace("`r", '\r').Replace("`n", '\n'))
            } else {
                Write-Output "  EN : (no en.json key)"
            }
            if ($hits -ge $Max) { break }
        }
    }
    if ($hits -eq 0) { Write-Output "  (no zh_Hans match)" }
    Write-Output ""
}
