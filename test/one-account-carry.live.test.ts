// The carry door (rc.17, lead ruling 3 Nov), live: B's web page brings an account from A across origins. A sign-in from a foreign https origin gets a carry token, never a session: it reads
// the bundle once, the name, and signs out, from that Origin only, for 5 minutes. Every other call refuses it, from a browser or not. The browser's own rule is met: only those calls answer a
// foreign origin's preflight. The person sees it in their Security list and the audit log.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWithRecovery } from "../client/src/crypto/keys.ts";
import { carriedOf, signInHome } from "../apps/app/src/join/identity.ts";
import type { HomeDeps } from "../apps/app/src/join/identity.ts";
import { boot, clock, seededDir } from "./memory-live-kit.ts";
import { ok, standIn } from "./member-key-kit.ts";
import { FAST, PASSWORD, accept, crypto, invite, joinWithNew, same, sendable, spaceB, spaceOf } from "./one-account-kit.ts";

const B_PAGE = "https://beacon.example";
type Answer = { status: number; acao: string | null; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function post(url: string, path: string, body: unknown, o: { token?: string; origin?: string } = {}): Promise<Answer> {
  const r = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(o.origin ? { origin: o.origin } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { data?: unknown };
  return { status: r.status, acao: r.headers.get("access-control-allow-origin"), data: j.data ?? j };
}
const preflight = async (url: string, path: string, origin = B_PAGE) => fetch(`${url}${path}`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type, authorization" } });
const device = { deviceName: "Browser", deviceClass: "web" };

test("a sign-in from another Space's page makes a carry token: the bundle once, the name, sign-out, from that origin only, for 5 minutes; nothing else", async () => {
  const dirs = [seededDir()];
  const a = await boot(dirs[0]!, standIn);
  const b = await spaceB("spc_oneid_carry", "Beacon");
  try {
    const CODE = "C4RY-2KQX-7HMT-W4PD";
    const dana = await joinWithNew(a, "dana", CODE);
    // the browser's preflight: only the carry calls answer a foreign origin
    for (const p of ["/v1/identity/sign_in_options", "/v1/identity/sign_in", "/v1/identity/recovery_fetch", "/v1/identity/keys_get", "/v1/identity/whoami", "/v1/identity/sign_out"]) {
      const r = await preflight(a.url, p);
      assert.equal(r.status, 204, p);
      assert.equal(r.headers.get("access-control-allow-origin"), B_PAGE, p);
    }
    for (const p of ["/v1/spaces/get", "/v1/vault/folders/list", "/v1/identity/change_password", "/v1/identity/security/get"]) assert.equal((await preflight(a.url, p)).headers.get("access-control-allow-origin"), null, `${p} never answers a foreign page`);
    assert.equal((await preflight(a.url, "/v1/identity/sign_in", "http://beacon.example")).headers.get("access-control-allow-origin"), null, "https only");
    assert.equal((await post(a.url, "/v1/identity/sign_in_options", {}, { origin: B_PAGE })).acao, B_PAGE);

    // the sign-in: a carry token, never a session
    assert.equal((await post(a.url, "/v1/identity/sign_in", { username: "dana", password: "wrong", ...device }, { origin: B_PAGE })).status, 401);
    const signed = await post(a.url, "/v1/identity/sign_in", { username: "dana", password: PASSWORD, ...device }, { origin: B_PAGE });
    assert.equal(signed.status, 200, JSON.stringify(signed.data));
    assert.equal(signed.acao, B_PAGE);
    assert.equal(signed.data.carry, true);
    assert.equal(signed.data.keys, undefined, "no bundle in the sign-in answer");
    const token = signed.data.session.token as string;
    assert.match(token, /^vct_/);
    // refused everywhere else: through the gateway, in a browser and from a server with no Origin
    for (const [path, origin] of [["/v1/spaces/get", B_PAGE], ["/v1/spaces/get", undefined], ["/v1/identity/security/get", undefined], ["/v1/vault/folders/list", B_PAGE], ["/v1/identity/change_password", undefined], ["/v1/members/invites/list", undefined]] as const) {
      const r = await post(a.url, path, {}, { token, ...(origin ? { origin } : {}) });
      assert.equal(r.status, 401, `${path} from ${origin ?? "a server"}`);
    }
    for (const path of ["/sync/v1/hello", "/mcp", "/vault/key/status"]) assert.equal((await fetch(`${a.url}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` } })).status, 401, path);
    // bound to the origin that asked: another page, or no page at all, gets nothing
    assert.equal((await post(a.url, "/v1/identity/keys_get", {}, { token, origin: "https://elsewhere.example" })).status, 401);
    assert.equal((await post(a.url, "/v1/identity/keys_get", {}, { token })).status, 401);
    // what it may do: the name, the bundle once
    const who = await post(a.url, "/v1/identity/whoami", {}, { token, origin: B_PAGE });
    assert.equal(who.status, 200);
    assert.equal(who.data.principal.id, dana.personId);
    const keys = await post(a.url, "/v1/identity/keys_get", {}, { token, origin: B_PAGE });
    assert.equal(keys.status, 200);
    assert.equal(keys.data.keys.publicKey, dana.publicKey);
    assert.equal((await post(a.url, "/v1/identity/keys_get", {}, { token, origin: B_PAGE })).status, 401, "once");
    // a session token from a foreign page is refused too: a page should never hold one
    assert.equal((await post(a.url, "/v1/identity/whoami", {}, { token: dana.token, origin: B_PAGE })).status, 403);
    // it expires
    const late = (await post(a.url, "/v1/identity/sign_in", { username: "dana", password: PASSWORD, ...device }, { origin: B_PAGE })).data.session.token as string;
    clock.t += 5 * 60_000 + 1000;
    assert.equal((await post(a.url, "/v1/identity/whoami", {}, { token: late, origin: B_PAGE })).status, 401, "after 5 minutes");
    // the person sees it, and it is audited with the origin
    const sec = await ok(a, dana.token, "identity.security.get");
    assert.equal(sec.carried?.[0]?.origin, B_PAGE);
    const rows = (await ok(a, a.token, "audit.list", { limit: 100 })).rows as Array<{ action: string }>;
    const carried = rows.filter((r) => r.action === "identity.carry_sign_in");
    assert.ok(carried.length >= 2, JSON.stringify(rows.map((r) => r.action).slice(0, 20)));
    assert.match(JSON.stringify(carried[0]), /beacon\.example/);
    assert.ok(!JSON.stringify(rows).includes(PASSWORD));

    // the whole carry as B's page does it, through the app's own code: each answer carries the CORS header a browser needs
    const seen: string[] = [];
    const pageFetch = (address: string, token?: string) => async (cap: string, input: unknown): Promise<unknown> => {
      const r = await post(address, `/v1/${cap.replaceAll(".", "/")}`, input, { origin: B_PAGE, ...(token ? { token } : {}) });
      assert.equal(r.acao, B_PAGE, `${cap}: a browser would refuse to read this answer`);
      seen.push(cap);
      if (r.status !== 200) throw Object.assign(new Error(cap), { status: r.status, code: (r.data as { error?: { code?: string } }).error?.code });
      return r.data;
    };
    const deps: HomeDeps = { anonymous: (x) => pageFetch(x), signedIn: (x, t) => pageFetch(x, t), device };
    const home = await signInHome(deps, a.url, "dana", PASSWORD);
    assert.ok(home !== "second_factor");
    assert.deepEqual(seen, ["identity.sign_in", "identity.keys_get", "identity.whoami", "identity.sign_out"]);
    const made = await carriedOf({ kind: "password", ...home, password: PASSWORD }, crypto).carry(await spaceOf(b));
    assert.ok(same(made.personKey, dana.personKey));
    const joined = await accept(b, await invite(b), home.username, PASSWORD, sendable(made));
    assert.ok(same((await openWithRecovery(CODE, (await ok(b, joined.token, "identity.keys_get")).keys, { argon: FAST })).personKey, dana.personKey), "the old recovery code opens it in B");
  } finally {
    await a.stop(); await b.stop();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});
