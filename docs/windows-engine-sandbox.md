# CLI engines on Windows: the sandbox

Status: built. Personal Space engines run under option E (owner ruling 3 Nov 2026, RULINGS 14), on branch wip/l-winlow. Team Space turns on a Windows member's computer and "Contained" computers use option B (RULINGS 15), on wip/l-winwsl. Lane l-winengine, 3 Nov 2026. Evidence: desktop.yml `sandbox-windows` job, run 41535810154 on windows-latest.

## The rule we keep

On a Mac and on Linux, Claude Code, Codex and Grok never run unwrapped:

- Files: the engine sees its work folder, its scratch home, its own install folder and the system. The person's home stays closed.
- Network: the kernel lets the engine reach one thing, the egress proxy. The proxy lets through only the vendor's hosts (`ENGINE_EGRESS_HOSTS`).

Windows has to give the same two guarantees with no admin rights, no reboot and no manual setup. Without them, a CLI turn refuses (`sandbox.unavailable`), and that never becomes "run it unwrapped".

## What the live report was

rc.14, Windows desktop, Personal Space, Claude Code. The turn died at once at the MCP bridge with "the MCP socket path is too long for a unix socket: 116 characters". That was before the sandbox check. Fixed in this lane:

- `sandbox/src/sock.ts` gives every daemon socket its path. Windows gets a named pipe; a Mac or Linux socket that would be too long gets a short private link.
- With that fixed, the same turn would have failed with `sandbox.unavailable`. It now fails before anything opens, and the chat says so in plain words.

## Options

### 1. AppContainer (LowBox token) + Job Object: files work, the network does not

An ordinary user process can make an AppContainer profile (`CreateAppContainerProfile`). It can start a process in it with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`, and it can add the container's SID to the ACLs of folders it owns. None of that needs admin.

The spike (`spikes/win-appcontainer` on branch wip/l-winengine-sbx) ran on windows-latest in the `sandbox-windows` job. A Node process sat in a capability-less AppContainer:

| Probe | Result |
|---|---|
| read a file in the user profile | EPERM |
| list the user profile | EPERM |
| write in the folder granted to the container | ok |
| write in a folder not granted | EPERM |
| read `C:\Windows\win.ini` | ok (system files are readable by all app packages) |
| fetch `https://api.anthropic.com` | ENOTFOUND (no network at all) |
| connect to a TCP server on the host's 127.0.0.1 | ETIMEDOUT (loopback is blocked) |
| connect to a Node named pipe (default DACL) | EPERM |
| connect to a named pipe whose DACL names the container SID | ok |
| loopback inside one process | ok |
| loopback between two processes of the same container (both started from outside) | ok |
| the host connecting into the container's loopback port | refused (timeout) |
| Node `child_process.spawn` inside the container | EPERM; `spawnSync` hangs (cmd.exe starting node with file redirects works) |

The file confinement is what we want, and it is enforced by the kernel. One catch: Node must run with `--preserve-symlinks-main`, because the container cannot `lstat` the drive root.

The network is the problem. CLI engines reach the internet through `HTTPS_PROXY`, which must be a TCP address. The container cannot reach the host's loopback. Microsoft documents the exemption, `CheckNetIsolation LoopbackExempt` or `NetworkIsolationSetAppContainerConfig`, as an elevated operation. Granting `internetClient` instead lets the engine reach any host directly, and `HTTPS_PROXY` then only asks the engine to behave. That is weaker than the Mac and Linux wall, and the brief rules it out.

The no-admin path puts a small bridge inside the same container. The bridge listens on 127.0.0.1 for the engine, and talks to the host proxy over a named pipe whose DACL names the container SID. The spike shows both halves work: two processes of one container talk over loopback, and a pipe with that DACL is reachable. The engine then has exactly one way out, the bridge, and the host checks every host name. It cannot reach the daemon's own loopback ports at all, which is stricter than the Mac.

What is not proven: a CLI engine runs its tools by starting child processes. Inside the container, Node's `child_process` (libuv) fails with EPERM, and `spawnSync` hangs. Claude Code is a Bun program, and Bun uses libuv on Windows; Codex is Rust. Until claude.exe's Bash and PowerShell tools and codex.exe's commands work inside the container, the sandbox would confine an engine that cannot do its work. A likely cause: an AppContainer may create named pipes only under `\\.\pipe\LOCAL\`, and libuv and Rust name their stdio pipes globally. This is not confirmed.

### 2. Restricted token + Job Object, no AppContainer

Restricted SIDs and a low integrity level limit writes, not reads, and do nothing for the network. The kernel cannot filter egress for a non-admin process: WFP filters and firewall rules both need admin. This does not meet the rule.

### 3. WSL2 with bubblewrap, when it is already there

`wsl.exe --status` and `wsl -e which bwrap` tell us. When WSL2 has a distro with bwrap, the Linux path runs as it is: the Linux builds of the engines (already pinned), the net wall and `bwrapWallCommand`. The Windows folders are reached under `/mnt/c`.

Cost: path mapping, sign-in files that must be in the WSL home, and a WSL VM start on the first turn (a few seconds). Most Windows users do not have WSL2, and turning it on needs admin and a reboot. So this is a fallback, not the answer.

### 4. Run the turn on a Space server

When the person belongs to a Space with a server, CLI turns can run there in their container (placement `host`, Docker). That is already how a turn pinned to a server runs. A Personal Space on Windows has no server, so this does not help the reported case.

### 5. The CLIs' own Windows sandboxes

Claude Code documents native Windows as having no sandbox. Codex ships `codex-windows-sandbox-setup.exe`, a restricted-token sandbox whose strong mode is set up elevated. Neither confines the network to the vendor hosts.

## What Claude Code and Codex need on Windows

- Claude Code: `claude.exe` (native, Bun). Config is in `%USERPROFILE%\.claude` and `%USERPROFILE%\.claude.json`; Vyre points `CLAUDE_CONFIG_DIR` at the scratch home. The Bash tool needs Git for Windows (`C:\Program Files\Git\bin\bash.exe`, readable by all app packages when installed for all users; set `CLAUDE_CODE_GIT_BASH_PATH`). Without Git it falls back to the PowerShell tool.
- Codex: `codex.exe` (Rust), `CODEX_HOME` for its config. Its own sandbox mode stays on inside ours, as on the Mac.
- Grok: `grok.exe`.
- The MCP shim: Node with `--preserve-symlinks-main`, reaching the bridge pipe. The pipe's DACL must name the container SID. libuv cannot set that (a Node pipe server answers the container with EPERM), so the pipe must come from native code.
- Vyre installs all three by itself. `engine-pins.ts` now has win32-x64 and win32-arm64 builds, checked against the vendors' sums.

## Recommendation

Build option 1 with the in-container bridge. It needs no admin, no reboot and no setup, and its file and network confinement are kernel-enforced. The spike shows the confinement holds. Before building it:

1. Prove that child processes work. Run the real claude.exe and codex.exe in the container on windows-latest with a fake API endpoint behind the bridge, and run one Bash or PowerShell tool call. If libuv's stdio pipes are the cause, test a `LOCAL\` pipe name or anonymous pipes. If they cannot be made to work, option 1 is dead for CLI engines.
2. Write a small native launcher, a Rust binary shipped beside vyred: create the profile, grant the container SID on the work folder, the scratch home and the engine folder, and create the proxy and MCP pipes with a DACL for that SID. Then start the bridge and the engine in the container under one Job Object with kill-on-close. Node cannot do any of these steps.
3. Add a `win32` branch to `defaultSandbox` and drop the gap in `cliSandboxGap` for win32. Do that only when the launcher is present and its self-test passes on this machine. The CI test runs a fake engine in the container and proves three things: it cannot read outside its folder, it cannot reach a host not on the list, and it reaches an allowed one through the proxy.

The fallback is WSL2 with bwrap, when it is already installed. Last resort: the turn runs on a Space server. Until then, Windows refuses CLI turns with plain words, CLI accounts show what they need, and API keys work.

## As built: option E for a Personal Space (wip/l-winlow)

- `sandbox/src/win/lowrun.cs` is compiled once with the .NET Framework `csc.exe` every Windows 10 and 11 has. It starts the engine at Low integrity, with the user's own token lowered, in a Job Object: kill on close, at most 512 processes. No admin is needed.
- The engine may change these folders, which are labelled Low:
  - this person's work folders;
  - their scratch folder (the engine's home, config and temp, with `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `TEMP` pointed there);
  - the folders they added, from l-openweb's folder builder once it lands (until then, the workspace only).
- The engine reads the computer as Claude Code does.
- Network: the egress proxy, by its variables, under the shared policy. A program that bypasses it is accepted on the person's own computer (the ruling).
- MCP: the loopback URL, with the session token the opener mints. The token is the session's own (mcp.session.mint with the agent as principal, acting for the asker, for one thread). It expires by itself and is revoked when the warm session closes. It grants nothing beyond that session's MCP calls.
- Git Bash: MSYS2 keeps its state in a kernel object folder named after its installation. A Low engine cannot open the one a normal-integrity Git Bash made, which the windows-latest proof hit. The engine therefore gets its own copy of Git's `usr\bin` and `etc` (`sandbox/src/win/msys.ts`). The copy is readable and not writable, and `CLAUDE_CODE_GIT_BASH_PATH` points at it. Git itself stays the person's.

- One person's own agents are not isolated from each other under E. Integrity levels cannot separate two Low processes of the same user, so agent A can read agent B's folder. This was decided on 3 Nov 2026: it is the same person's data, and Personal is zero friction. Anything that needs isolation from other people (a Team Space turn on a member's computer) uses option B.

### Vyre's own data at rest (audit, 3 Nov 2026)

What a Low process could read before E's labels:

| Item | Where | At rest |
|---|---|---|
| `admin.token` (the owner's loopback bearer) | data folder | plaintext |
| `seal.key`, `vault-filler.key`, `relay.key` | data folder | plaintext |
| `events.db`, `modules.db`, `logs.db`, `space.db` | data folder | plaintext SQLite (no cipher) |
| `logs\claim-link.txt` (until the Space is claimed) | data folder | plaintext |
| Shared Vault items, files, memory facts, Google, Microsoft and MCP OAuth tokens | `modules.db`, `blobs\` | AES-GCM, under the key files above |
| Mine Vault items (subscription sign-ins, Mine API keys) | `modules.db` | AES-GCM under the person key, which is wrapped by Argon2id of the password and held only in memory |

E labels Vyre's folders (`%APPDATA%\ai.vyre.desktop`, `%LOCALAPPDATA%\ai.vyre.desktop`) Medium with no read up and no write up, inherited. The engines folder and the engine's Git Bash are readable and not writable. The engine's own folders are explicitly Low. A Low engine can no longer read the token, the keys, the databases or the logs; the windows-latest proof checks `admin.token` and the logs folder.

Out of scope: the databases stay plaintext to any normal-integrity process of the same user, as they are on a Mac.

### The person's key stores (3 Nov 2026)

The deny list a Mac engine gets (`homeDenies` in `sandbox/src/engine-access.ts`) is applied on Windows as labels too. When E starts, Vyre labels every key store that is on the computer the same way as its own folders: no read up and no write up for every file, inherited by new files. The list covers Credential Manager (`Credentials`, `Vault`), DPAPI's master keys (`Protect`), `Crypto`, `SystemCertificates`, the Chrome, Edge, Brave and Chromium `User Data` folders, Opera, the Firefox and Thunderbird profiles, 1Password, Bitwarden, KeePass, `~/.ssh`, `~/.aws`, `~/.azure`, `~/.kube`, `~/.docker`, gcloud and the GitHub CLI. Single files (`.netrc`, `.git-credentials`) get the same label on the file.

`~/.ssh` is private, but its `known_hosts`, `known_hosts2`, `config` and public keys stay readable, because git's ssh reads them. Private keys go through the agent relay. The labels are set again when the list changes, for example after a browser is installed. They are also set again after icacls labels an added folder Low, since icacls would otherwise reset a key store inside it (when the person adds their whole home). If Windows refuses a label, the engine does not start.

The windows-latest proof checks that a Low engine cannot read Chrome's `User Data\Default\Cookies`, a file in `%APPDATA%\Microsoft\Credentials` or a private key in `~/.ssh`. It also checks that the engine can read the rest of the profile and `~/.ssh\known_hosts`, and that Chrome still keeps a cookie in a labelled `User Data` folder. That last check matters because Chrome's network service, which writes the cookie store, may itself run sandboxed at Low.
