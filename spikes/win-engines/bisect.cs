// Runs INSIDE the container: which part of starting a child (the parts libuv and Rust use) is denied. One line per step: ok, or the Win32 error.
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Bisect {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr sa, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr r, out IntPtr w, ref SECURITY_ATTRIBUTES sa, int size);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateNamedPipe(string name, uint open, uint mode, uint max, uint outSize, uint inSize, uint timeout, ref SECURITY_ATTRIBUTES sa);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFile(string name, uint access, uint share, ref SECURITY_ATTRIBUTES sa, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern uint GetFinalPathNameByHandle(IntPtr h, StringBuilder buf, uint len, uint flags);
  const uint SUSPENDED = 0x4, NO_WINDOW = 0x08000000, UNICODE_ENV = 0x400, DETACHED = 0x8, NEW_GROUP = 0x200;
  static string Start(string cmd, uint flags, bool inherit, IntPtr stdout, bool job, bool resume) {
    var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si);
    if (stdout != IntPtr.Zero) { si.dwFlags = 0x100; si.hStdOutput = stdout; si.hStdError = stdout; si.hStdInput = IntPtr.Zero; }
    PROCESS_INFORMATION pi;
    if (!CreateProcess(null, new StringBuilder(cmd), IntPtr.Zero, IntPtr.Zero, inherit, flags, IntPtr.Zero, null, ref si, out pi)) return "CreateProcess error " + Marshal.GetLastWin32Error();
    string j = "";
    if (job) { var h = CreateJobObject(IntPtr.Zero, null); j = h == IntPtr.Zero ? " job:create " + Marshal.GetLastWin32Error() : AssignProcessToJobObject(h, pi.hProcess) ? " job:ok" : " job:assign " + Marshal.GetLastWin32Error(); }
    if (resume) ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, 10000);
    return "ok" + j;
  }
  public static void Main(string[] a) {
    string cmd = Environment.GetEnvironmentVariable("ComSpec") ?? @"C:\Windows\System32\cmd.exe";
    string c = "\"" + cmd + "\" /c echo hi";
    Console.WriteLine("plain: " + Start(c, NO_WINDOW, false, IntPtr.Zero, false, false));
    Console.WriteLine("no CREATE_NO_WINDOW: " + Start(c, 0, false, IntPtr.Zero, false, false));
    Console.WriteLine("unicode env: " + Start(c, NO_WINDOW | UNICODE_ENV, false, IntPtr.Zero, false, false));
    Console.WriteLine("suspended+resume: " + Start(c, NO_WINDOW | SUSPENDED, false, IntPtr.Zero, false, true));
    Console.WriteLine("suspended+job+resume: " + Start(c, NO_WINDOW | SUSPENDED, false, IntPtr.Zero, true, true));
    Console.WriteLine("detached+group: " + Start(c, DETACHED | NEW_GROUP, false, IntPtr.Zero, false, false));
    var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = true };
    IntPtr r, w;
    Console.WriteLine("anonymous pipe: " + (CreatePipe(out r, out w, ref sa, 0) ? "ok, child with it: " + Start(c, NO_WINDOW, true, w, false, false) : "error " + Marshal.GetLastWin32Error()));
    foreach (var n in new[] { @"\\?\pipe\uv\spike-" + System.Diagnostics.Process.GetCurrentProcess().Id, @"\\.\pipe\rust_anon_spike", @"\\.\pipe\LOCAL\spike" }) {
      var h = CreateNamedPipe(n, 0x40000003, 0, 1, 65536, 65536, 0, ref sa);
      Console.WriteLine("named pipe " + n + ": " + (h == new IntPtr(-1) ? "error " + Marshal.GetLastWin32Error() : "ok"));
    }
    foreach (var p in a) {
      var h = CreateFile(p, 0, 7, ref sa, 3, 0x02000000, IntPtr.Zero);
      if (h == new IntPtr(-1)) { Console.WriteLine("open " + p + ": error " + Marshal.GetLastWin32Error()); continue; }
      var b = new StringBuilder(1024);
      Console.WriteLine("final path (DOS) " + p + ": " + (GetFinalPathNameByHandle(h, b, 1024, 0) > 0 ? b.ToString() : "error " + Marshal.GetLastWin32Error()));
      Console.WriteLine("final path (GUID) " + p + ": " + (GetFinalPathNameByHandle(h, b, 1024, 1) > 0 ? b.ToString() : "error " + Marshal.GetLastWin32Error()));
      Console.WriteLine("final path (NT) " + p + ": " + (GetFinalPathNameByHandle(h, b, 1024, 2) > 0 ? b.ToString() : "error " + Marshal.GetLastWin32Error()));
    }
  }
}
