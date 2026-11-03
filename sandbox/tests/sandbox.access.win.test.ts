// What a CLI engine may touch on a Windows computer (lane l-winfix), built by the same engineAccess with path.win32 rules, so it is checked on any machine: added folders by drive letter, share
// or long form, with spaces; Windows' system folders and Vyre's data folder refused in any letter case and with either slash; the Windows key stores and browser profiles closed; the OpenSSH
// agent's named pipe passed; ssh's known_hosts found with backslashes; git's ssh command quoted so a path with a space stays one path, with NUL for no config on Windows.
import test from "node:test";
import assert from "node:assert/strict";
import { WIN_SSH_AGENT_PIPE, addedFolder, agentSocket, engineAccess, sshFiles, toolProxyEnv, insideFolder, winFolder } from "../src/index.ts";
import { gitSshCommand } from "../src/egress-policy.ts";

const HOME = "C:\\Users\\Dana Reyes";
const DATA = "C:\\Users\\Dana Reyes\\AppData\\Roaming\\ai.vyre.desktop\\personal";
const WORK = `${DATA}\\work\\usr_dana\\thr_1`;
const W = { platform: "win32" as const };

test("Windows: a folder the person added is kept by drive letter, share or long form, spaces and forward slashes included", () => {
  assert.equal(addedFolder("C:\\Users\\Dana Reyes\\Client Files", DATA, W), "C:\\Users\\Dana Reyes\\Client Files");
  assert.equal(addedFolder("C:/Users/Dana Reyes/Client Files/", DATA, W), "C:\\Users\\Dana Reyes\\Client Files");
  assert.equal(addedFolder("D:\\Matters\\2026\\", DATA, W), "D:\\Matters\\2026");
  assert.equal(addedFolder("\\\\nas\\legal\\Matters", DATA, W), "\\\\nas\\legal\\Matters");
  assert.equal(addedFolder("\\\\nas\\legal", DATA, W), "\\\\nas\\legal", "a whole share is one place, like a mounted drive");
  assert.equal(addedFolder("\\\\?\\C:\\Users\\dana\\Deep Folder", DATA, W), "C:\\Users\\dana\\Deep Folder");
  assert.equal(addedFolder("\\\\?\\UNC\\nas\\legal\\Deep", DATA, W), "\\\\nas\\legal\\Deep");
  assert.equal(addedFolder("C:\\Users\\Dana Reyes\\x\\..\\Code", DATA, W), "C:\\Users\\Dana Reyes\\Code");
});

test("Windows: the root of a drive, the system folders, Vyre's data folder (any case, either slash), devices and odd names are never held", () => {
  for (const p of ["C:\\", "c:/", "D:\\", "C:\\Windows", "c:\\windows\\System32", "C:\\Program Files\\Git", "C:\\PROGRAM FILES (X86)\\x", "C:\\ProgramData\\ssh", "C:\\$Recycle.Bin",
    DATA, `${DATA}\\work`, DATA.toUpperCase(), DATA.replace(/\\/g, "/"), `${DATA.toLowerCase()}/../personal/vault`,
    "\\\\.\\pipe\\openssh-ssh-agent", "\\\\?\\GLOBALROOT\\Device\\x", "relative\\x", "\\rooted\\no-drive", "C:relative", "C:\\a\\b:stream", "C:\\a\\b?c", "C:\\a\\b*", "C:\\a\\\"b\"", "C:\\a\\b\u0001"]) {
    assert.equal(addedFolder(p, DATA, W), null, p);
  }
  assert.equal(addedFolder("E:\\Windows\\stuff", DATA, { platform: "win32", systemRoot: "E:\\Windows" }), null, "the system folders are on the drive %SystemRoot% names");
  assert.equal(addedFolder("C:\\Windows.old.notes\\x", DATA, W), "C:\\Windows.old.notes\\x", "a folder whose name starts like a system one is not inside it");
  assert.equal(insideFolder("C:\\USERS\\dana", "c:/users/DANA/", "win32"), true);
});

test("Windows: the builder keeps the added folders, closes the key stores and browser profiles, opens the package folders, and passes the OpenSSH agent's pipe", () => {
  const exists = new Set([`${HOME}\\.gitconfig`, `${HOME}\\.ssh\\known_hosts`, `${HOME}\\.ssh\\config`, `${HOME}\\AppData\\Roaming\\npm`, `${HOME}\\.cargo\\bin`]);
  const a = engineAccess({ where: "own", home: HOME, dataDir: DATA, platform: "win32", folders: ["C:\\Users\\Dana Reyes\\Client Files", "C:\\Windows", `${DATA}\\vault`, "C:\\"], own: [WORK], sshAuthSock: WIN_SSH_AGENT_PIPE, exists: (p) => exists.has(p) });
  assert.equal(a.rw[0], "C:\\Users\\Dana Reyes\\Client Files");
  assert.ok(!a.rw.includes("C:\\Windows") && !a.rw.includes("C:\\"));
  for (const p of [`${HOME}\\AppData\\Roaming\\npm`, `${HOME}\\AppData\\Local\\npm-cache`, `${HOME}\\.cargo`, `${HOME}\\AppData\\Roaming\\Python`]) assert.ok(a.rw.includes(p), p);
  for (const p of [DATA, `${HOME}\\.ssh`, `${HOME}\\AppData\\Roaming\\Microsoft\\Credentials`, `${HOME}\\AppData\\Roaming\\Microsoft\\Protect`, `${HOME}\\AppData\\Local\\Microsoft\\Credentials`,
    `${HOME}\\AppData\\Roaming\\Microsoft\\Crypto`, `${HOME}\\AppData\\Local\\Google\\Chrome\\User Data`, `${HOME}\\AppData\\Local\\Microsoft\\Edge\\User Data`,
    `${HOME}\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data`, `${HOME}\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles`, `${HOME}\\AppData\\Local\\1Password`, `${HOME}\\AppData\\Roaming\\1Password`]) {
    assert.ok(a.deny.includes(p), p);
  }
  assert.ok(a.deny.every((p) => !p.includes("/")), "every closed path is a Windows path");
  assert.deepEqual(a.roFiles, [`${HOME}\\.gitconfig`, `${HOME}\\.ssh\\known_hosts`, `${HOME}\\.ssh\\config`]);
  assert.equal(a.sshAuthSock, "\\\\.\\pipe\\openssh-ssh-agent");
  assert.deepEqual(a.pathAdd, [`${HOME}\\AppData\\Roaming\\npm`, `${HOME}\\.cargo\\bin`]);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.deepEqual(sshFiles(a, `${DATA}\\scratch\\usr_dana\\home\\.vyre-known-hosts`), { knownHosts: [`${DATA}\\scratch\\usr_dana\\home\\.vyre-known-hosts`, `${HOME}\\.ssh\\known_hosts`], config: `${HOME}\\.ssh\\config` });
});

test("the SSH agent: Windows' named pipe in either slash, a socket elsewhere; anything else is not passed", () => {
  assert.equal(agentSocket("\\\\.\\pipe\\openssh-ssh-agent", "win32"), WIN_SSH_AGENT_PIPE);
  assert.equal(agentSocket("//./pipe/openssh-ssh-agent", "win32"), WIN_SSH_AGENT_PIPE);
  assert.equal(agentSocket("\\\\.\\pipe\\bad\"name", "win32"), undefined);
  assert.equal(agentSocket("/tmp/ssh-x/agent.1", "linux"), "/tmp/ssh-x/agent.1");
  assert.equal(agentSocket("\\\\.\\pipe\\openssh-ssh-agent", "linux"), undefined);
  assert.equal(agentSocket("relative.sock", "darwin"), undefined);
  assert.equal(winFolder("\\\\.\\pipe\\openssh-ssh-agent"), null, "a pipe is never a folder");
});

test("git's ssh command keeps a path with a space whole, on a Mac and on Windows; Windows uses its own OpenSSH and NUL for no config", () => {
  const mac = gitSshCommand({ node: "/Applications/Vyre.app/Contents/MacOS/node", helper: "/Users/dana/Library/Application Support/ai.vyre.desktop/personal/scratch/usr_dana/net/connect.mjs", port: 4242, platform: "darwin",
    knownHosts: ["/Users/dana/Library/Application Support/ai.vyre.desktop/personal/scratch/usr_dana/home/.vyre-known-hosts", "/Users/dana/.ssh/known_hosts"] });
  assert.match(mac, /^ssh -F '\/dev\/null' /);
  assert.ok(mac.includes(`'UserKnownHostsFile="/Users/dana/Library/Application Support/ai.vyre.desktop/personal/scratch/usr_dana/home/.vyre-known-hosts" "/Users/dana/.ssh/known_hosts"'`), mac);
  assert.ok(mac.includes(`'ProxyCommand="/Applications/Vyre.app/Contents/MacOS/node" "/Users/dana/Library/Application Support/ai.vyre.desktop/personal/scratch/usr_dana/net/connect.mjs" 4242 %h %p'`), mac);

  const win = gitSshCommand({ node: "C:\\Program Files\\Vyre\\node.exe", helper: `${DATA}\\scratch\\usr_dana\\net\\connect.mjs`, port: 4242, platform: "win32", knownHosts: [`${DATA}\\scratch\\usr_dana\\home\\.vyre-known-hosts`, `${HOME}\\.ssh\\known_hosts`] });
  assert.match(win, /^'C:\/Windows\/System32\/OpenSSH\/ssh\.exe' -F 'NUL' /, win);
  assert.ok(!win.includes("/dev/null") && !win.includes("\\"), "no POSIX null device and no backslash for bash or ssh to read as an escape");
  assert.ok(win.includes(`'UserKnownHostsFile="C:/Users/Dana Reyes/AppData/Roaming/ai.vyre.desktop/personal/scratch/usr_dana/home/.vyre-known-hosts" "C:/Users/Dana Reyes/.ssh/known_hosts"'`), win);
  assert.ok(win.includes(`'ProxyCommand="C:/Program Files/Vyre/node.exe" "C:/Users/Dana Reyes/AppData/Roaming/ai.vyre.desktop/personal/scratch/usr_dana/net/connect.mjs" 4242 %h %p'`), win);
  assert.match(gitSshCommand({ node: "n", helper: "h", port: 1, platform: "win32", knownHosts: "k", config: `${HOME}\\.ssh\\config` }), / -F 'C:\/Users\/Dana Reyes\/.ssh\/config' /);
  assert.equal(toolProxyEnv("http://127.0.0.1:1", { node: "n", helper: "h", port: 1, platform: "win32", knownHosts: "k" })["GIT_SSH_COMMAND"], gitSshCommand({ node: "n", helper: "h", port: 1, platform: "win32", knownHosts: "k" }));
});
