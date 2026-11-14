// A Space whose address is a vyre.run name that points straight at its own server (rc.26, 13 Nov 2026: the owner's Space, address mla.vyre.run, was handed the artifact host mla-a.vyre.run, a name only the relay's
// wildcard answers, and the artifact tab was a blank white page). The Space is reached through the relay only when it holds a phone name at the relay; an address under any zone is an own address, and its artifact
// host is a.<address>. The server also checks that its artifact host really reaches itself before it hands the address out, and says in Console, Health what to do until it does.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { loadConfig } from "../host/src/daemon/config.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { boot, clock, hostLog, seededDir } from "./memory-live-kit.ts";
import { api, ok, standIn } from "./member-key-kit.ts";

const ADDRESS = "mla.vyre.run";
const ART = "a.mla.vyre.run";

/** One request to the daemon with the artifact host's name in Host, the way Caddy hands it over. */
function ask(
  d: { url: string },
  path: string,
  headers: Record<string, string> = {},
  host = ART,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(d.url);
    const r = http.request(
      { host: u.hostname, port: u.port, path, method: "GET", headers: { host, ...headers } },
      (res) => {
        const c: Buffer[] = [];
        res.on("data", (x: Buffer) => c.push(x));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(c).toString("utf8") }),
        );
      },
    );
    r.on("error", reject);
    r.end();
  });
}

interface Net {
  /** what the artifact host name does: reaches this server, fails the way an unrouted name does (no certificate), or answers as some other server */
  mode: "reaches" | "unreachable" | "other" | "stalls";
  asked: string[];
}
/** The outside world as the daemon sees it: the Caddy admin stand-in everywhere, and the artifact host's name either reaching the daemon (as DNS, Caddy and a certificate would) or not. */
function world(net: Net, daemonUrl: () => string): FetchFn {
  return async (url, init) => {
    const u = new URL(url);
    if (u.hostname !== ART) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('{"apps":{"http":{}}}'),
      };
    }
    net.asked.push(u.pathname);
    if (net.mode === "stalls")
      return { ok: true, status: 200, headers: { get: () => null }, text: () => new Promise<string>(() => undefined) };
    if (net.mode === "unreachable") throw new Error("tls: no certificate for this name");
    if (net.mode === "other")
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve("a page of some other server"),
      };
    const r = await ask({ url: daemonUrl() }, `${u.pathname}${u.search}`, init?.headers ?? {}, ART);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: () => null },
      text: () => Promise.resolve(r.body),
    };
  };
}

async function start(
  net: Net,
  address: string | null = ADDRESS,
): Promise<{ d: Awaited<ReturnType<typeof boot>>; dir: string }> {
  delete process.env["VYRE_ARTIFACT_HOST"];
  const dir = seededDir();
  let url = "";
  const d = await boot(dir, standIn, undefined, {
    config: loadConfig(["--data-dir", dir, "--port", "0", ...(address ? ["--address", address] : [])], {}, "1.2.3"),
    fetch: world(net, () => url),
    vault: undefined,
  } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  url = d.url;
  // the check the start ran before the server had an address to be asked at (the stand-in only knows it now) is old by the time anyone opens a page
  clock.t += 120_000;
  return { d, dir };
}

const publish = async (d: Awaited<ReturnType<typeof boot>>, key: string): Promise<string> =>
  (
    await ok(d, d.token, "sites.artifact_publish", {
      title: "Crew test",
      html: "<p>the page</p>",
      idempotencyKey: key,
    })
  ).artifactId as string;

const finding = async (
  d: Awaited<ReturnType<typeof boot>>,
): Promise<{ state: string; detail: string; next: string } | undefined> => {
  const r = await api(d, d.token, "machines.get", { machineId: "space", idempotencyKey: `fnd-${++seq}` });
  assert.equal(r.status, 200, `${JSON.stringify(r.data)}\n${hostLog(d)}`);
  return (r.data.findings as Array<{ key: string; state: string; detail: string; next: string }>).find(
    (f) => f.key === "doctor.host.artifact_host",
  );
};
let seq = 0;

test(
  "an address under vyre.run with no relay name behind it is an own address: its artifact host is a.<address>, served by this server",
  { timeout: 120_000 },
  async () => {
    const net: Net = { mode: "reaches", asked: [] };
    const { d, dir } = await start(net);
    try {
      const id = await publish(d, "oa-1");
      const open = await ok(d, d.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "oa-open" });
      assert.equal(
        new URL(open.url).host,
        ART,
        `the host the app is given must be the one this server serves; got ${open.url} (a relay name this Space does not hold answers 404 from the relay)`,
      );
      // the address answers from this server: the code becomes a session, the session gets the page
      const code = /\/x\/([0-9a-f]{48})/.exec(open.path)?.[1];
      const first = await ask(d, `/x/${code}`);
      assert.equal(first.status, 302);
      const cookie = /(__vyre_a=[^;]+)/.exec(String(first.headers["set-cookie"]?.[0]))?.[1] as string;
      const page = await ask(d, `/${id}/`, { cookie });
      assert.equal(page.body, "<p>the page</p>");
      assert.match(
        String(page.headers["content-security-policy"]),
        /sandbox allow-scripts/,
        "no content rule is loosened",
      );
      // the relay-form name is nothing of this Space's
      assert.notEqual((await ask(d, `/${id}/`, { cookie }, "mla-a.vyre.run")).body, "<p>the page</p>");
      // the server's own check reached it, and Console, Health has nothing to say
      assert.ok(net.asked.length >= 1, "the daemon asked its own artifact host");
      assert.equal((await finding(d))?.state, "healthy");
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "an artifact host that does not reach this server is never handed out: the open says so plainly, Console, Health says what to do, and both clear once it answers",
  { timeout: 120_000 },
  async () => {
    const net: Net = { mode: "unreachable", asked: [] };
    const { d, dir } = await start(net);
    try {
      const id = await publish(d, "ob-1");
      const r = await api(d, d.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "ob-open-1" });
      assert.notEqual(r.status, 200, `no address while ${ART} does not answer: ${JSON.stringify(r.data)}`);
      assert.doesNotMatch(JSON.stringify(r.data), /https?:\/\//, "no address in the answer");
      assert.match(JSON.stringify(r.data), /not answering/i);
      const f = await finding(d);
      assert.equal(f?.state, "degraded");
      assert.equal(
        f?.detail,
        `Artifact pages cannot open yet: ${ART} does not reach this server. Add this DNS record: ${ART} pointing at this server.`,
      );
      assert.ok(f?.next);
      // a name that answers as some other server is not this Space's host either
      net.mode = "other";
      clock.t += 120_000;
      assert.notEqual(
        (await api(d, d.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "ob-open-2" })).status,
        200,
        "another server's answer does not carry this Space's marker",
      );
      // the record is added: the next open finds it, with no restart
      net.mode = "reaches";
      clock.t += 120_000;
      const open = await ok(d, d.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "ob-open-3" });
      assert.equal(new URL(open.url).host, ART);
      assert.equal((await finding(d))?.state, "healthy", "the line clears");
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a Space that holds a phone name at the relay is reached through the relay: its artifact host is <name>-a.vyre.run, carried by the control link, so it is not asked over the internet",
  { timeout: 120_000 },
  async () => {
    const net: Net = { mode: "unreachable", asked: [] };
    const { d, dir } = await start(net, null);
    try {
      d.db!.run(
        "INSERT OR REPLACE INTO network_phone (id, name, nickname, state, detail, box_key, reported_at) VALUES (1, 'harbor', NULL, 'claimed', NULL, NULL, 1)",
      );
      const id = await publish(d, "oc-1");
      const open = await ok(d, d.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "oc-open" });
      assert.equal(new URL(open.url).host, "harbor-a.vyre.run");
      assert.deepEqual(
        net.asked,
        [],
        "the relay carries only the artifact host's /x and /sit_ paths, so no check goes out for it",
      );
      assert.equal((await finding(d))?.state, "healthy");
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a host that sends headers and then stalls does not wedge the server: the open answers plainly within the limit, and finds the host once it answers",
  { timeout: 120_000 },
  async () => {
    const net: Net = { mode: "stalls", asked: [] };
    const { d, dir } = await start(net);
    try {
      const id = await publish(d, "od-1");
      const t0 = Date.now();
      const r = await api(d, d.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "od-open-1" });
      assert.notEqual(r.status, 200);
      assert.match(JSON.stringify(r.data), /not answering/i);
      assert.ok(Date.now() - t0 < 15_000, "not held for ever behind the stalled read");
      assert.equal((await finding(d))?.state, "degraded", "Health answers too");
      net.mode = "reaches";
      clock.t += 120_000;
      const open = await ok(d, d.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "od-open-2" });
      assert.equal(new URL(open.url).host, ART);
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
