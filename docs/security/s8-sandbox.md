# S8: person sandbox review (CLI engines on the host)

Scope: the sandbox a CLI engine (Claude Code, Codex, Grok) runs in before it may run on a Space host or a person's computer (spec 4.17, ARCH 13 R9). Reviewed: `sandbox/src/{seatbelt,bwrap,docker,policy,egress,creds,probe,select}.ts`, `agent/src/drivers/cli/launcher.ts`, `agent/src/drivers/open/fill-launcher.ts`.

## Finding 1 (must fix before release): the CLI launcher is unsandboxed

`createLocalLauncher` starts the engine as a plain child of the daemon unless the caller passes `wrap`. The opener (P-L2_23c) takes the launcher as a dependency, so the engine module must pass one that wraps. Without it a CLI engine can read every file the daemon user can read. The key and MCP token are in its environment either way (the environment is built from an allow-list, so the daemon's own variables do not leak).

### The wrap, for modules/engine (steward)

`createLocalLauncher({ wrap })` takes `argv -> argv`, but both sandboxes also return environment (proxy variables) and bwrap's `--clearenv` makes the env travel inside the argv. Seatbelt returns `env`, so it needs one extra step. Use a wrapper that merges it:

```ts
import { bwrapCommand, seatbeltCommand, chooseSandbox } from "../../sandbox/src/index.ts";   // allowed: B8, modules/engine -> sandbox
import { createLocalLauncher } from "../../agent/src/drivers/cli/index.ts";
import type { Launcher } from "../../agent/src/drivers/cli/index.ts";

export function sandboxedLauncher(o: { kind: "seatbelt" | "bwrap"; spec: SandboxSpec; roots: Roots; proxyPort?: number; programRead: string[]; baseEnv: Record<string, string> }): Launcher {
  const local = createLocalLauncher({
    baseEnv: o.baseEnv,
    wrap: (argv) => {
      if (o.kind === "bwrap") { const w = bwrapCommand(o.spec, o.roots, argv, { ...(o.proxyPort ? { proxyPort: o.proxyPort } : {}), programRead: o.programRead }); return [w.cmd, ...w.args]; }
      const w = seatbeltCommand(o.spec, o.roots, argv, { proxyPort: o.proxyPort ?? 0, programRead: o.programRead });
      return [w.cmd, ...w.args];
    },
  });
  return local;
}
```

Two details the steward must handle:
1. Seatbelt needs the proxy variables (`proxyEnv`) in the process env: merge `seatbeltCommand(...).env` into `baseEnv`. Bwrap sets everything with `--setenv` and clears the rest, so the per-spawn key and token variables added by the fill launcher (`spec.env`) are NOT visible inside bwrap. Pass them through bwrap by turning `spec.env` into `--setenv` pairs: extend the wrap so it receives the spawn's env (change `LocalLauncherOptions.wrap` to `(argv, env) => argv`, then copy `env` into `spec.env` of the `SandboxSpec` before calling `bwrapCommand`). Test the key and `VYRE_MCP_TOKEN` arrive inside the sandbox.
2. The work folder (`workFolder`) must be a mount in `spec.mounts` (rw) and the first mount, because bwrap does `--chdir` to the first mount.

Where `chooseSandbox` returns `docker` (host placement) the launcher is not a local wrap: it attaches `docker exec` into the person's container (`startWalledDockerSandbox`). That Launcher implementation is a separate piece; until it exists a host-placed CLI turn must fail with `sandbox.unavailable`, never fall back to the unwrapped launcher.

### Test the steward needs (modules/engine/tests or host live test)

A real CLI-shaped process started through `sandboxedLauncher` must (a) read a file inside its work folder, (b) fail to read a file in the daemon user's home and in `/etc/passwd`'s neighbours that are not mounted, (c) fail to write outside the work folder, (d) see `CLAUDE_CODE_OAUTH_TOKEN` and `VYRE_MCP_TOKEN` in its environment, and (e) not see the daemon's other environment variables. Run on the Linux runner with bwrap (the `l2-heavy` job); `agent/tests/sandbox.heavy.test.ts` "bwrap: the agent process cannot read outside its folders" already shows the sandbox side, the new test proves the launcher uses it.

## Finding 2: bwrap network is a variable, not a wall

With a proxy port, bwrap shares the machine's network and steers by proxy variables (`enforcement.network: "proxy-env"`). Known and asserted in `sandbox.heavy.test.ts` ("bwrap with a proxy port: ... the wall is only the proxy variables"). The walled starters (`startWalledBwrapSandbox`, `startWalledDockerSandbox`) close it with a bridged socket. The launcher must be built on the walled starters, not on `bwrapCommand` with a bare proxy port, wherever the person's machine is a shared or server host. On a person's own laptop the Seatbelt rule is kernel-enforced and bwrap with no proxy port has no network.

## Finding 3: Docker gateway (known gap)

A host service listening on all addresses is reachable through the bridge gateway ("docker, KNOWN GAP" in the heavy test). The walled Docker starter removes the network entirely; use it.

## Escape and exfiltration probes (10)

| # | Probe | Expected | Covered by (agent/tests/sandbox.heavy.test.ts, sandbox.net.heavy.test.ts) |
|---|---|---|---|
| 1 | read a file outside the mounted folders | blocked | "docker/bwrap: the agent process cannot read outside its folders" |
| 2 | write to the root filesystem | blocked | `confinementProbe` "write to the root filesystem" |
| 3 | write in a read-only mount | blocked | "the work folder is writable, the reference folder is not" |
| 4 | see the host's processes | blocked | "docker: the process sees its own processes only" |
| 5 | reach the Docker socket | blocked | `confinementProbe` "reach the Docker socket" |
| 6 | read a Vault value or host environment | blocked | "the process sees no Vault value and no host environment" |
| 7 | connect without the proxy | blocked (docker wall, bwrap no-port, Seatbelt); proxy-env only for bwrap with port | "without the proxy there is no route" |
| 8 | reach a host not on the allow-list, a private address, an address literal | blocked at the proxy | "the only way out is the egress proxy" |
| 9 | reach a host service on loopback or the gateway | blocked in the walled starters | "docker wall: a host service on every address is unreachable", "bwrap wall: no host service is reachable" |
| 10 | fork past the process limit | blocked | "the process cannot start more processes than its limit" |

Credential files: memory-backed, mode 0600, shredded on stop ("credentials live in memory ... a wipe removes them", "stopping removes the container, its network, its proxy and its credentials").

## Sign-off status

Probes run (l2-heavy job of the check run on PR 465, head b29bbff2, https://github.com/vyre-ai/vyre-v1/actions/runs/40241908175/job/121315473579): `sandbox.heavy.test.ts` 27 pass, `sandbox.net.heavy.test.ts` 12 pass, 0 fail, 0 skipped. All ten probes above are blocked, with the two known gaps asserted as gaps (Finding 2 and 3). The sandboxed launcher test from Finding 1 ("the sandboxed launcher: reads the work folder, cannot read the home or a neighbour, cannot write outside, sees the key and the token and nothing else of the daemon") is ok in the same job. The unwrapped `createLocalLauncher` stays for tests only; a CLI engine on a host runs through the sandboxed launcher.
