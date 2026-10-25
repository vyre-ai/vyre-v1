// Is the network a wall? (S8) confinementProbe asks whether a sandbox can reach what it must not through the proxy; this asks whether there is anything besides the proxy to reach at all, from inside,
// with real commands: the interfaces the process sees, its routes, and a connection to every address a host service could be listening on (the gateway Docker would have given, the machine's
// own addresses, loopback), each with the proxy variables removed. A sandbox is walled only if no interface but loopback exists, no route exists, and none of those connections opens.
import type { Sandbox } from "../types.ts";

export interface WallProbeOptions {
  /** Where a host service listens that the sandbox must not reach: every (address, port) is tried. Include the machine's own addresses and, for Docker, the bridge gateway. */
  hostServices: ReadonlyArray<{ host: string; port: number }>;
  /** A name the proxy allows, to prove the one way out works. Plain HTTP; the answer must contain `expect`. */
  allowed?: { url: string; expect: string };
}

export interface WallCheck { name: string; ok: boolean; detail?: string }
export interface WallProbeResult { walled: boolean; checks: WallCheck[] }

const NO_PROXY_ENV = "env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy -u NO_PROXY -u no_proxy";

export async function networkWall(sbx: Sandbox, o: WallProbeOptions): Promise<WallProbeResult> {
  const checks: WallCheck[] = [];
  const run = (script: string, timeoutMs = 15_000) => sbx.exec({ argv: ["sh", "-c", script], timeoutMs });

  // /proc/net/dev lists the interfaces of the process's own network namespace (the sandbox may not have /sys).
  const nics = await run("tail -n +3 /proc/net/dev 2>/dev/null | cut -d: -f1 | tr -d ' ' | tr '\\n' ' '");
  const names = nics.stdout.trim().split(/\s+/).filter(Boolean);
  checks.push({ name: "no network interface but loopback", ok: nics.exitCode === 0 && names.length > 0 && names.every((n) => n === "lo"), detail: nics.stdout.trim() });

  const routes = await run("tail -n +2 /proc/net/route 2>/dev/null | wc -l");
  checks.push({ name: "no route out", ok: routes.exitCode === 0 && routes.stdout.trim() === "0", detail: `routes: ${routes.stdout.trim()}` });

  for (const t of o.hostServices) {
    // `-m 3` bounds the wait; --noproxy and the removed variables make sure the connection is attempted directly. Success means a service answered.
    const r = await run(`${NO_PROXY_ENV} curl --noproxy "*" -sS -m 3 -o /dev/null http://${t.host.includes(":") ? `[${t.host}]` : t.host}:${t.port}/; echo $?`, 15_000);
    const code = r.stdout.trim().split("\n").pop() ?? "";
    checks.push({ name: `cannot reach ${t.host}:${t.port}`, ok: code !== "0" && code !== "", detail: `curl exit ${code}` });
  }

  const dns = await run(`${NO_PROXY_ENV} getent hosts example.com >/dev/null 2>&1; echo $?`);
  checks.push({ name: "names do not resolve", ok: dns.stdout.trim().split("\n").pop() !== "0" });

  if (o.allowed) {
    const r = await run(`curl -sS -m 8 ${JSON.stringify(o.allowed.url)}`, 20_000);
    checks.push({ name: `reaches ${o.allowed.url} through the proxy`, ok: r.exitCode === 0 && r.stdout.includes(o.allowed.expect), detail: `exit ${String(r.exitCode)} ${r.stdout.slice(0, 80)}` });
  }
  return { walled: checks.every((c) => c.ok), checks };
}
