// Against a real Caddy (the caddy:2-alpine image on the host network, admin on 127.0.0.1:22019, one site on :18080): the config is accepted, written once and found "same" the next time, and a request
// comes back as one line with its host, status and path, and none of its headers (cookie, authorization). VYRE_HEAVY_DOCKER=1 on a box with Docker; skipped by name otherwise.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { CaddyAdmin } from "./admin.ts";
import { ensureAccessLog, startAccessSink } from "./accesslog.ts";

const HEAVY = process.env["VYRE_HEAVY_DOCKER"] === "1";
const SKIP = HEAVY ? false : "needs Docker: set VYRE_HEAVY_DOCKER=1";
const NAME = "vyre-caddy-accesslog-test";
const CONFIG = JSON.stringify({
  admin: { listen: "127.0.0.1:22019" },
  apps: {
    http: {
      servers: {
        vyre: {
          listen: [":18080"],
          automatic_https: { disable: true },
          routes: [{ match: [{ host: ["shop.sites.test"] }], handle: [{ handler: "static_response", body: "hi" }] }],
        },
      },
    },
  },
});

test(
  "a real Caddy writes one line per request to the sink, without headers, and the config is not rewritten on the next call",
  { skip: SKIP },
  async (t) => {
    try {
      execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" });
    } catch {
      /* none */
    }
    execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        NAME,
        "--network",
        "host",
        "caddy:2-alpine",
        "sh",
        "-c",
        `echo '${CONFIG}' > /tmp/c.json && caddy run --config /tmp/c.json`,
      ],
      { stdio: "ignore" },
    );
    const lines: string[] = [];
    const sink = await startAccessSink((l) => lines.push(l));
    t.after(async () => {
      await sink.close();
      execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" });
    });
    const admin = new CaddyAdmin({ baseUrl: "http://127.0.0.1:22019" });
    for (let i = 0; i < 30; i++) {
      try {
        await admin.config();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    assert.equal(await ensureAccessLog(admin, sink.port), "set");
    assert.equal(await ensureAccessLog(admin, sink.port), "same");
    execFileSync("curl", [
      "-s",
      "-o",
      "/dev/null",
      "-H",
      "Host: shop.sites.test",
      "-H",
      "Cookie: session=COOKIESECRET",
      "-H",
      "Authorization: Bearer AUTHSECRET",
      "http://127.0.0.1:18080/products?x=1",
    ]);
    for (let i = 0; i < 20 && lines.length === 0; i++) await new Promise((r) => setTimeout(r, 250));
    assert.equal(lines.length, 1);
    const raw = lines[0] as string;
    assert.equal(
      raw.includes("COOKIESECRET") || raw.includes("AUTHSECRET") || raw.includes('"headers"'),
      false,
      "no header leaves Caddy",
    );
    const o = JSON.parse(raw) as { status: number; request: { host: string; uri: string }; duration: number };
    assert.deepEqual([o.status, o.request.host, o.request.uri], [200, "shop.sites.test", "/products?x=1"]);
  },
);
