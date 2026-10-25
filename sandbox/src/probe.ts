// The confinement self-test (S8): before a CLI engine runs in a sandbox, the sandbox is asked to do what it must not be able to, and to do what it must. Anything that comes out wrong refuses the
// start and says which check. It runs real commands in the sandbox, so it proves the sandbox that exists, not the config that was meant.
import type { Sandbox } from "./types.ts";

export interface ProbeOptions {
  /** Paths on the machine that exist and are not mounted: reading one must fail. */
  outsidePaths: readonly string[];
  /** The mounts as the process sees them, with their mode. */
  mounts: ReadonlyArray<{ guest: string; mode: "ro" | "rw" }>;
  /** A host that is not on the allow-list: reaching it through the proxy must fail. */
  deniedHost: string;
  /** A host that is on the list, if the check should also prove the proxy lets it through. */
  allowedHost?: string;
}

export interface ProbeResult { ok: boolean; failures: string[] }

const NO_PROXY_ENV = "unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy";

export async function confinementProbe(sbx: Sandbox, o: ProbeOptions): Promise<ProbeResult> {
  const failures: string[] = [];
  const run = (script: string, timeoutMs = 15_000) => sbx.exec({ argv: ["sh", "-c", script], timeoutMs });
  const mustFail = async (name: string, script: string): Promise<void> => { const r = await run(script); if (r.exitCode === 0) failures.push(`${name}: it worked, and must not`); };
  const mustWork = async (name: string, script: string): Promise<void> => { const r = await run(script); if (r.exitCode !== 0) failures.push(`${name}: it failed, and must work`); };

  const who = await run("id -u");
  if (who.exitCode !== 0 || who.stdout.trim() === "0" || !/^\d+$/.test(who.stdout.trim())) failures.push("the process would run as root, or its user could not be read");
  await mustFail("write to the root filesystem", "touch /vyre-probe");
  await mustFail("reach the Docker socket", "test -e /var/run/docker.sock -o -e /run/docker.sock");
  // Not "can pid 1 be read": in a container pid 1 is the sandbox's own init. What must be absent is the machine's own processes: its daemons and its CI runner (the brackets keep the check from matching its own command line).
  await mustFail("see the host's processes", "cat /proc/[0-9]*/cmdline 2>/dev/null | tr '\\0' '\\n' | grep -qE '([d]ockerd|[c]ontainerd|[s]ystemd|[s]shd|Runner\\.[L]istener|[r]unsvc)'");
  for (const p of o.outsidePaths) await mustFail(`read ${p}`, `cat ${JSON.stringify(p)} >/dev/null 2>&1`);
  for (const m of o.mounts) {
    if (m.mode === "rw") await mustWork(`write in ${m.guest}`, `touch ${JSON.stringify(`${m.guest}/.vyre-probe`)} && rm ${JSON.stringify(`${m.guest}/.vyre-probe`)}`);
    else await mustFail(`write in read-only ${m.guest}`, `touch ${JSON.stringify(`${m.guest}/.vyre-probe`)}`);
  }
  // No route around the proxy: with the proxy variables removed there is nowhere to connect.
  await mustFail("connect without the proxy", `${NO_PROXY_ENV}; curl -sS -m 4 -o /dev/null http://example.com`);
  await mustFail(`reach ${o.deniedHost} through the proxy`, `curl -sS -m 6 -f -o /dev/null https://${o.deniedHost}/`);
  if (o.allowedHost !== undefined) await mustWork(`reach ${o.allowedHost} through the proxy`, `curl -sS -m 8 -o /dev/null https://${o.allowedHost}/`);
  return { ok: failures.length === 0, failures };
}
