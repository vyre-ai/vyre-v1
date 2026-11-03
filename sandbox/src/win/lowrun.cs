// vyre-lowrun: starts a CLI engine on Windows at Low integrity, in a Job Object (docs/windows-engine-sandbox.md, option E; owner ruling 3 Nov 2026).
// Low integrity is Windows' own "can read, cannot change" level: the engine can write only to folders labelled Low (the folders Vyre labels for it) and changes nothing else on the computer.
// The Job Object kills the engine and everything it started when this program ends, so a turn that is stopped or a daemon that exits leaves nothing running.
//
// usage: vyre-lowrun.exe [--env <base64 of K=V\0K=V\0...>] -- <the engine's command line, exactly as it should be>
//        vyre-lowrun.exe --label <folder> <SDDL label, e.g. S:(ML;OICI;NRNW;;;ME)>   sets a folder's mandatory label, inherited by everything under it
// The command line after " -- " is passed to CreateProcessAsUser as it is: the caller quoted it for the engine. The token is this user's own, lowered; no admin, no other account.
// Built once on the person's computer by the .NET Framework compiler that ships with Windows (sandbox/src/win/lowrun.ts).
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class LowRun {
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
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUser(IntPtr t, string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr sa, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT_LIMIT info, int len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr p);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetCommandLine();
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint rev, out IntPtr sd, out uint size);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorSacl(IntPtr sd, out bool present, out IntPtr sacl, out bool defaulted);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern uint SetNamedSecurityInfo(string name, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);

  // A folder's mandatory label (LABEL_SECURITY_INFORMATION): Windows passes an inheritable label on to what is under the folder. Setting a label at or below one's own level needs no admin.
  static int Label(string path, string sddl) {
    IntPtr sd, sacl; uint size; bool present, defaulted;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out sd, out size)) return Fail("the label " + sddl);
    if (!GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted) || !present) return Fail("the label's SACL");
    // LABEL_SECURITY_INFORMATION, protected: this label stands, whatever the parent passes on
    uint err = SetNamedSecurityInfo(path, 1, 0x10 | 0x40000000, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
    if (err != 0) { Console.Error.WriteLine("vyre-lowrun: could not label " + path + ": " + new Win32Exception((int)err).Message); return 1; }
    return 0;
  }

  const uint TOKEN_ALL = 0x0001 | 0x0002 | 0x0008 | 0x0080;
  const int TokenIntegrityLevel = 25;
  const uint SE_GROUP_INTEGRITY = 0x20;
  const uint KILL_ON_JOB_CLOSE = 0x2000, DIE_ON_UNHANDLED_EXCEPTION = 0x0400, ACTIVE_PROCESS = 0x0008;
  const uint CREATE_SUSPENDED = 0x4, CREATE_UNICODE_ENVIRONMENT = 0x400;

  static int Fail(string what) { Console.Error.WriteLine("vyre-lowrun: " + what + ": " + new Win32Exception(Marshal.GetLastWin32Error()).Message); return 126; }

  public static int Main(string[] args) {
    if (args.Length == 3 && args[0] == "--label") return Label(args[1], args[2]);
    // the engine's command line: everything after the first " -- ", untouched
    string raw = Marshal.PtrToStringUni(GetCommandLine());
    int at = raw.IndexOf(" -- ", StringComparison.Ordinal);
    if (at < 0) { Console.Error.WriteLine("vyre-lowrun: nothing to run"); return 2; }
    string child = raw.Substring(at + 4);
    for (int i = 0; i + 1 < args.Length && args[i] != "--"; i++) {
      if (args[i] != "--env") continue;
      foreach (string kv in Encoding.UTF8.GetString(Convert.FromBase64String(args[i + 1])).Split('\0')) {
        int eq = kv.IndexOf('=');
        if (eq > 0) Environment.SetEnvironmentVariable(kv.Substring(0, eq), kv.Substring(eq + 1));
      }
    }

    IntPtr own, low, sid;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ALL, out own)) return Fail("OpenProcessToken");
    if (!DuplicateTokenEx(own, 0x02000000, IntPtr.Zero, 2, 1, out low)) return Fail("DuplicateTokenEx");
    if (!ConvertStringSidToSid("S-1-16-4096", out sid)) return Fail("ConvertStringSidToSid");
    var tml = new TOKEN_MANDATORY_LABEL { Label = new SID_AND_ATTRIBUTES { Sid = sid, Attributes = SE_GROUP_INTEGRITY } };
    int len = Marshal.SizeOf(tml) + 12;
    IntPtr p = Marshal.AllocHGlobal(len);
    Marshal.StructureToPtr(tml, p, false);
    if (!SetTokenInformation(low, TokenIntegrityLevel, p, len)) return Fail("SetTokenInformation");

    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return Fail("CreateJobObject");
    var lim = new EXT_LIMIT();
    lim.Basic.LimitFlags = KILL_ON_JOB_CLOSE | DIE_ON_UNHANDLED_EXCEPTION | ACTIVE_PROCESS;
    lim.Basic.ActiveProcessLimit = 512;
    if (!SetInformationJobObject(job, 9, ref lim, Marshal.SizeOf(lim))) return Fail("SetInformationJobObject");

    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(si);
    si.dwFlags = 0x100;
    si.hStdInput = GetStdHandle(-10); si.hStdOutput = GetStdHandle(-11); si.hStdError = GetStdHandle(-12);
    foreach (IntPtr h in new[] { si.hStdInput, si.hStdOutput, si.hStdError }) if (h != IntPtr.Zero && h != new IntPtr(-1)) SetHandleInformation(h, 1, 1);
    PROCESS_INFORMATION pi;
    if (!CreateProcessAsUser(low, null, new StringBuilder(child), IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, null, ref si, out pi)) return Fail("could not start the engine");
    if (!AssignProcessToJobObject(job, pi.hProcess)) return Fail("AssignProcessToJobObject");
    ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code;
    GetExitCodeProcess(pi.hProcess, out code);
    return (int)code;
  }
}
