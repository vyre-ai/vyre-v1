// F56 (14 Nov 2026), the visitor door: who a published address answers, per access value, as an outsider (no session), a member and the owner. The door is the artifact host (a separate origin that shares the daemon's
// port): a one-time code minted for a signed-in person is traded for that host's cookie, and access is asked again on every request. Real daemon, a host name, the exchange-code flow.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { reachingFetch } from "./artifact-host-kit.test.ts";

function ask(
  base: string,
  p: string,
  headers: Record<string, string>,
  host: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const r = http.request(
      { host: u.hostname, port: u.port, path: p, method: "GET", headers: { host, ...headers } },
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

test("the artifact host answers an outsider, a member and the owner by the site's access value", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sites-visitor-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  let url = "";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "sites-visitor",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: reachingFetch("a.team.example.com", () => url),
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      if (t === "olivia")
        return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "dev_x" };
      if (t === "noah") return { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "dev_y" };
      return null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  url = d.url;
  const lines: string[] = [];
  try {
    const call = async (token: string, p: string, body: unknown): Promise<{ status: number; json: any }> => {
      const r = await fetch(`${d.url}${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      return { status: r.status, json: await r.json() };
    };
    const pub = await call("olivia", "/v1/sites/artifact_publish", {
      idempotencyKey: "v1",
      title: "Visitor test",
      html: "<p>SECRET-BODY</p>",
    });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    const id = pub.json.data.artifactId as string;
    const through = async (token: string): Promise<string> => {
      const open = await call(token, "/v1/sites/artifact_open", {
        idempotencyKey: `o-${token}-${Math.random()}`,
        artifactId: id,
      });
      if (open.status !== 200) return `no code (${open.status} ${open.json.error?.code})`;
      const host = new URL(open.json.data.url as string).host;
      const first = await ask(d.url, open.json.data.path as string, {}, host);
      const cookie = /(__vyre_a=[^;]+)/.exec(String(first.headers["set-cookie"]?.[0] ?? ""))?.[1] ?? "";
      if (!cookie) return `code not traded (${first.status})`;
      const page = await ask(d.url, String(first.headers.location), { cookie }, host);
      return `${page.status} ${page.body.includes("SECRET-BODY") ? "BODY" : "no body"}`;
    };
    const stranger = async (): Promise<string> => {
      const open = await call("olivia", "/v1/sites/artifact_open", {
        idempotencyKey: `o-s-${Math.random()}`,
        artifactId: id,
      });
      if (open.status !== 200) return `host unavailable (${open.status})`;
      const host = new URL(open.json.data.url as string).host;
      const r = await ask(d.url, `/${id}/`, {}, host);
      return `${r.status} ${r.body.includes("SECRET-BODY") ? "BODY" : "no body"}`;
    };
    const seen: Record<string, Record<string, string>> = {};
    for (const access of ["private", "space", "password", "public"] as const) {
      const set = await call("olivia", "/v1/sites/update", { siteId: id, access });
      lines.push(
        `access ${access}: update ${set.status}${set.status === 200 ? "" : " " + (set.json.error?.message ?? "").slice(0, 90)}`,
      );
      if (set.status !== 200) continue;
      seen[access] = { outsider: await stranger(), member: await through("noah"), owner: await through("olivia") };
      lines.push(
        `  ${access}: outsider ${seen[access]!.outsider}; member ${seen[access]!.member}; owner ${seen[access]!.owner}`,
      );
    }
    // a member's session minted while the site is the Space's stops working the moment it is private: access is asked again on every request
    await call("olivia", "/v1/sites/update", { siteId: id, access: "space" });
    await call("olivia", "/v1/sites/artifact_publish", {
      idempotencyKey: "v-again",
      title: "Visitor test",
      html: "<p>SECRET-BODY</p>",
      artifactId: id,
    });
    const open = await call("noah", "/v1/sites/artifact_open", { idempotencyKey: "o-late", artifactId: id });
    const host = new URL(open.json.data.url as string).host;
    const first = await ask(d.url, open.json.data.path as string, {}, host);
    const cookie = /(__vyre_a=[^;]+)/.exec(String(first.headers["set-cookie"]?.[0] ?? ""))?.[1] ?? "";
    const where = String(first.headers.location);
    assert.match(
      (await ask(d.url, where, { cookie }, host)).body,
      /SECRET-BODY/,
      "the member's session works while the site is the Space's",
    );
    await call("olivia", "/v1/sites/update", { siteId: id, access: "private" });
    const late = await ask(d.url, where, { cookie }, host);
    lines.push(
      `  a member's cookie from while it was Space, after it went private: ${late.status} ${late.body.includes("SECRET-BODY") ? "BODY" : "no body"}`,
    );
    assert.doesNotMatch(
      late.body,
      /SECRET-BODY/,
      `an old member session still opens a private site: ${lines.join("\n")}`,
    );
    // the rules
    assert.match(seen["private"]!["owner"]!, /^200 BODY/, lines.join("\n"));
    assert.doesNotMatch(seen["private"]!["member"]!, /BODY/, `a member got a private site: ${lines.join("\n")}`);
    assert.doesNotMatch(seen["private"]!["outsider"]!, /BODY/, `an outsider got a private site: ${lines.join("\n")}`);
    assert.match(seen["space"]!["member"]!, /^200 BODY/, `a member is refused a Space site: ${lines.join("\n")}`);
    assert.doesNotMatch(seen["space"]!["outsider"]!, /BODY/, `an outsider got a Space site: ${lines.join("\n")}`);
    assert.ok(lines.length > 0);
    if (process.env["VISITOR_LINES"]) fs.writeFileSync(process.env["VISITOR_LINES"], lines.join("\n"));
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
