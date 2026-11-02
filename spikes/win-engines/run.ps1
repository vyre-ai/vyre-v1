# Spike: real Claude Code and Codex inside a capability-less AppContainer (no admin). The model API is a fake on the host; the only way to it is a bridge inside the container that carries
# each connection over a named pipe whose DACL names the container. Each engine is asked for one tool call (Bash, PowerShell, Codex's shell); the tool must write spike-tool.txt in the work folder.
# A control run outside the container first proves the fake API. Run with Windows PowerShell 5.1.
$ErrorActionPreference = 'Continue'
Add-Type -ReferencedAssemblies System.Core,System -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;

public static class Ac {
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string desc, IntPtr caps, uint count, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] public static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr str);
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr val, IntPtr size, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);

  static IntPtr SidPtr(string name) {
    IntPtr sid;
    int hr = CreateAppContainerProfile(name, name, name, IntPtr.Zero, 0, out sid);
    if (hr != 0 && DeriveAppContainerSidFromAppContainerName(name, out sid) != 0) throw new Win32Exception(hr);
    return sid;
  }
  public static string Sid(string name) { IntPtr s; ConvertSidToStringSid(SidPtr(name), out s); return Marshal.PtrToStringUni(s); }

  // Starts a contained process and returns at once (its handle, to stop it later).
  public static IntPtr Start(string name, string cmd, string cwd) {
    var caps = new SECURITY_CAPABILITIES { AppContainerSid = SidPtr(name) };
    IntPtr capsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(caps)); Marshal.StructureToPtr(caps, capsPtr, false);
    IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
    IntPtr list = Marshal.AllocHGlobal(size);
    if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw new Win32Exception();
    if (!UpdateProcThreadAttribute(list, 0, (IntPtr)0x00020009, capsPtr, (IntPtr)Marshal.SizeOf(caps), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
    var si = new STARTUPINFOEX(); si.StartupInfo.cb = Marshal.SizeOf(si); si.lpAttributeList = list;
    PROCESS_INFORMATION pi;
    if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00080000 | 0x08000000, IntPtr.Zero, cwd, ref si, out pi)) throw new Win32Exception();
    return pi.hProcess;
  }
  public static void Stop(IntPtr h) { TerminateProcess(h, 0); }

  public static int Run(string name, string cmd, string cwd, uint ms) {
    var caps = new SECURITY_CAPABILITIES { AppContainerSid = SidPtr(name) };
    IntPtr capsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(caps)); Marshal.StructureToPtr(caps, capsPtr, false);
    IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
    IntPtr list = Marshal.AllocHGlobal(size);
    if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw new Win32Exception();
    if (!UpdateProcThreadAttribute(list, 0, (IntPtr)0x00020009, capsPtr, (IntPtr)Marshal.SizeOf(caps), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
    var si = new STARTUPINFOEX(); si.StartupInfo.cb = Marshal.SizeOf(si); si.lpAttributeList = list;
    PROCESS_INFORMATION pi;
    if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00080000 | 0x08000000, IntPtr.Zero, cwd, ref si, out pi)) throw new Win32Exception();
    if (WaitForSingleObject(pi.hProcess, ms) != 0) { TerminateProcess(pi.hProcess, 99); return -1; }
    uint code; GetExitCodeProcess(pi.hProcess, out code); return (int)code;
  }


  // A pipe the container may open (DACL: its SID and this user). Each connection is carried to 127.0.0.1:port on the host: the egress proxy in Vyre, the fake API here.
  public static void RelayPipe(string pipe, string sid, int port) {
    var sec = new PipeSecurity();
    sec.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(sid), PipeAccessRights.ReadWrite, AccessControlType.Allow));
    sec.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
    var t = new Thread(() => {
      while (true) {
        var s = new NamedPipeServerStream(pipe, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, sec);
        s.WaitForConnection();
        var c = new System.Net.Sockets.TcpClient("127.0.0.1", port);
        var n = c.GetStream();
        var a = new Thread(() => { try { s.CopyTo(n); } catch { } try { c.Client.Shutdown(System.Net.Sockets.SocketShutdown.Send); } catch { } });
        var b = new Thread(() => { try { n.CopyTo(s); } catch { } try { s.Dispose(); } catch { } try { c.Close(); } catch { } });
        a.IsBackground = true; b.IsBackground = true; a.Start(); b.Start();
      }
    });
    t.IsBackground = true; t.Start();
  }

  // A pipe whose DACL lets the container's SID (and this user) in; answers "hi" to each of a few connections.
  public static void ServePipe(string pipe, string sid) {
    var sec = new PipeSecurity();
    sec.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(sid), PipeAccessRights.ReadWrite, AccessControlType.Allow));
    sec.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
    var t = new Thread(() => {
      for (int i = 0; i < 4; i++) {
        using (var s = new NamedPipeServerStream(pipe, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.None, 4096, 4096, sec)) {
          s.WaitForConnection(); var b = System.Text.Encoding.ASCII.GetBytes("hi"); s.Write(b, 0, b.Length); s.Flush(); s.WaitForPipeDrain();
        }
      }
    });
    t.IsBackground = true; t.Start();
  }
}
'@

function Q([string]$s) { '"' + $s + '"' }
function Tail([string]$p) { if (Test-Path $p) { (Get-Content $p -Tail 15) -join "`n" } else { "(none)" } }

# on C: under the profile, where a real data folder is: the runner's D: drive root is closed to app containers, which no person's C: is
$root = Join-Path $env:LOCALAPPDATA "vyre-eng"
$bin = Join-Path $root "bin"; $w = Join-Path $root "w"; $home2 = Join-Path $root "home"; $wc = Join-Path $root "control"
foreach ($d in @($bin, $w, $home2, $wc, "$home2\tmp", "$home2\.claude", "$home2\.codex")) { New-Item -ItemType Directory -Force $d | Out-Null }
$node = (Get-Command node).Source
node "$PSScriptRoot\fetch.mjs" "https://downloads.claude.ai/claude-code-releases/2.1.316/win32-x64/claude.exe.zst" "26af66d4fa70e980047d54c85140579de0271d79a9257ac467f90a0ecdca528d" "$bin\claude.exe"
node "$PSScriptRoot\fetch.mjs" "https://github.com/openai/codex/releases/download/rust-v0.166.0/codex-x86_64-pc-windows-msvc.exe.zst" "5aa3c88e75bd0c843c48e2fe7062999546f0d3094a3361659c2d731dfdf84960" "$bin\codex.exe"
Copy-Item "$PSScriptRoot\bridge.mjs" $w
Copy-Item "$PSScriptRoot\..\win-appcontainer\probe.mjs" $w

$name = "vyre.engines.$PID"
$sid = [Ac]::Sid($name)
"container sid $sid"
icacls $w /grant "*${sid}:(OI)(CI)F" /Q | Out-Null
icacls $home2 /grant "*${sid}:(OI)(CI)F" /T /Q | Out-Null
icacls $bin /grant "*${sid}:(OI)(CI)RX" /T /Q | Out-Null
icacls (Split-Path $node) /grant "*${sid}:(OI)(CI)RX" /T /Q | Out-Null
"git bash acl: $((icacls 'C:\Program Files\Git\bin\bash.exe' | Select-String 'APPLICATION') -join ' ')"

$apiPortFile = Join-Path $root "api-port.txt"; $apiLog = Join-Path $root "api.log"; $modeFile = Join-Path $root "mode.txt"
$api = Start-Process -PassThru -WindowStyle Hidden $node -ArgumentList ((Q "$PSScriptRoot\fakeapi.mjs"), (Q $apiPortFile), (Q $apiLog), (Q $modeFile))
for ($i = 0; $i -lt 50 -and -not (Test-Path $apiPortFile); $i++) { Start-Sleep -Milliseconds 200 }
$apiPort = (Get-Content $apiPortFile -Raw).Trim()
"fake api on 127.0.0.1:$apiPort"

$env:ANTHROPIC_API_KEY = "sk-ant-fake"; $env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"; $env:DISABLE_AUTOUPDATER = "1"; $env:FAKE_KEY = "fake"
$env:CLAUDE_CODE_GIT_BASH_PATH = "C:\Program Files\Git\bin\bash.exe"; $env:CLAUDE_CODE_USE_POWERSHELL_TOOL = "1"
$claudeArgs = '-p "Run the tool once." --output-format text --permission-mode bypassPermissions --model claude-sonnet-4-5'
function CodexArgs([string]$port) { 'exec --skip-git-repo-check -s danger-full-access -m fake -c model_provider=fake -c model_providers.fake.name=fake -c model_providers.fake.base_url=http://127.0.0.1:' + $port + '/v1 -c model_providers.fake.wire_api=responses -c model_providers.fake.env_key=FAKE_KEY "Run the tool once."' }

function Report([string]$label, [string]$dir, [string]$out, [string]$err, $code) {
  "=== $label exit=$code"
  "tool file: $(if (Test-Path "$dir\spike-tool.txt") { (Get-Content "$dir\spike-tool.txt" -Raw).Trim() } else { 'MISSING' })"
  "stdout: $(Tail $out)"
  "stderr: $(Tail $err)"
  "api: $(if (Test-Path $apiLog) { (Get-Content $apiLog | Select-String 'toolResult|tools') -join ' || ' })"
  Remove-Item $apiLog -ErrorAction SilentlyContinue
  Remove-Item "$dir\spike-tool.txt" -ErrorAction SilentlyContinue
}

# control: the same engines outside the container, straight to the fake API, so a failure below is the container's
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:$apiPort"
foreach ($m in @("bash", "codex")) {
  Set-Content $modeFile $m
  $o = "$root\c-$m.out"; $e = "$root\c-$m.err"
  $exe = if ($m -eq "codex") { "$bin\codex.exe" } else { "$bin\claude.exe" }
  $a = if ($m -eq "codex") { CodexArgs $apiPort } else { $claudeArgs }
  $p = Start-Process -PassThru -Wait -WindowStyle Hidden -WorkingDirectory $wc -FilePath $exe -ArgumentList $a -RedirectStandardOutput $o -RedirectStandardError $e
  Report "control $m" $wc $o $e $p.ExitCode
}

# the container: the bridge is the only way out, over the pipe to the host
[Ac]::RelayPipe("vyre-spike-api", $sid, [int]$apiPort)
$bpf = Join-Path $w "bridge-port.txt"
$hb = [Ac]::Start($name, ((Q $node) + ' --preserve-symlinks --preserve-symlinks-main ' + (Q "$w\bridge.mjs") + ' ' + (Q $bpf) + ' ' + (Q '\\.\pipe\vyre-spike-api')), $w)
for ($i = 0; $i -lt 50 -and -not (Test-Path $bpf); $i++) { Start-Sleep -Milliseconds 200 }
$bp = (Get-Content $bpf -Raw).Trim()
"bridge in the container on 127.0.0.1:$bp"
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:$bp"
$env:USERPROFILE = $home2; $env:HOME = $home2; $env:TEMP = "$home2\tmp"; $env:TMP = "$home2\tmp"; $env:CLAUDE_CONFIG_DIR = "$home2\.claude"; $env:CODEX_HOME = "$home2\.codex"
$cmd = Join-Path $env:WINDIR "System32\cmd.exe"
# how a contained Node starts children, on C:
$po = "$w\spawn.json"; $pe = "$w\spawn.err"
$code = [Ac]::Run($name, (Q $cmd) + ' /c "' + (Q $node) + ' --preserve-symlinks --preserve-symlinks-main ' + (Q "$w\probe.mjs") + ' spawn ' + (Q $po) + ' x > ' + (Q $pe) + ' 2>&1"', $w, 60000)
"=== node spawn in the container (exit $code): $(Tail $po) $(Tail $pe)"
foreach ($m in @("bash", "powershell", "codex")) {
  Set-Content $modeFile $m
  $o = "$w\in-$m.out"; $e = "$w\in-$m.err"
  $exe = if ($m -eq "codex") { "$bin\codex.exe" } else { "$bin\claude.exe" }
  $a = if ($m -eq "codex") { CodexArgs $bp } else { $claudeArgs }
  $line = (Q $cmd) + ' /c "' + (Q $exe) + ' ' + $a + ' > ' + (Q $o) + ' 2> ' + (Q $e) + '"'
  $code = [Ac]::Run($name, $line, $w, 180000)
  Report "container $m" $w $o $e $code
}
[Ac]::Stop($hb)
Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
[void][Ac]::DeleteAppContainerProfile($name)
