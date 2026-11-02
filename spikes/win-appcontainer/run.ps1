# Spike: what a capability-less AppContainer allows a Node process on Windows, launched by an ordinary process (no admin APIs are called: CreateAppContainerProfile, CreateProcess with
# SECURITY_CAPABILITIES, icacls on folders the user owns, a named pipe with a DACL). Prints one JSON line per probe. Run with Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Core -TypeDefinition @'
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

$name = "vyre.spike.$PID"
$sid = [Ac]::Sid($name)
"container sid $sid"
$w = Join-Path $env:RUNNER_TEMP "acw"
New-Item -ItemType Directory -Force $w | Out-Null
Copy-Item "$PSScriptRoot\probe.mjs" $w
icacls $w /grant "*${sid}:(OI)(CI)F" | Out-Null
$node = (Get-Command node).Source
icacls (Split-Path $node) /grant "*${sid}:(OI)(CI)RX" | Out-Null
$secret = Join-Path $env:USERPROFILE "vyre-spike-secret.txt"
Set-Content $secret "a secret outside the folder"
$portFile = Join-Path $env:RUNNER_TEMP "port.txt"
$host1 = Start-Process -PassThru -WindowStyle Hidden $node -ArgumentList "`"$PSScriptRoot\host.mjs`" `"$portFile`""
for ($i = 0; $i -lt 50 -and -not (Test-Path $portFile); $i++) { Start-Sleep -Milliseconds 200 }
$port = Get-Content $portFile
[Ac]::ServePipe("vyre-spike-acl", $sid)

$probes = @(
  @("same-process-loopback", ""),
  @("cross-process-loopback", ""),
  @("host-loopback", $port),
  @("pipe", "\\.\pipe\vyre-spike-node"),
  @("pipe", "\\.\pipe\vyre-spike-acl"),
  @("internet", ""),
  @("read", $secret),
  @("list", $env:USERPROFILE),
  @("write", (Join-Path $w "inside.txt")),
  @("write", (Join-Path $env:RUNNER_TEMP "outside.txt")),
  @("read", (Join-Path $env:WINDIR "win.ini"))
)
$n = 0
foreach ($p in $probes) {
  $n++
  $out = Join-Path $w "out-$n.json"
  $code = [Ac]::Run($name, "`"$node`" `"$w\probe.mjs`" $($p[0]) `"$out`" `"$($p[1])`"", $w, 30000)
  if (Test-Path $out) { "probe $($p[0]) $($p[1]): $(Get-Content $out -Raw)".Trim() } else { "probe $($p[0]) $($p[1]): no answer (exit $code)" }
}
Stop-Process -Id $host1.Id -Force -ErrorAction SilentlyContinue
[void][Ac]::DeleteAppContainerProfile($name)
