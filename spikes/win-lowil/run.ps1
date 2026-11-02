# Spike E: a Low-integrity token (made from this user's own token, no admin) and a Job Object (kill on close, limits), no AppContainer. The work folder gets a Low mandatory
# label so it is writable; the network is only steered by HTTPS_PROXY. Shows: whether Claude Code (Bash, PowerShell) and Codex run their tools; which writes are refused; what a Low
# process can READ in the profile (.ssh, browser profiles, Vyre's data folder); whether it reaches the network directly. Run with Windows PowerShell 5.1.
$ErrorActionPreference = 'Continue'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class Low {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct TOKEN_MANDATORY_LABEL { public SID_AND_ATTRIBUTES Label; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct EXT_LIMIT { public BASIC_LIMIT Basic; public IO_COUNTERS Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr t);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr t, uint access, IntPtr sa, int imp, int type, out IntPtr nt);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSid(string s, out IntPtr sid);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr t, int cls, IntPtr info, int len);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUser(IntPtr t, string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr sa, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT_LIMIT info, int len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr p);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);

  static IntPtr LowToken() {
    IntPtr t, nt, sid;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0002 | 0x0008 | 0x0080 | 0x0001, out t)) throw new Win32Exception();
    if (!DuplicateTokenEx(t, 0x02000000, IntPtr.Zero, 2, 1, out nt)) throw new Win32Exception();
    ConvertStringSidToSid("S-1-16-4096", out sid);
    var tml = new TOKEN_MANDATORY_LABEL { Label = new SID_AND_ATTRIBUTES { Sid = sid, Attributes = 0x20 } };
    int len = Marshal.SizeOf(tml) + 12;
    IntPtr p = Marshal.AllocHGlobal(len); Marshal.StructureToPtr(tml, p, false);
    if (!SetTokenInformation(nt, 25, p, len)) throw new Win32Exception();
    return nt;
  }
  // A job that kills every process in it when its handle closes, at most 64 processes and 4 GB each.
  public static IntPtr Job() {
    var job = CreateJobObject(IntPtr.Zero, null);
    var lim = new EXT_LIMIT(); lim.Basic.LimitFlags = 0x2000 | 0x0008 | 0x0100; lim.Basic.ActiveProcessLimit = 64; lim.ProcessMemoryLimit = (UIntPtr)(4UL << 30);
    if (!SetInformationJobObject(job, 9, ref lim, Marshal.SizeOf(lim))) throw new Win32Exception();
    return job;
  }
  public static IntPtr Start(IntPtr job, string cmd, string cwd) {
    var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si);
    PROCESS_INFORMATION pi;
    if (!CreateProcessAsUser(LowToken(), null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x4 | 0x08000000 | 0x400, IntPtr.Zero, cwd, ref si, out pi)) throw new Win32Exception();
    if (!AssignProcessToJobObject(job, pi.hProcess)) throw new Win32Exception();
    ResumeThread(pi.hThread);
    return pi.hProcess;
  }
  public static int Run(string cmd, string cwd, uint ms) {
    var job = Job();
    var h = Start(job, cmd, cwd);
    if (WaitForSingleObject(h, ms) != 0) { CloseHandle(job); return -1; }
    uint code; GetExitCodeProcess(h, out code); CloseHandle(job); return (int)code;
  }
}
'@

function Q([string]$s) { '"' + $s + '"' }
function Tail([string]$p) { if (Test-Path $p) { (Get-Content $p -Tail 12) -join "`n" } else { "(none)" } }
$node = (Get-Command node).Source
$cmd = Join-Path $env:WINDIR "System32\cmd.exe"
$root = Join-Path $env:LOCALAPPDATA "vyre-low"
$bin = "$root\bin"; $w = "$root\w"; $lh = "$root\home"
foreach ($d in @($bin, $w, $lh, "$lh\tmp", "$lh\.claude", "$lh\.codex")) { New-Item -ItemType Directory -Force $d | Out-Null }
# the work folder and the engine's home are Low: a Low process may write there and nowhere else
icacls $w /setintegritylevel "(OI)(CI)low" | Out-Null
icacls $lh /setintegritylevel "(OI)(CI)low" /T | Out-Null
"labels: $((icacls $w | Select-String 'Mandatory') -join ' ')"
node "$PSScriptRoot\..\win-engines\fetch.mjs" "https://downloads.claude.ai/claude-code-releases/2.1.316/win32-x64/claude.exe.zst" "26af66d4fa70e980047d54c85140579de0271d79a9257ac467f90a0ecdca528d" "$bin\claude.exe"
node "$PSScriptRoot\..\win-engines\fetch.mjs" "https://github.com/openai/codex/releases/download/rust-v0.166.0/codex-x86_64-pc-windows-msvc.exe.zst" "5aa3c88e75bd0c843c48e2fe7062999546f0d3094a3361659c2d731dfdf84960" "$bin\codex.exe"
Copy-Item "$PSScriptRoot\..\win-appcontainer\probe.mjs" $w
# a copy of Node beside the engines (the runner's tool cache may carry its own label); both are tried below
Copy-Item $node "$bin\node.exe"
$nodeCache = $node
$node = "$bin\node.exe"
$env:TEMP = "$lh\tmp"; $env:TMP = "$lh\tmp"
"=== can a Low process start anything"
$e1 = [Low]::Run((Q $cmd) + ' /c "echo hi> ' + (Q "$w\echo.txt") + '"', $w, 30000)
"cmd echo: exit $e1, wrote: $(Tail "$w\echo.txt")"
$e2 = [Low]::Run((Q $cmd) + ' /c "' + (Q $nodeCache) + ' --version > ' + (Q "$w\v1.txt") + ' 2>&1"', $w, 30000)
"tool-cache node: exit $e2, said: $(Tail "$w\v1.txt")"
$e3 = [Low]::Run((Q $cmd) + ' /c "' + (Q $node) + ' --version > ' + (Q "$w\v2.txt") + ' 2>&1"', $w, 30000)
"copied node: exit $e3, said: $(Tail "$w\v2.txt")"
"tool-cache node label: $((icacls $nodeCache | Select-String 'Mandatory') -join ' ')"

# things a person keeps in their profile; fakes where the runner has none
$secrets = [ordered]@{
  "ssh key"                 = "$env:USERPROFILE\.ssh\id_ed25519"
  "Chrome cookies"          = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Network\Cookies"
  "Edge saved logins"       = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Login Data"
  "Firefox profile"         = "$env:APPDATA\Mozilla\Firefox\Profiles\spike.default\logins.json"
  "Vyre Personal Space"     = "$env:APPDATA\ai.vyre.desktop\personal\vyre.db"
  "Claude Code sign-in"     = "$env:USERPROFILE\.claude\.credentials.json"
  "Codex sign-in"           = "$env:USERPROFILE\.codex\auth.json"
  "a document"              = "$env:USERPROFILE\Documents\private.txt"
}
foreach ($k in $secrets.Keys) { $p = $secrets[$k]; if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force (Split-Path $p) | Out-Null; Set-Content $p "secret: $k" } }

$n = 0
function Probe([string]$mode, [string]$arg, [string]$label) {
  $script:n++
  $out = "$w\p-$script:n.json"; $err = "$w\p-$script:n.err"
  $code = [Low]::Run((Q $cmd) + ' /c "' + (Q $node) + ' ' + (Q "$w\probe.mjs") + ' ' + $mode + ' ' + (Q $out) + ' ' + (Q $arg) + ' > ' + (Q $err) + ' 2>&1"', $w, 60000)
  "probe ${label}: $(if (Test-Path $out) { (Get-Content $out -Raw).Trim() } else { "no answer (exit $code) $(Tail $err)" })"
}
"=== reads by a Low process"
foreach ($k in $secrets.Keys) { Probe "read" $secrets[$k] "read $k" }
Probe "list" $env:USERPROFILE "list the profile"
Probe "list" "$env:APPDATA\ai.vyre.desktop" "list Vyre's data folder"
"=== writes by a Low process"
Probe "write" "$w\inside.txt" "write the work folder (Low label)"
Probe "write" "$env:USERPROFILE\low-wrote.txt" "write the profile"
Probe "write" "$env:APPDATA\ai.vyre.desktop\low-wrote.txt" "write Vyre's data folder"
Probe "write" "$env:TEMP\low-wrote.txt" "write %TEMP%"
Probe "write" "$($env:LOCALAPPDATA)Low\low-wrote.txt" "write LocalLow"
"=== network from a Low process, with no proxy set"
Probe "internet" "" "fetch https://api.anthropic.com directly"
$hp = Join-Path $root "hostport.txt"
$hostSrv = Start-Process -PassThru -WindowStyle Hidden $node -ArgumentList ((Q "$PSScriptRoot\..\win-appcontainer\host.mjs"), (Q $hp))
for ($i = 0; $i -lt 50 -and -not (Test-Path $hp); $i++) { Start-Sleep -Milliseconds 200 }
Probe "host-loopback" (Get-Content $hp -Raw).Trim() "the host's loopback (the daemon's own ports)"
Stop-Process -Id $hostSrv.Id -Force -ErrorAction SilentlyContinue

"=== the Job Object kills the whole tree"
$job = [Low]::Job()
$h = [Low]::Start($job, (Q $cmd) + ' /c "start /b ping -n 120 127.0.0.1 > nul & ping -n 120 127.0.0.1 > nul"', $w)
Start-Sleep -Seconds 3
$before = @(Get-Process ping -ErrorAction SilentlyContinue).Count
[void][Low]::CloseHandle($job)
Start-Sleep -Seconds 2
"ping processes in the job: $before before closing it, $(@(Get-Process ping -ErrorAction SilentlyContinue).Count) after"

"=== the engines as a Low process, against a fake API on the host"
$apiPortFile = "$root\api-port.txt"; $apiLog = "$root\api.log"; $modeFile = "$root\mode.txt"
$api = Start-Process -PassThru -WindowStyle Hidden $node -ArgumentList ((Q "$PSScriptRoot\..\win-engines\fakeapi.mjs"), (Q $apiPortFile), (Q $apiLog), (Q $modeFile))
for ($i = 0; $i -lt 50 -and -not (Test-Path $apiPortFile); $i++) { Start-Sleep -Milliseconds 200 }
$apiPort = (Get-Content $apiPortFile -Raw).Trim()
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:$apiPort"; $env:ANTHROPIC_API_KEY = "sk-ant-fake"; $env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"; $env:DISABLE_AUTOUPDATER = "1"; $env:FAKE_KEY = "fake"
$env:CLAUDE_CODE_GIT_BASH_PATH = "C:\Program Files\Git\bin\bash.exe"; $env:CLAUDE_CODE_USE_POWERSHELL_TOOL = "1"
$env:USERPROFILE = $lh; $env:HOME = $lh; $env:TEMP = "$lh\tmp"; $env:TMP = "$lh\tmp"; $env:CLAUDE_CONFIG_DIR = "$lh\.claude"; $env:CODEX_HOME = "$lh\.codex"
$claudeArgs = '-p "Run the tool once." --output-format text --permission-mode bypassPermissions --model claude-sonnet-4-5'
$codexArgs = 'exec --skip-git-repo-check -s danger-full-access -m fake -c model_provider=fake -c model_providers.fake.name=fake -c model_providers.fake.base_url=http://127.0.0.1:' + $apiPort + '/v1 -c model_providers.fake.wire_api=responses -c model_providers.fake.env_key=FAKE_KEY "Run the tool once."'
foreach ($m in @("bash", "powershell", "codex")) {
  Set-Content $modeFile $m
  $o = "$w\e-$m.out"; $e = "$w\e-$m.err"
  $exe = if ($m -eq "codex") { "$bin\codex.exe" } else { "$bin\claude.exe" }
  $a = if ($m -eq "codex") { $codexArgs } else { $claudeArgs }
  $code = [Low]::Run((Q $cmd) + ' /c "' + (Q $exe) + ' ' + $a + ' > ' + (Q $o) + ' 2> ' + (Q $e) + '"', $w, 180000)
  "--- low $m exit=$code"
  "tool file: $(if (Test-Path "$w\spike-tool.txt") { (Get-Content "$w\spike-tool.txt" -Raw).Trim() } else { 'MISSING' })"
  "stdout: $(Tail $o)"
  "stderr: $(Tail $e)"
  "tool result: $(if (Test-Path $apiLog) { ((Get-Content $apiLog | Select-String 'toolResult') -join ' || ').Substring(0, [Math]::Min(400, ((Get-Content $apiLog | Select-String 'toolResult') -join ' || ').Length)) })"
  Remove-Item $apiLog, "$w\spike-tool.txt" -ErrorAction SilentlyContinue
}
Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
