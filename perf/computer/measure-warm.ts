// What warming buys (lane r42-computer, 19 Nov 2026): the first chrome_open of an agent whose browser is asleep, with and without a warm start before it, on the real Space browser image driven through the
// adapter the server uses. Run on a Linux box with Docker:
//   VYRE_SPACE_BROWSER_IMAGE=vyre/space-browser:<tag> node perf/computer/measure-warm.ts
// Every number is milliseconds of wall time as the module sees it; the repeated steps report the median of `ROUNDS` (default 5).
import { execFileSync } from "node:child_process";
import http from "node:http";
import { createDockerApi, unixSocketHttp } from "../../sandbox/src/docker.ts";
import { createDockerSpaceBrowser } from "../../modules/computers/sbrowser/docker.ts";

const IMAGE = process.env["VYRE_SPACE_BROWSER_IMAGE"];
if (!IMAGE) throw new Error("name the image: VYRE_SPACE_BROWSER_IMAGE");
const ROUNDS = Number(process.env["ROUNDS"] ?? 5) || 5;
const NAME = `vyre-sbrowser-pw${process.pid}`;
const PROFILE = "agt_perf_warm";
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
async function timed<T>(f: () => Promise<T>): Promise<[number, T]> {
  const t0 = performance.now();
  const r = await f();
  return [Math.round(performance.now() - t0), r];
}
const sh = (args: string[]): string => {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
};
const page = http.createServer((_q, r) => {
  r.writeHead(200, { "content-type": "text/html" });
  r.end("<!doctype html><title>Orders</title><h1>Orders</h1><button>Open</button>");
});
await new Promise<void>((r) => page.listen(0, "0.0.0.0", r));
const URL_ = `http://host.docker.internal:${(page.address() as { port: number }).port}/`;
const http_ = unixSocketHttp();
const sb = createDockerSpaceBrowser({ api: createDockerApi(http_), http: http_, name: NAME, image: IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 90_000 });
const open = () => sb.tool({ profileId: PROFILE, tool: "chrome_open", args: { url: URL_ }, timeoutMs: 60_000 });
const out: Record<string, number | string> = { image: IMAGE, rounds: ROUNDS };
try {
  // the profile has browsed before (it holds Chrome data), the service is up, and the browser sleeps
  await open();
  const asleep: number[] = [];
  const warmed: number[] = [];
  const openAfter: number[] = [];
  const joined: number[] = [];
  const lead: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    // 1. nobody warmed it: the first open starts Chromium and loads the page
    await sb.stop(PROFILE);
    asleep.push((await timed(open))[0]);
    // 2. warmed first, and the open comes after the warm has finished (a turn that takes a moment to reach its first browser call)
    await sb.stop(PROFILE);
    warmed.push((await timed(() => sb.warm!({ profileId: PROFILE })))[0]);
    openAfter.push((await timed(open))[0]);
    // 3. the open comes while the warm is still under way: it joins the start instead of starting another
    await sb.stop(PROFILE);
    const w = sb.warm!({ profileId: PROFILE });
    joined.push((await timed(open))[0]);
    await w;
    // 4. warmed, then half a second of the model thinking, then the open
    await sb.stop(PROFILE);
    await sb.warm!({ profileId: PROFILE });
    await new Promise((r) => setTimeout(r, 500));
    lead.push((await timed(open))[0]);
  }
  out["first_open_asleep_ms"] = median(asleep);
  out["warm_itself_ms"] = median(warmed);
  out["first_open_after_warm_ms"] = median(openAfter);
  out["open_while_warm_runs_ms"] = median(joined);
  out["first_open_after_warm_and_half_a_second_ms"] = median(lead);
} finally {
  page.close();
  sh(["rm", "-f", "-v", NAME]);
  sh(["volume", "rm", "-f", `${NAME}-data`]);
  sh(["network", "rm", `${NAME}net`]);
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);
