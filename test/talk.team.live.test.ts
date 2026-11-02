// Talk on a booted daemon with the real Vault, real access and real roles; only Deepgram is a stand-in at the fetch seam. An admin's one key covers everyone; a member can talk through it and cannot read it by any capability; a person's own key wins; turning off stops the Space key and only that; an agent's change to the Space stops at the Gate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { boot, connect, scriptedModel, seededDir, stop } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const SPACE_KEY = "dg_space_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake
const OWN_KEY = "dg_own_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake
const REVOKED = "dg_revoked_FAKEsecretVALUE0123456789abc"; // secret-scan: fake
const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];

function deepgram() {
  const grants: string[] = [];
  const dead = new Set<string>([REVOKED]);
  return {
    grants, dead,
    fetch: async (url: string, init?: { headers?: Record<string, string>; body?: unknown }) => {
      assert.equal(url, "https://api.deepgram.com/v1/auth/grant", "Talk reaches nothing else");
      const key = String(init?.headers?.["authorization"] ?? "").replace(/^Token /, "");
      grants.push(key);
      const status = dead.has(key) ? 401 : 200;
      return { status, text: async () => JSON.stringify({ access_token: `jwt.for.${grants.length}`, expires_in: 30 }), arrayBuffer: async () => new ArrayBuffer(0) };
    },
  };
}
const as = (d: Daemon) => async (who: string, cap: string, input: unknown = {}): Promise<{ status: number; data: any; error: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: b.data ?? b, error: b.error };
};
const fields = (value: string) => [{ key: "api_key", value, secret: true }];
const refusedKinds = (status: number): boolean => status >= 400;
function everyFile(dir: string): Buffer[] {
  const out: Buffer[] = [];
  const walk = (p: string): void => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else if (e.isFile() && fs.statSync(f).size < 200 * 1024 * 1024) out.push(fs.readFileSync(f)); } };
  walk(dir);
  return out;
}

test("Team: one Space key covers everyone, a member cannot read it, an own key wins, off stops only the Space key", async () => {
  const dg = deepgram();
  const dir = seededDir();
  const ownerToken = { v: "" };
  const d = await boot(dir, scriptedModel(async function* () { /* no turns */ }), {
    vault: undefined, seams: { fetch: dg.fetch },
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "voice-team" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  try {
    await connect(d);
    const mia0 = await api("usr_mia", "talk.status");
    assert.equal(mia0.status, 200, JSON.stringify(mia0));
    assert.equal(mia0.data.source, "none");
    assert.equal(mia0.data.mayManage, false);
    assert.equal((await api("usr_mia", "talk.session")).error.details.reason, "no_key");

    // a member cannot set the Space's key; a key the provider refuses is not stored
    assert.ok(refusedKinds((await api("usr_mia", "talk.space.connect", { provider: "deepgram", fields: fields(SPACE_KEY), idempotencyKey: "m1" })).status));
    const bad = await api("usr_olivia", "talk.space.connect", { provider: "deepgram", fields: fields(REVOKED), idempotencyKey: "a0" });
    assert.equal(bad.status, 502);
    assert.equal(bad.error.message, "Deepgram did not accept that key. Check it and try again.");
    assert.equal((await api("usr_olivia", "talk.space.status")).data.set, false);

    const on = await api("usr_olivia", "talk.space.connect", { provider: "deepgram", fields: fields(SPACE_KEY), idempotencyKey: "a1" });
    assert.equal(on.status, 200, JSON.stringify(on));
    assert.equal(on.data.on, true);
    const itemId = on.data.itemId as string;

    // with a Space key, the member just talks
    assert.equal((await api("usr_mia", "talk.status")).data.source, "space");
    const session = await api("usr_mia", "talk.session");
    assert.equal(session.status, 200, JSON.stringify(session));
    assert.equal(session.data.source, "space");
    assert.equal(dg.grants.at(-1), SPACE_KEY);
    assert.ok(!JSON.stringify(session.data).includes(SPACE_KEY));

    // she cannot read it by any door
    assert.ok(refusedKinds((await api("usr_mia", "vault.item.reveal", { itemId })).status), "reveal");
    assert.ok(refusedKinds((await api("usr_mia", "vault.item.get", { itemId })).status), "get");
    assert.ok(refusedKinds((await api("usr_mia", "vault.use", { item: itemId })).status), "use");
    assert.ok(refusedKinds((await api("usr_mia", "vault.fill", { handle: `${on.data.handle ?? "#Deepgram_for_this_Space"}.api_key`, target: { kind: "env", ref: "x" }, returnValue: true })).status), "fill");
    assert.ok(!JSON.stringify((await api("usr_mia", "vault.items.list")).data).includes(itemId), "she does not see it listed");
    assert.ok(refusedKinds((await api("usr_mia", "talk.space.status")).status));

    // use is attributed per person in the audit log
    const audit = await api("usr_olivia", "audit.list", { action: "talk.session", limit: 20 });
    assert.equal(audit.status, 200, JSON.stringify(audit));
    assert.ok(JSON.stringify(audit.data).includes("usr_mia"), `the audit log names who talked: ${JSON.stringify(audit.data).slice(0, 400)}`);
    assert.ok(!JSON.stringify(audit.data).includes(SPACE_KEY));

    // an own key wins, for whoever has one (Mine items seal on the person's own node, so this is the owner, on theirs; a member reaching a remote Space gets the plain locked line)
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const own = await api("usr_olivia", "talk.connect", { provider: "deepgram", fields: fields(OWN_KEY), idempotencyKey: "o2" });
    assert.equal(own.status, 200, JSON.stringify(own));
    assert.equal(own.data.source, "own");
    assert.equal((await api("usr_olivia", "talk.session")).data.source, "own");
    assert.equal(dg.grants.at(-1), OWN_KEY);
    const locked = await api("usr_mia", "talk.connect", { provider: "deepgram", fields: fields(OWN_KEY), idempotencyKey: "m2" });
    assert.equal(locked.error.details.reason, "vault_locked", "a member with no key held here is told why");
    assert.equal((await api("usr_mia", "talk.status")).data.source, "space", "and is still covered");

    // off stops the Space key, for Noah and not for Olivia
    assert.equal((await api("usr_noah", "talk.session")).data.source, "space");
    assert.equal((await api("usr_olivia", "talk.space.configure", { on: false })).data.on, false);
    assert.equal((await api("usr_noah", "talk.session")).error.details.reason, "no_key");
    assert.equal((await api("usr_olivia", "talk.session")).data.source, "own");

    // a key the provider stopped taking is one plain line
    dg.dead.add(OWN_KEY);
    const revoked = await api("usr_olivia", "talk.session");
    assert.equal(revoked.error.message, "Deepgram no longer accepts your key. Add a new one in Settings, AI, Voice.");
    dg.dead.delete(OWN_KEY);

    // neither key is anywhere in the clear on disk
    for (const file of everyFile(dir)) for (const secret of [SPACE_KEY, OWN_KEY]) assert.equal(file.includes(secret), false, "a key sits sealed, in no database row, log or event");
  } finally {
    await stop(d);
  }
});

test("Personal-style: an agent changes the person's own Talk, posts the card, and cannot add a key or change the Space", async () => {
  const dg = deepgram();
  const seen: Record<string, unknown> = {};
  const d = await boot(seededDir(), scriptedModel(async function* (input, run) {
    if (!/talk/.test(input.trigger?.body ?? "")) return;
    seen["found"] = yield* run("tool_search", { query: "switch Talk language voice" });
    yield* run("tool_search", { query: "Talk key card" });
    seen["configure"] = yield* run("talk_configure", { language: "es" });
    seen["askKey"] = yield* run("talk_ask_key", {});
    yield* run("tool_search", { query: "Talk for everyone in the Space" });
    seen["space"] = yield* run("talk_space_configure", { on: true });
    seen["connect"] = yield* run("talk_connect", { provider: "deepgram", fields: fields(SPACE_KEY), idempotencyKey: "agent-connect" });
    yield { type: "text", text: "done" };
  }), { vault: undefined, seams: { fetch: dg.fetch } });
  const api = (cap: string, input: unknown = {}) => as(d)(d.token, cap, input);
  try {
    await connect(d);
    const agent = await api("agents.create", { name: "Ops", role: "You help.", idempotencyKey: "v-agent" });
    const agentId = agent.data.agent.agentId as string;
    const th = await api("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "v-chat" });
    const threadId = th.data.thread.threadId as string;
    await api("chat.post", { threadId, body: "talk in spanish please", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "v-post" });
    for (let i = 0; i < 200 && !seen["connect"]; i++) { await d.hooks?.pump?.(); await new Promise((r) => setTimeout(r, 100)); }
    assert.equal((await api("talk.status")).data.language, "es", JSON.stringify(seen["configure"]));
    const blocks = ((await api("chat.messages.list", { threadId })).data.messages as { blocks: { type: string }[] }[]).flatMap((m) => m.blocks);
    assert.ok(blocks.some((b) => b.type === "talk_key"), `the card is in the chat: ${JSON.stringify(seen["askKey"])}`);
    assert.equal((seen["connect"] as { ok?: boolean } | undefined)?.ok, false, "there is no tool that takes a key");
    assert.equal((await api("talk.space.status")).data.set, false, "nor did the agent change the Space");
    assert.equal(dg.grants.length, 0, "no key ever reached the provider from an agent");
  } finally {
    await stop(d);
  }
});
