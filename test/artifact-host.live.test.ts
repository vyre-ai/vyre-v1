// The artifact host on a booted Team server (owner ruling, 4 Nov): the app's own origin never serves an artifact; artifact_open gives a one-time code for the artifact host; the code becomes a cookie session of that
// host; access is asked again on every request. Requests are made with the artifact host's name in Host, the way Caddy or the relay hands them over.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { boot, clock, seededDir } from "./memory-live-kit.ts";
import { api, door, join, ok, standIn } from "./member-key-kit.ts";
import { reachingFetch } from "../host/tests/artifact-host-kit.test.ts";

const HOST = "a.team.example.test";

function ask(
  d: { url: string },
  path: string,
  headers: Record<string, string> = {},
  host = HOST,
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
const cookieOf = (h: http.IncomingHttpHeaders): string =>
  /(__vyre_a=[^;]+)/.exec(String(h["set-cookie"]?.[0] ?? ""))?.[1] ?? "";

test(
  "an artifact opens only on its own host, by a one-time code, for the people it is shared with; revoking ends it at the next request",
  { timeout: 120_000 },
  async () => {
    process.env["VYRE_ARTIFACT_HOST"] = HOST;
    const dir = seededDir();
    let at = "";
    const d = await boot(dir, standIn, undefined, {
      vault: undefined,
      fetch: reachingFetch(HOST, () => at),
    } as unknown as NonNullable<Parameters<typeof boot>[3]>);
    at = d.url;
    clock.t += 120_000; // the start's own check ran before the stand-in knew the address
    try {
      const rubab = await join(d, "rubab");
      const sara = await join(d, "sara");
      void door;
      const made = await ok(d, d.token, "sites.artifact_publish", {
        title: "Crew test",
        html: "<p>the page</p>",
        idempotencyKey: "ah-1",
      });
      const id = made.artifactId as string;

      // shared with Rubab only: Sara may not even ask for a code
      const grant = await ok(d, d.token, "access.share", {
        resource: { type: "site", id },
        subject: { kind: "person", id: rubab.personId },
        level: "view",
        idempotencyKey: "ah-share",
      });
      await d.hooks?.pump?.();
      assert.ok(
        [403, 404].includes(
          (await api(d, sara.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "ah-sara" })).status,
        ),
        "not shared: no code",
      );

      const open = await ok(d, rubab.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "ah-open-1" });
      assert.equal(
        open.url,
        `https://${HOST}/x/${/\/x\/([0-9a-f]{48})/.exec(open.path)?.[1]}`,
        "a code for the artifact host, never the app's origin",
      );

      // the app's own origin serves nothing of it: the keyed address of old is gone, and the host name is what decides
      assert.notEqual((await ask(d, `/a/${id}/k/${"0".repeat(48)}/`, {}, "team.example.test")).body, "<p>the page</p>");
      // the code is traded once for a cookie session, and the address it lands on is clean
      const first = await ask(d, open.path);
      assert.equal(first.status, 302);
      assert.equal(first.headers.location, `/${id}/`);
      const cookie = cookieOf(first.headers);
      assert.ok(cookie, "a session cookie");
      assert.match(String(first.headers["set-cookie"]?.[0]), /HttpOnly; Secure; SameSite=Lax/);
      assert.equal((await ask(d, open.path)).status, 404, "a second use is refused");

      // incognito: no cookie, no page
      const none = await ask(d, `/${id}/`);
      assert.equal(none.status, 403);
      assert.match(none.body, /You don&#39;t have access to this page/);
      // with the session: the page, sandboxed, framed by the app's origins only
      const page = await ask(d, `/${id}/`, { cookie });
      assert.equal(page.status, 200);
      assert.equal(page.body, "<p>the page</p>");
      assert.match(String(page.headers["content-security-policy"]), /sandbox allow-scripts/);
      assert.match(String(page.headers["content-security-policy"]), /frame-ancestors [^;,]*tauri:\/\/localhost/);
      assert.equal(
        (await ask(d, `/${id}/`, { cookie }, "team.example.test")).body === "<p>the page</p>",
        false,
        "the cookie is the artifact host's alone",
      );

      // revoked: the very next request is refused
      assert.equal(
        (await ok(d, d.token, "access.unshare", { grantId: grant.grant.grantId ?? grant.grant.id })).revoked >= 1,
        true,
      );
      assert.equal((await ask(d, `/${id}/`, { cookie })).status, 403, "removed from the share: out at once");
    } finally {
      delete process.env["VYRE_ARTIFACT_HOST"];
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "an artifact's cookie ends with the person: signing out, or the owner being suspended, refuses the very next request",
  { timeout: 120_000 },
  async () => {
    process.env["VYRE_ARTIFACT_HOST"] = HOST;
    const dir = seededDir();
    let at = "";
    const d = await boot(dir, standIn, undefined, {
      vault: undefined,
      fetch: reachingFetch(HOST, () => at),
    } as unknown as NonNullable<Parameters<typeof boot>[3]>);
    at = d.url;
    clock.t += 120_000; // the start's own check ran before the stand-in knew the address
    try {
      const open = async (who: { token: string }, key: string): Promise<{ id: string; cookie: string }> => {
        const made = await ok(d, who.token, "sites.artifact_publish", {
          title: `Mine ${key}`,
          html: "<p>mine</p>",
          idempotencyKey: `ah-own-${key}`,
        });
        const id = made.artifactId as string;
        const code = await ok(d, who.token, "sites.artifact_open", {
          artifactId: id,
          idempotencyKey: `ah-own-open-${key}`,
        });
        const cookie = cookieOf((await ask(d, code.path)).headers);
        assert.equal((await ask(d, `/${id}/`, { cookie })).status, 200, `${key}: the owner sees their own page`);
        return { id, cookie };
      };
      const rubab = await join(d, "rubab");
      const mine = await open(rubab, "out");
      await ok(d, rubab.token, "identity.sign_out", {});
      assert.equal(
        (await ask(d, `/${mine.id}/`, { cookie: mine.cookie })).status,
        403,
        "signed out: the cookie is refused at once",
      );
      const sara = await join(d, "sara");
      const hers = await open(sara, "susp");
      await ok(d, d.token, "members.suspend", { personId: sara.personId });
      assert.equal(
        (await ask(d, `/${hers.id}/`, { cookie: hers.cookie })).status,
        403,
        "the owner suspended: refused at once",
      );
    } finally {
      delete process.env["VYRE_ARTIFACT_HOST"];
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
