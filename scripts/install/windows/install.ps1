# Vyre for Windows: the device installer (V1-SPEC 3.13, ARCH 7.13, lead ruling Q6).
# from vyre 0.6.9 scripts/install-windows.ps1@dbd2dfbab
# What `irm https://vyre.run/w | iex` runs. A Windows PC is a DEVICE: it runs the app and your own compute, and is a full client for the Personal Space and any Space you join.
# It never hosts a Team Space (a Space server is Linux or a Mac). CLI engines (Claude Code, Codex, Grok, Gemini CLI) have no native Windows sandbox: they run inside WSL2 on this PC
# when WSL2 is there, otherwise on the Space server (the person's sandbox container). API engines run in the app's own daemon either way.
#
# Trust: the installer's SHA-256 must match its single line in the release's SHA256SUMS, both fetched over https. Windows PowerShell 5.1 has no Ed25519, so this first install is checked
# for damage, not origin; the installed app verifies every later update against the Vyre release key and refuses anything unsigned.
#
#   -Uninstall   stop the app, remove the autostart task and the install folder
#   -DryRun      print every step, change nothing
#   -Plan        print where CLI engines will run on this PC and exit (needs no install folder)
#
# Env: VYRE_INSTALL_DIR (default $env:LOCALAPPDATA\Vyre), VYRE_RELEASE_BASE (a release's download address). VYRE_CODE is cleared before the app starts and never written anywhere.
param(
    [switch]$Uninstall,
    [switch]$DryRun,
    [switch]$Plan
)

$ErrorActionPreference = "Stop"

# BEGIN engine-route
# Where do CLI engines run? Pure, so the decision is tested without a Windows machine.
#   wsl2          WSL2 with at least one distribution is on this PC
#   space-server  WSL2 is absent or has no distribution, and a Space server is connected
#   none          neither: CLI engines are unavailable until WSL2 is installed or a server is connected (API engines still work)
function Get-VyreEngineRoute {
    param([bool]$Wsl2Ready, [bool]$SpaceServer)
    if ($Wsl2Ready) { return "wsl2" }
    if ($SpaceServer) { return "space-server" }
    return "none"
}

# WSL2 is ready when `wsl.exe --status` reports default version 2 and `wsl.exe -l -q` lists a distribution. $Run is a scriptblock taking the arguments, so a test can answer for it.
function Test-VyreWsl2 {
    param([scriptblock]$Run = { param($WslArgs) & wsl.exe @WslArgs 2>&1 })
    try {
        $status = (& $Run @("--status")) -join "`n"
        $list = @(& $Run @("-l", "-q")) | ForEach-Object { ("$_" -replace "`0", "").Trim() } | Where-Object { $_ -ne "" }
    } catch { return $false }
    if ($status -notmatch "(?i)default version:\s*2" -and $status -notmatch "(?i)Standardversion:\s*2") { return $false }
    return ($list.Count -ge 1)
}

function Get-VyreEngineAdvice {
    param([string]$Route)
    switch ($Route) {
        "wsl2" { return "CLI engines (Claude Code, Codex, Grok, Gemini CLI) run in WSL2 on this PC." }
        "space-server" { return "WSL2 is not set up on this PC, so CLI engines run on your Space server. To run them here, open PowerShell as administrator and run: wsl --install" }
        default { return "CLI engines need WSL2 on this PC or a Space server. API engines work now. To use CLI engines here, open PowerShell as administrator and run: wsl --install" }
    }
}
# END engine-route

function Test-ConstrainedLanguageMode {
    $mode = $ExecutionContext.SessionState.LanguageMode
    if ($mode -ne "FullLanguage") {
        Write-Host ""
        Write-Host "Your PowerShell session is running in $mode, most likely set by your organization's security policy. This installer needs FullLanguage mode." -ForegroundColor Yellow
        Write-Host "Download the installer instead: https://github.com/vyre-ai/vyre-v1/releases (the newest release, file VyreSetup.exe)"
        exit 1
    }
}

function Test-VyreSha256 {
    param([string]$Path, [string]$ExpectedHex)
    $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash
    if ($actual -ine $ExpectedHex) { throw "SHA-256 mismatch for $Path`nexpected: $ExpectedHex`nactual:   $actual" }
}

function Get-VyreVerifiedInstaller {
    param([string]$ReleaseBase, [string]$Dest)
    Write-Host "Windows may say it does not recognize this app. Choose More info, then Run anyway."
    $exePath = Join-Path $Dest "VyreSetup.exe"
    $sumsPath = Join-Path $Dest "SHA256SUMS"
    Invoke-WebRequest -Uri "$ReleaseBase/VyreSetup.exe" -OutFile $exePath -UseBasicParsing
    Invoke-WebRequest -Uri "$ReleaseBase/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing
    $lines = @(Get-Content $sumsPath | Where-Object { $_ -match '^[0-9a-fA-F]{64}\s+\*?VyreSetup\.exe$' })
    if ($lines.Count -ne 1) { throw "SHA256SUMS must list VyreSetup.exe exactly once; refusing to run it." }
    Test-VyreSha256 -Path $exePath -ExpectedHex (($lines[0] -split '\s+')[0])
    return $exePath
}

function Register-VyreAutostart {
    param([string]$ExePath)
    schtasks /create /tn "Vyre" /tr "`"$ExePath`"" /sc onlogon /rl limited /f | Out-Null
}

function Remove-VyreWindows {
    param([string]$InstallDir)
    Write-Host "Uninstalling Vyre..."
    Get-Process -Name "Vyre" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    schtasks /delete /tn "Vyre" /f 2>$null | Out-Null
    if (Test-Path $InstallDir) { Remove-Item -Path $InstallDir -Recurse -Force }
    Write-Host "Done. Your Spaces and their data stay on their servers."
}

function Invoke-VyreInstall {
    if ($Plan -and -not $Uninstall) {
        $route = Get-VyreEngineRoute -Wsl2Ready (Test-VyreWsl2) -SpaceServer $false
        Write-Host "engine-route: $route"
        Write-Host (Get-VyreEngineAdvice -Route $route)
        return
    }
    $installDir = $env:VYRE_INSTALL_DIR
    if (-not $installDir) { $installDir = Join-Path $env:LOCALAPPDATA "Vyre" }

    if ($Uninstall) {
        if ($DryRun) { Write-Host "(dry run) would remove $installDir and the Vyre scheduled task"; return }
        Remove-VyreWindows -InstallDir $installDir
        return
    }

    $route = Get-VyreEngineRoute -Wsl2Ready (Test-VyreWsl2) -SpaceServer $false

    Test-ConstrainedLanguageMode
    if ($DryRun) { Write-Host "(dry run) would install to $installDir, register autostart and start the app"; Write-Host (Get-VyreEngineAdvice -Route $route); return }

    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    $base = $env:VYRE_RELEASE_BASE
    if (-not $base) {
        $feed = (Invoke-WebRequest "https://github.com/vyre-ai/vyre-v1/releases.atom" -UseBasicParsing).Content
        $tag = [regex]::Matches($feed, '/releases/tag/(v\d+\.\d+\.\d+)(?=["<&])') | ForEach-Object { $_.Groups[1].Value } | Sort-Object { [version]($_.TrimStart('v')) } -Descending -Unique | Select-Object -First 1
        if (-not $tag) { throw "No release found." }
        $base = "https://github.com/vyre-ai/vyre-v1/releases/download/$tag"
    }
    $exe = Get-VyreVerifiedInstaller -ReleaseBase $base -Dest $installDir
    Start-Process -FilePath $exe -ArgumentList "/S" -Wait
    $app = Join-Path $env:LOCALAPPDATA "Vyre\Vyre.exe"
    if (-not (Test-Path $app)) { throw "The installer finished but $app is not there." }
    Register-VyreAutostart -ExePath $app
    if ($null -ne $env:VYRE_CODE) { Remove-Item Env:\VYRE_CODE -ErrorAction SilentlyContinue }
    Start-Process -FilePath $app

    Write-Host ""
    Write-Host "Vyre is starting. A window will open to finish setup."
    Write-Host (Get-VyreEngineAdvice -Route $route)
    Write-Host "This PC is a device: it connects to your Spaces and never hosts one."
}

if ($env:VYRE_SOURCE_ONLY -ne "1") { Invoke-VyreInstall }
