# Build the Android app with a JDK that Gradle can actually run on.
#
# Why this exists: Android Studio ships its own JDK (the "JBR") and updates it
# silently. On 2026-07-31 that update took it to JDK 25, which Gradle 8.14.3
# cannot run — every build began failing with
#
#   BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_'
#   Unsupported class file major version 69
#
# which reads like a corrupt build script rather than a JDK mismatch, and sends
# you looking in the wrong place. This script picks a supported JDK instead of
# trusting whatever Studio happens to be shipping this week.
#
# Usage:
#   pwsh tools/android-build.ps1                       # debug APK
#   pwsh tools/android-build.ps1 -Task bundleRelease -VersionCode 5 -VersionName 1.0.5
#
# ⚠️ Do NOT pipe this (or gradlew, npm, node, git) through `2>&1` in Windows
# PowerShell 5.1. Redirecting a native command's stderr into the pipeline wraps
# each line in an ErrorRecord and sets $? to false, so the caller sees a
# FAILURE and a non-zero exit even when the build succeeded — which has already
# sent two investigations chasing a green build that reported red. Capture to a
# file instead and read it back:
#
#   pwsh tools/android-build.ps1 -Task assembleDebug > out.txt 2> err.txt
#   if ($LASTEXITCODE -ne 0) { Get-Content err.txt }
#
# $LASTEXITCODE is the truth here; $? is not.
[CmdletBinding()]
param(
    [string]$Task = 'assembleDebug',
    [int]$VersionCode,
    [string]$VersionName
)

$ErrorActionPreference = 'Stop'
$androidDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'client\android'

# Gradle 8.14.x runs on JDK 17 through 24. Anything newer fails as above;
# anything older is below what AGP requires.
$MIN_JDK = 17
$MAX_JDK = 24

function Get-JdkVersion([string]$javaHome) {
    $javac = Join-Path $javaHome 'bin\javac.exe'
    if (-not (Test-Path $javac)) { return $null }
    $raw = & $javac -version 2>&1 | Out-String
    if ($raw -match 'javac (\d+)') { return [int]$Matches[1] }
    return $null
}

# Candidates, in the order we would prefer them.
$candidates = @()
if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
foreach ($root in @("$env:USERPROFILE\.jdks", 'C:\Program Files\Java', 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Microsoft')) {
    if (Test-Path $root) { $candidates += (Get-ChildItem $root -Directory | ForEach-Object { $_.FullName }) }
}
$candidates += 'C:\Program Files\Android\Android Studio\jbr'

$chosen = $null
foreach ($candidate in $candidates) {
    $version = Get-JdkVersion $candidate
    if ($null -ne $version -and $version -ge $MIN_JDK -and $version -le $MAX_JDK) {
        $chosen = $candidate
        Write-Host "[android-build] using JDK $version at $candidate"
        break
    }
}

if (-not $chosen) {
    $found = foreach ($c in ($candidates | Select-Object -Unique)) {
        $v = Get-JdkVersion $c
        if ($v) { "  JDK $v  $c" }
    }
    throw @"
No JDK between $MIN_JDK and $MAX_JDK was found, so Gradle cannot run.
Installed JDKs:
$($found -join "`n")

Install a supported JDK (21 is the safe choice) and re-run. In Android Studio:
Settings > Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK >
Download JDK > version 21.
"@
}

$env:JAVA_HOME = $chosen

# Passed as separate array elements: PowerShell splits an argument containing
# '=' and '.' in ways that reach Gradle as a bogus task name otherwise.
$gradleArgs = @($Task)
if ($PSBoundParameters.ContainsKey('VersionCode')) { $gradleArgs += "-PversionCode=$VersionCode" }
if ($PSBoundParameters.ContainsKey('VersionName')) { $gradleArgs += "-PversionName=$VersionName" }

Push-Location $androidDir
try {
    Write-Host "[android-build] gradlew $($gradleArgs -join ' ')"
    & (Join-Path $androidDir 'gradlew.bat') $gradleArgs
    if ($LASTEXITCODE -ne 0) { throw "gradle exited with $LASTEXITCODE" }
} finally {
    Pop-Location
}

Write-Host '[android-build] done. Artifacts:'
Get-ChildItem (Join-Path $androidDir 'app\build\outputs') -Recurse -Include '*.apk', '*.aab' -ErrorAction SilentlyContinue |
    ForEach-Object { '  {0}  {1} MB' -f $_.Name, [math]::Round($_.Length / 1MB, 2) }
