# CLI engines on Windows: the sandbox

Status: research done, native sandbox not built. Lane l-winengine, 3 Nov 2026.

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

The spike (`spikes/win-appcontainer`) ran on windows-latest in the `sandbox-windows` job. A Node process sat in a capability-less AppContainer:

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
| loopback between two processes of the same container | see below |
| Node `child_process.spawn` inside the container | EPERM (cmd.exe starting node works) |

The file confinement is what we want, and it is enforced by the kernel. One catch: Node must run with `--preserve-symlinks-main`, because the container cannot `lstat` the drive root.

The network is the problem. CLI engines reach the internet through `HTTPS_PROXY`, which must be a TCP address. The container cannot reach the host's loopback. Microsoft documents the exemption, `CheckNetIsolation LoopbackExempt` or `NetworkIsolationSetAppContainerConfig`, as an elevated operation. Granting `internetClient` instead lets the engine reach any host directly, and `HTTPS_PROXY` then only asks the engine to behave. That is weaker than the Mac and Linux wall, and the brief rules it out.

The only no-admin path left puts a small bridge inside the same container. The bridge listens on 127.0.0.1 for the engine, and talks to the host proxy over a named pipe whose DACL names the container SID. That path works only if two processes of one AppContainer may talk over loopback. Microsoft documents loopback as allowed "within the same process" only.

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
- The MCP shim: Node with `--preserve-symlinks-main`, reaching the bridge pipe. The pipe's DACL must name the container SID; libuv cannot set that, so the pipe must come from native code.
- Vyre installs all three by itself. `engine-pins.ts` now has win32-x64 and win32-arm64 builds, checked against the vendors' sums.

## Recommendation

See the lane report. In short: AppContainer is the right base for files. The network needs either an in-container bridge (if two-process loopback is allowed) or one elevated step. Until one of those is proven on a real machine, Windows keeps refusing CLI turns honestly, and API keys work.
