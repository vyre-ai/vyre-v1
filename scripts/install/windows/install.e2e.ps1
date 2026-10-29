# The Windows install, proven end to end on a real Windows runner (.github/workflows/desktop.yml, Windows leg). Not for a person's PC: it installs, launches and removes Vyre.
# Each phase either passes or throws, so the job fails at the step that broke.
#   -Phase silent-install  run VyreSetup.exe /S (what the NSIS installer does for install.ps1) and print the installed program's path
#   -Phase nsis-uninstall  run the installer's own uninstaller and check the folder and the uninstall entry are gone
#   -Phase via-script      serve the folder holding VyreSetup.exe and SHA256SUMS on loopback, run install.ps1 against it, check the program, that it runs, that its daemon answers and the autostart task
#   -Phase script-uninstall run install.ps1 -Uninstall and check nothing is left
param(
    [Parameter(Mandatory = $true)][ValidateSet("silent-install", "nsis-uninstall", "via-script", "script-uninstall")][string]$Phase,
    [string]$SetupExe,
    [string]$ReleaseDir
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:LOCALAPPDATA "Vyre"

function Fail([string]$why) { Write-Host "FAIL $why"; exit 1 }
function Step([string]$what) { Write-Host "ok   $what" }

# Find-VyreApp is install.ps1's own answer to "where did the installer put the program"
$env:VYRE_SOURCE_ONLY = "1"
. (Join-Path $here "install.ps1")
Remove-Item Env:\VYRE_SOURCE_ONLY

function Get-UninstallEntries { @(Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like "Vyre*" }) }
function Stop-Vyre { Get-Process -Name "vyre-desktop", "vyred", "Vyre" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }

switch ($Phase) {
    "silent-install" {
        if (-not (Test-Path $SetupExe)) { Fail "no installer at $SetupExe" }
        if (Test-Path $installDir) { Fail "$installDir exists before the install" }
        $p = Start-Process -FilePath $SetupExe -ArgumentList "/S" -Wait -PassThru
        if ($p.ExitCode -ne 0) { Fail "VyreSetup.exe /S exited $($p.ExitCode)" }
        $app = Find-VyreApp -LocalAppData $env:LOCALAPPDATA
        if (-not $app) { Fail "the installer finished but install.ps1 would not find the program in $installDir (found: $((Get-ChildItem $installDir -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', '))" }
        Step "silent install put the program at $app"
        if ((Get-UninstallEntries).Count -lt 1) { Fail "no uninstall entry was registered" }
        Step "an uninstall entry is registered"
        Write-Output $app
    }
    "nsis-uninstall" {
        $u = Join-Path $installDir "uninstall.exe"
        if (-not (Test-Path $u)) { Fail "no uninstall.exe in $installDir" }
        Stop-Vyre
        # _?= keeps the uninstaller in place so -Wait really waits; it cannot delete itself, so the folder is removed after
        $p = Start-Process -FilePath $u -ArgumentList "/S", "_?=$installDir" -Wait -PassThru
        if ($p.ExitCode -ne 0) { Fail "uninstall.exe /S exited $($p.ExitCode)" }
        Remove-Item -Path $installDir -Recurse -Force
        if ((Get-UninstallEntries).Count -ne 0) { Fail "the uninstall entry is still there" }
        Step "the installer's own uninstaller removed the program and its entry"
    }
    "via-script" {
        if (-not (Test-Path (Join-Path $ReleaseDir "VyreSetup.exe")) -or -not (Test-Path (Join-Path $ReleaseDir "SHA256SUMS"))) { Fail "$ReleaseDir needs VyreSetup.exe and SHA256SUMS" }
        # Windows PowerShell 5.1 reads http reliably and file: not; serve the folder on loopback with the node that is on the runner
        $serverJs = Join-Path $env:RUNNER_TEMP "serve.js"
        Set-Content -Path $serverJs -Value 'const h=require("http"),f=require("fs"),p=require("path");const d=process.argv[2];h.createServer((q,r)=>{const n=p.basename(decodeURIComponent(q.url.split("?")[0]));const x=p.join(d,n);if(!f.existsSync(x)){r.writeHead(404);r.end();return}r.writeHead(200);f.createReadStream(x).pipe(r)}).listen(8765,"127.0.0.1");'
        $server = Start-Process -FilePath "node" -ArgumentList $serverJs, $ReleaseDir -PassThru -WindowStyle Hidden
        try {
            Start-Sleep -Seconds 2
            $env:VYRE_RELEASE_BASE = "http://127.0.0.1:8765"
            & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here "install.ps1")
            if ($LASTEXITCODE -ne 0) { Fail "install.ps1 exited $LASTEXITCODE" }
            $app = Find-VyreApp -LocalAppData $env:LOCALAPPDATA
            if (-not $app) { Fail "install.ps1 finished but no program is in $installDir" }
            Step "install.ps1 installed $app from a local SHA256SUMS"
            $deadline = (Get-Date).AddSeconds(90); $url = $null
            while ((Get-Date) -lt $deadline -and -not $url) {
                foreach ($n in "server", "personal", "vyred") {
                    $info = Join-Path $env:APPDATA "ai.vyre.desktop\$n\vyred.json"
                    if (Test-Path $info) { try { $u = (Get-Content $info -Raw | ConvertFrom-Json).url; if ($u) { Invoke-WebRequest "$u/healthz" -UseBasicParsing -TimeoutSec 3 | Out-Null; $url = $u; break } } catch { } }
                }
                if (-not $url) { Start-Sleep -Seconds 2 }
            }
            if (-not $url) { Fail "the installed app started but its daemon never answered /healthz" }
            Step "the installed app is running and its daemon answers at $url"
            if (-not (Get-Process -Name "vyre-desktop", "Vyre" -ErrorAction SilentlyContinue)) { Fail "the app is not running" }
            $task = schtasks /query /tn "Vyre" 2>&1
            if ($LASTEXITCODE -ne 0) { Fail "the autostart task 'Vyre' was not registered: $task" }
            Step "the autostart task is registered"
            Stop-Vyre
        } finally {
            Remove-Item Env:\VYRE_RELEASE_BASE -ErrorAction SilentlyContinue
            if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
        }
    }
    "script-uninstall" {
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here "install.ps1") -Uninstall
        if ($LASTEXITCODE -ne 0) { Fail "install.ps1 -Uninstall exited $LASTEXITCODE" }
        if (Test-Path $installDir) { Fail "$installDir is still there" }
        if (Get-Process -Name "vyre-desktop", "vyred", "Vyre" -ErrorAction SilentlyContinue) { Fail "a Vyre process is still running" }
        schtasks /query /tn "Vyre" 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Fail "the autostart task is still registered" }
        if ((Get-UninstallEntries).Count -ne 0) { Fail "the uninstall entry is still there" }
        Step "install.ps1 -Uninstall left nothing behind"
    }
}
