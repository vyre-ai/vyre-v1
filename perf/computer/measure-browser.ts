// How long an agent waits for its browser (lane r42-computer, 19 Nov 2026; owner: "Its really slow for now, the browser starting and all"). The real Space browser image in a container of its own name,
// driven through the same adapter the server uses (modules/computers/sbrowser/docker.ts). Run on a Linux box with Docker:
//   VYRE_SPACE_BROWSER_IMAGE=vyre/space-browser:<tag> node perf/computer/measure-browser.ts
// It prints one JSON object of milliseconds. Each number is the wall time of the call as the module sees it. `rounds` (default 5) is how many times the repeated steps run; their median is reported.
import { execFileSync } from "node:child_process";
import http from "node:http";
import { createDockerApi, unixSocketHttp } from "../../sandbox/src/docker.ts";
import { createDockerSpaceBrowser } from "../../modules/computers/sbrowser/docker.ts";

const IMAGE = process.env["VYRE_SPACE_BROWSER_IMAGE"];
if (!IMAGE) throw new Error("name the image: VYRE_SPACE_BROWSER_IMAGE");
const ROUNDS = Number(process.env["ROUNDS"] ?? 5) || 5;
const NAME = `vyre-sbrowser-pf${process.pid}`;
const PROFILE = "agt_perf_one";
const OTHER = "agt_perf_two";

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

// a page with forty links, a form and a heading: what a snapshot reads
const PAGE = `<!doctype html><title>Northwind orders</title><h1>Orders</h1><form><input name="q" placeholder="Search orders"><button>Search</button></form>${Array.from(
  { length: 40 },
  (_, i) => `<p><a href="/order/${i}">Order ${1000 + i}</a> <button>Open</button></p>`,
).join("")}`;

const page = http.createServer((_q, r) => {
  r.writeHead(200, { "content-type": "text/html" });
  r.end(PAGE);
});
await new Promise<void>((r) => page.listen(0, "0.0.0.0", r));
const port = (page.address() as { port: number }).port;
const URL_ = `http://host.docker.internal:${port}/`;

const dockerHttp = unixSocketHttp();
const sb = createDockerSpaceBrowser({
  api: createDockerApi(dockerHttp),
  http: dockerHttp,
  name: NAME,
  image: IMAGE,
  user: { uid: 10001, gid: 10001 },
  startTimeoutMs: 90_000,
  // CHANNEL=0 measures the old way (one `docker exec` per call)
  channel: process.env["CHANNEL"] !== "0",
});
const tool = (profileId: string, name: string, args: Record<string, unknown> = {}) =>
  sb.tool({ profileId, tool: name, args, timeoutMs: 60_000 });

const out: Record<string, number | string> = {
  image: IMAGE,
  rounds: ROUNDS,
  channel: process.env["CHANNEL"] !== "0" ? "on" : "off",
};
try {
  // 1. nothing exists: the container is made and browserd answers (no browser yet)
  [out["container_cold_ms"]] = await timed(() => tool(PROFILE, "chrome_status"));
  // 2. the cost of one call that does nothing: docker exec + ctl + the socket
  const idle: number[] = [];
  for (let i = 0; i < ROUNDS * 2; i++) idle.push((await timed(() => tool(PROFILE, "chrome_status")))[0]);
  out["call_overhead_ms"] = median(idle);
  // 3. a brand new profile: Chromium starts and the first page loads, in one call (what the agent's first chrome_open waits for)
  [out["browser_cold_open_ms"]] = await timed(() => tool(PROFILE, "chrome_open", { url: URL_ }));
  // 4. the browser is up: the same page again, a snapshot, a state read, a screenshot
  const open: number[] = [];
  const snap: number[] = [];
  const state: number[] = [];
  const shot: number[] = [];
  let tree = 0;
  let png = 0;
  for (let i = 0; i < ROUNDS; i++) {
    open.push((await timed(() => tool(PROFILE, "chrome_open", { url: `${URL_}?n=${i}` })))[0]);
    const [ms, s] = await timed(() => tool(PROFILE, "chrome_snapshot"));
    snap.push(ms);
    tree = String(s["tree"] ?? "").length;
    state.push((await timed(() => tool(PROFILE, "chrome_state")))[0]);
    const [ms2, p] = await timed(() => tool(PROFILE, "chrome_screenshot"));
    shot.push(ms2);
    png = String(p["png"] ?? "").length;
  }
  out["warm_open_ms"] = median(open);
  out["snapshot_ms"] = median(snap);
  out["snapshot_chars"] = tree;
  out["state_ms"] = median(state);
  out["screenshot_ms"] = median(shot);
  out["screenshot_base64_chars"] = png;
  // 5. open + read in the shape an agent does it: two calls
  const pair: number[] = [];
  for (let i = 0; i < ROUNDS; i++)
    pair.push(
      (
        await timed(async () => {
          await tool(PROFILE, "chrome_open", { url: `${URL_}?p=${i}` });
          await tool(PROFILE, "chrome_snapshot");
        })
      )[0],
    );
  out["open_then_snapshot_ms"] = median(pair);
  // 6. the browser slept (idle stop) and the profile is kept: the next open starts Chromium again
  const wake: number[] = [];
  for (let i = 0; i < Math.min(3, ROUNDS); i++) {
    await sb.stop(PROFILE);
    wake.push((await timed(() => tool(PROFILE, "chrome_open", { url: URL_ })))[0]);
  }
  out["browser_wake_open_ms"] = median(wake);
  // 7. a second agent's first open while the container is already up
  [out["second_agent_cold_open_ms"]] = await timed(() => tool(OTHER, "chrome_open", { url: URL_ }));
} finally {
  page.close();
  sh(["rm", "-f", NAME]);
  sh(["volume", "rm", "-f", `${NAME}-data`]);
  sh(["network", "rm", `${NAME}net`]);
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);
