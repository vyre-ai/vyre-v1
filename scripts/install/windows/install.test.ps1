# Windows device installer tests (P-L10_11): run with `pwsh -File install.test.ps1`. Dot-sources install.ps1 with VYRE_SOURCE_ONLY=1 and answers wsl.exe from a script.
$ErrorActionPreference = "Stop"
$env:VYRE_SOURCE_ONLY = "1"
. (Join-Path $PSScriptRoot "install.ps1")
$fail = 0
function Check([string]$Name, [bool]$Ok) { if ($Ok) { Write-Host "ok - $Name" } else { Write-Host "not ok - $Name"; $script:fail++ } }

$ready = { param($WslArgs) if ($WslArgs[0] -eq "--status") { "Default Distribution: Ubuntu`nDefault Version: 2" } else { "Ubuntu" } }
$v1 = { param($WslArgs) if ($WslArgs[0] -eq "--status") { "Default Version: 1" } else { "Ubuntu" } }
$noDistro = { param($WslArgs) if ($WslArgs[0] -eq "--status") { "Default Version: 2" } else { "" } }
$absent = { param($WslArgs) throw "wsl.exe is not installed" }

Check "WSL2 with a distribution is ready" (Test-VyreWsl2 -Run $ready)
Check "WSL version 1 is not ready" (-not (Test-VyreWsl2 -Run $v1))
Check "WSL2 without a distribution is not ready" (-not (Test-VyreWsl2 -Run $noDistro))
Check "no wsl.exe is not ready" (-not (Test-VyreWsl2 -Run $absent))

Check "WSL2 ready: CLI engines run in WSL2" ((Get-VyreEngineRoute -Wsl2Ready $true -SpaceServer $true) -eq "wsl2")
Check "WSL2 absent with a Space server: engine selection falls back to the Space server" ((Get-VyreEngineRoute -Wsl2Ready $false -SpaceServer $true) -eq "space-server")
Check "WSL2 absent and no server: no CLI engine, API engines only" ((Get-VyreEngineRoute -Wsl2Ready $false -SpaceServer $false) -eq "none")
Check "advice names wsl --install when WSL2 is missing" ((Get-VyreEngineAdvice -Route "space-server") -match "wsl --install")
Check "advice for WSL2 names no command" ((Get-VyreEngineAdvice -Route "wsl2") -notmatch "wsl --install")

$src = Get-Content (Join-Path $PSScriptRoot "install.ps1") -Raw
Check "the installer has no way to host a Team Space" (($src -notmatch "(?i)docker|caddy|vyre-server|--host") -and ($src -match "never hosts one"))
Check "the setup code is never written to a file" ($src -notmatch "(?i)(Set-Content|Out-File|Add-Content)[^\r\n]*VYRE_CODE")

Write-Host "# fail $fail"
exit $fail
