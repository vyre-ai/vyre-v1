// vyre-lowrun: starts a CLI engine on Windows at Low integrity, in a Job Object (docs/windows-engine-sandbox.md, option E; owner ruling 3 Nov 2026).
// Low integrity is Windows' own "can read, cannot change" level: the engine can write only to folders labelled Low (the folders Vyre labels for it) and changes nothing else on the computer.
// The Job Object kills the engine and everything it started when this program ends, so a turn that is stopped or a daemon that exits leaves nothing running.
//
// usage: vyre-lowrun.exe [--env <base64 of K=V\0K=V\0...>] [--agent-relay <pipe name> <agent pipe name>] -- <the engine's command line, exactly as it should be>
//        vyre-lowrun.exe --label <folder> <SDDL label, e.g. S:(ML;OICI;NRNW;;;ME)>   sets a folder's mandatory label, inherited by everything under it
//        vyre-ssh-*.exe <ssh's arguments> (a copy of this program under that name, or vyre-lowrun.exe --ssh ...): git's GIT_SSH. Runs Windows OpenSSH's ssh.exe with -F %VYRE_SSH_CONFIG% and the
//                                          arguments git gave, so git over SSH needs no shell (Git's own sh cannot start at Low while a Git Bash runs) and reads Vyre's config, not the profile's.
// --agent-relay: a Low process cannot open the ssh-agent service's pipe (Windows OpenSSH labels nothing for it, and a pipe defaults to "no write up"). This program, at the person's normal level,
// serves a pipe of its own for the life of the engine's job, labelled Low and open to this user alone, and passes each connection on to the agent's pipe. The keys stay with the agent.
// The command line after " -- " is passed to CreateProcessAsUser as it is: the caller quoted it for the engine. The token is this user's own, lowered; no admin, no other account.
// Built once on the person's computer by the .NET Framework compiler that ships with Windows (sandbox/src/win/lowrun.ts).
using System;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

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
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafePipeHandle CreateNamedPipe(string name, uint openMode, uint pipeMode, uint maxInstances, uint outBuffer, uint inBuffer, uint timeout, ref SECURITY_ATTRIBUTES sa);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern uint TreeResetNamedSecurityInfo(string name, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl, bool keepExplicit, IntPtr progress, int invoke, IntPtr args);

  // A folder's mandatory label (LABEL_SECURITY_INFORMATION): Windows passes an inheritable label on to what is under the folder. Setting a label at or below one's own level needs no admin.
  static int Label(string path, string sddl) {
    IntPtr sd, sacl; uint size; bool present, defaulted;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out sd, out size)) return Fail("the label " + sddl);
    if (!GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted) || !present) return Fail("the label's SACL");
    // LABEL_SECURITY_INFORMATION, protected (this label stands, whatever the parent passes on), and reset on everything already under the folder, so files that exist now (admin.token,
    // the keys, the databases) take the inherited label as new ones will. Setting the label alone does not reach files that are already there (the windows-latest proof).
    uint err = TreeResetNamedSecurityInfo(path, 1, 0x10 | 0x40000000, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl, false, IntPtr.Zero, 1, IntPtr.Zero);
    if (err != 0) { Console.Error.WriteLine("vyre-lowrun: could not label " + path + ": " + new Win32Exception((int)err).Message); return 1; }
    return 0;
  }

  const uint TOKEN_ALL = 0x0001 | 0x0002 | 0x0008 | 0x0080;
  const int TokenIntegrityLevel = 25;
  const uint SE_GROUP_INTEGRITY = 0x20;
  const uint KILL_ON_JOB_CLOSE = 0x2000, DIE_ON_UNHANDLED_EXCEPTION = 0x0400, ACTIVE_PROCESS = 0x0008;
  const uint CREATE_SUSPENDED = 0x4, CREATE_UNICODE_ENVIRONMENT = 0x400;

  // One argument as CreateProcess's command line parser reads it back (the rules every C runtime uses: backslashes double only before a quote).
  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
    var sb = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in a) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { sb.Append('\\', slashes * 2 + 1); sb.Append('"'); slashes = 0; continue; }
      sb.Append('\\', slashes); slashes = 0; sb.Append(c);
    }
    sb.Append('\\', slashes * 2); sb.Append('"');
    return sb.ToString();
  }

  // git's ssh: Windows OpenSSH with Vyre's config first, then git's own arguments; stdin and stdout are git's pipes, passed on as they are
  static int Ssh(string[] args, int from) {
    string config = Environment.GetEnvironmentVariable("VYRE_SSH_CONFIG");
    if (string.IsNullOrEmpty(config)) { Console.Error.WriteLine("vyre-ssh: VYRE_SSH_CONFIG is not set"); return 255; }
    string root = Environment.GetEnvironmentVariable("SystemRoot") ?? "C:\\Windows";
    string ssh = Path.Combine(root, "System32", "OpenSSH", "ssh.exe");
    var line = new StringBuilder(Quote(ssh) + " -F " + Quote(config));
    for (int i = from; i < args.Length; i++) line.Append(' ').Append(Quote(args[i]));
    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(si);
    si.dwFlags = 0x100;
    si.hStdInput = GetStdHandle(-10); si.hStdOutput = GetStdHandle(-11); si.hStdError = GetStdHandle(-12);
    foreach (IntPtr h in new[] { si.hStdInput, si.hStdOutput, si.hStdError }) if (h != IntPtr.Zero && h != new IntPtr(-1)) SetHandleInformation(h, 1, 1);
    PROCESS_INFORMATION pi;
    if (!CreateProcess(ssh, line, IntPtr.Zero, IntPtr.Zero, true, CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, null, ref si, out pi)) return Fail("could not start " + ssh);
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code;
    GetExitCodeProcess(pi.hProcess, out code);
    return (int)code;
  }

  // The agent relay: \\.\pipe\<name>, open to this user alone and labelled Low (a Low process may write to it), each connection passed on to \\.\pipe\<target>. Background threads: they end
  // with this program, which ends with the engine.
  static bool Relay(string name, string target) {
    string user = WindowsIdentity.GetCurrent().User.Value;
    IntPtr sd; uint size;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;;GA;;;" + user + ")(A;;GA;;;SY)S:(ML;;NW;;;LW)", 1, out sd, out size)) { Fail("the relay's security"); return false; }
    var first = new ManualResetEvent(false);
    bool ok = true;
    var t = new Thread(() => {
      for (int n = 0; ; n++) {
        var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), lpSecurityDescriptor = sd, bInheritHandle = 0 };
        // duplex, overlapped; the first instance must be ours (FILE_FLAG_FIRST_PIPE_INSTANCE), so no one else can have taken the name; remote clients refused
        uint mode = 0x3 | 0x40000000 | (n == 0 ? 0x00080000u : 0u);
        SafePipeHandle h = CreateNamedPipe("\\\\.\\pipe\\" + name, mode, 0x8, 255, 65536, 65536, 0, ref sa);
        if (h.IsInvalid) { if (n == 0) { Fail("the agent relay's pipe"); ok = false; first.Set(); } return; }
        if (n == 0) first.Set();
        var server = new NamedPipeServerStream(PipeDirection.InOut, true, false, h);
        try { server.WaitForConnection(); } catch { server.Dispose(); continue; }
        var s = server;
        new Thread(() => Pass(s, target)) { IsBackground = true }.Start();
      }
    }) { IsBackground = true };
    t.Start();
    first.WaitOne();
    return ok;
  }

  static void Pass(Stream a, string target) {
    using (a) {
      NamedPipeClientStream b = null;
      try {
        b = new NamedPipeClientStream(".", target, PipeDirection.InOut, PipeOptions.Asynchronous);
        b.Connect(10000);
        var up = new Thread(() => Copy(a, b)) { IsBackground = true };
        up.Start();
        Copy(b, a);
        up.Join(2000);
      } catch (Exception e) { Console.Error.WriteLine("vyre-lowrun: agent relay: " + e.Message); }
      finally { if (b != null) b.Dispose(); }
    }
  }

  static void Copy(Stream from, Stream to) {
    var buf = new byte[65536];
    try { for (int n; (n = from.Read(buf, 0, buf.Length)) > 0; ) { to.Write(buf, 0, n); to.Flush(); } } catch { }
    try { to.Close(); } catch { }
    try { from.Close(); } catch { }
  }

  static int Fail(string what) { Console.Error.WriteLine("vyre-lowrun: " + what + ": " + new Win32Exception(Marshal.GetLastWin32Error()).Message); return 126; }

  public static int Main(string[] args) {
    if (args.Length == 3 && args[0] == "--label") return Label(args[1], args[2]);
    if (Path.GetFileName(System.Reflection.Assembly.GetEntryAssembly().Location).StartsWith("vyre-ssh", StringComparison.OrdinalIgnoreCase)) return Ssh(args, 0);
    if (args.Length > 0 && args[0] == "--ssh") return Ssh(args, 1);
    // the engine's command line: everything after the first " -- ", untouched
    string raw = Marshal.PtrToStringUni(GetCommandLine());
    int at = raw.IndexOf(" -- ", StringComparison.Ordinal);
    if (at < 0) { Console.Error.WriteLine("vyre-lowrun: nothing to run"); return 2; }
    string child = raw.Substring(at + 4);
    for (int i = 0; i + 2 < args.Length && args[i] != "--"; i++) {
      if (args[i] != "--agent-relay") continue;
      if (!Relay(args[i + 1], args[i + 2])) return 126;
      Environment.SetEnvironmentVariable("SSH_AUTH_SOCK", "\\\\.\\pipe\\" + args[i + 1]);
    }
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
