// A person's own GitHub, host half: the app (the Space's own, else the default), the code and refresh exchanges, and the person's Vault.
import test from "node:test";
import assert from "node:assert/strict";
import { createGithubHost } from "./comms.ts";

const ctx = { space: "spc_test", trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => 1_000_000, db: { all: () => [] } };
function rig(o: { space?: boolean; mine?: boolean; defaultApp?: boolean } = {}) {
  const calls: Array<{ url: string; method?: string; body?: string; headers?: Record<string, string> }> = [];
  const mine = new Map<string, string>();
  const hostCalls: Array<{ name: string; input: any }> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const vault = {
    secret: async (h: string, _s: string, asker?: string) => {
      if (asker) return mine.get(`${asker}`) ?? "";
      if (o.space && h === "#GitHub_App_Client_Id") return "Iv1.space";
      if (o.space && h === "#GitHub_App_Client_Secret") return "space_secret";
      throw new Error("none");
    },
  };
  const hostCall = async (name: string, input: any) => { hostCalls.push({ name, input }); if (name === "vault.mine_set") mine.set(input.owner, input.fields.refresh_token); if (name === "vault.mine_remove") mine.delete(input.owner); return {}; };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const host = createGithubHost({
    vault: vault as never, fetch: async (url, init) => { calls.push({ url, ...(init?.method ? { method: init.method } : {}), ...(typeof init?.body === "string" ? { body: init.body } : {}), ...(init?.headers ? { headers: init.headers } : {}) }); return { status: 200, text: async () => JSON.stringify({ access_token: "ghu_a", refresh_token: "ghr_a", expires_in: 28800 }), arrayBuffer: async () => new ArrayBuffer(0) }; },
    blobs: {} as never, publicUrl: async () => "https://space.vyre.test",
    ...(o.mine === false ? {} : { hostCall }),
    ...(o.defaultApp === false ? {} : { defaultApp: () => ({ clientId: "Iv1.vyre", clientSecret: "vyre_secret" }) }),
  });
  return { u: host.user!, calls, mine, hostCalls };
}

test("the Space's own app is used when it has one, else the default Vyre app", async () => {
  assert.deepEqual(await rig({ space: true }).u.app(ctx), { clientId: "Iv1.space", source: "space" });
  assert.deepEqual(await rig().u.app(ctx), { clientId: "Iv1.vyre", source: "vyre" });
  await assert.rejects(rig({ defaultApp: false }).u.app(ctx), (e: any) => e.error.code === "internal.unavailable");   // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("the code and the refresh go to github.com only, with the client's secret, and the answer carries when it ends", async () => {
  const r = rig();
  const t = await r.u.exchange(ctx, { code: "c1", verifier: "v1", redirectUri: "https://space.vyre.test/hooks/github/connect" });
  assert.deepEqual(t, { accessToken: "ghu_a", refreshToken: "ghr_a", expiresAt: 1_000_000 + 28_800_000 });
  assert.equal(r.calls[0]!.url, "https://github.com/login/oauth/access_token");
  const form = new URLSearchParams(r.calls[0]!.body);
  assert.equal(form.get("code_verifier"), "v1");
  assert.equal(form.get("client_secret"), "vyre_secret");
  await r.u.refresh(ctx, { refreshToken: "ghr_a" });
  assert.equal(new URLSearchParams(r.calls[1]!.body).get("grant_type"), "refresh_token");
});

test("the refresh token lives in the person's own Vault; a Vault that cannot keep one says so", async () => {
  const r = rig();
  await r.u.keep(ctx, "usr_maya", { refreshToken: "ghr_z" });
  assert.deepEqual(r.hostCalls[0], { name: "vault.mine_set", input: { owner: "usr_maya", name: "GitHub", fields: { refresh_token: "ghr_z" } } });
  assert.equal(await r.u.recall(ctx, "usr_maya"), "ghr_z");   // read as the person, through their own handle
  assert.equal(await r.u.recall(ctx, "usr_other"), null);
  await r.u.forget(ctx, "usr_maya");
  assert.equal(await r.u.recall(ctx, "usr_maya"), null);
  await assert.rejects(rig({ mine: false }).u.keep(ctx, "usr_maya", { refreshToken: "x" }), (e: any) => e.error.code === "internal.unavailable");   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(await r.u.redirectUri(ctx), "https://space.vyre.test/hooks/github/connect");
});
