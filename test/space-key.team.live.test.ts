// The Space AI key on a booted Team Space daemon, end to end with the real Vault, the real account resolution and the real API driver: only the model vendor is a stub, an OpenAI-compatible
// server on this machine (there is no real OpenCode Go key here; it is registered as a custom OpenAI-compatible endpoint, the same driver code OpenCode Go uses). The owner sets the key in one
// checked step; two members with no AI account of their own each get a reply on it, the stub sees the Space key on every request, usage lands on each member, and no member can read or use the key
// by name. A model that runs out of usage moves the turn to the next model and shows greyed with its time. The key is in no reply, no host log and no file of the data directory in the clear.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { boot, hostLog, seededDir, stop, waitFor } from "./support/eco-live.ts";

const SPACE_KEY = "ocg-space-FAKEkey-0123456789abcdefGHIJ"; // secret-scan: fake
const OWNER_KEY = "ocg-owner-FAKEkey-9876543210zyxwvuTSRQ"; // secret-scan: fake
const MEMBERS = ["usr_mia", "usr_noah"];
const WHO = ["usr_olivia", "usr_adam", ...MEMBERS];

interface Seen { url: string; auth: string; model?: string }

/** Chat Completions on loopback: lists one model for either key and answers "<who> on the space key" (who is the last user line), with usage, for the Space key only. */
async function vendor(seen: Seen[], out: Set<string> = new Set()): Promise<{ base: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += String(c); });
    req.on("end", () => {
      const auth = String(req.headers["authorization"] ?? "");
      const body = raw === "" ? {} : (JSON.parse(raw) as { model?: string; messages?: Array<{ role: string; content: unknown }> });
      seen.push({ url: req.url ?? "", auth, ...(body.model ? { model: body.model } : {}) });
      if (auth !== `Bearer ${SPACE_KEY}` && auth !== `Bearer ${OWNER_KEY}`) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"bad key"}'); return; }
      if (req.method === "GET" && req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "glm-test" }, { id: "kimi-test" }] })); return; }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        // a model out of its usage on the plan: 429 with when it comes back, the way a plan with a quota answers
        if (body.model && out.has(body.model)) { res.writeHead(429, { "content-type": "application/json", "retry-after": "900" }); res.end('{"error":{"message":"usage limit reached for this model"}}'); return; }
        const last = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
        const said = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
        const who = /from (\w+)/.exec(said)?.[1] ?? "someone";
        const chunk = (d: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(chunk({ role: "assistant", content: `${who} on the space key` }) + chunk({}, "stop") + `data: ${JSON.stringify({ id: "c1", choices: [], usage: { prompt_tokens: 40, completion_tokens: 6 } })}\n\ndata: [DONE]\n\n`);
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

/** Every file of the data directory, as bytes: the key must be in none of them in the clear. */
function filesHolding(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (p: string): void => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile() && fs.readFileSync(f).includes(Buffer.from(needle))) hits.push(path.relative(dir, f));
    }
  };
  walk(dir);
  return hits;
}

test("Team: the owner sets a Space AI key; members with no account each get a reply on it, usage is theirs, and nobody can read it", async () => {
  const seen: Seen[] = [];
  const out = new Set<string>();
  const stub = await vendor(seen, out);
  const dir = seededDir();
  const owner = { v: "" };
  const d = await boot(dir, undefined as never, {
    // the real Vault and the real opener (no stand-in model); the computer is the members' own (space,device), so the loopback stub is reachable
    vault: undefined, engineOpenSession: undefined,
    config: loadConfig(["--data-dir", dir, "--port", "0", "--role", "space,device"], {}, "1.2.3"),
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === owner.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "space-key-live" } : null;
    },
  });
  owner.v = d.token;
  const api = as(d);
  try {
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    // the endpoint is registered (its own key is the owner's, Mine); the Space AI key is then set on it in one checked step
    const ep = await api("usr_olivia", "providers.custom_add", { idempotencyKey: "sk-ep", name: "Stub Go", baseUrl: stub.base, apiKey: OWNER_KEY, scope: "mine" });
    assert.equal(ep.status, 200, JSON.stringify(ep.data));
    const refused = await api("usr_olivia", "providers.space_key.set", { idempotencyKey: "sk-bad", providerKey: ep.data.endpoint.key, apiKey: "not-the-key-000000000" });
    assert.equal(refused.data?.error?.code ?? refused.data?.code, "provider.auth_failed", `a key the provider refuses is not stored: ${refused.status} ${JSON.stringify(refused.data)}`);
    assert.equal((await api("usr_olivia", "providers.space_key.get", {})).data.set, false);
    const set = await api("usr_olivia", "providers.space_key.set", { idempotencyKey: "sk-set", providerKey: ep.data.endpoint.key, apiKey: SPACE_KEY });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.deepEqual([set.data.set, set.data.models, set.data.state], [true, ["glm-test", "kimi-test"], "ok"]);
    const agent = await api("usr_olivia", "agents.create", { name: "Spark", role: "You help the team.", idempotencyKey: "sk-agent" });
    assert.equal(agent.status, 200, JSON.stringify(agent.data));
    const agentId = agent.data.agent.agentId as string;
    await api("usr_olivia", "engine.pool.status", {});

    for (const who of MEMBERS) {
      // what the member sees: the provider, its models, no key and no way to it
      const accounts = (await api(who, "engine.accounts.list", {})).data.accounts as Array<{ ref: string; title: string; spaceKey?: boolean; mine: boolean }>;
      assert.deepEqual(accounts.map((a) => [a.title, a.spaceKey, a.mine]), [["Stub Go", true, false]], `${who} has no account of their own; the Space's is listed`);
      const handle = accounts[0]!.ref;
      const models = (await api(who, "engine.models.list", { accountRef: handle })).data.models as Array<{ model: string; allowed: boolean }>;
      assert.deepEqual(models.map((m) => [m.model, m.allowed]), [["glm-test", true], ["kimi-test", true]]);
      const use = await api(who, "vault.use", { item: handle });
      assert.ok([403, 404].includes(use.status), `${who} cannot use the key by name: ${use.status} ${JSON.stringify(use.data)}`);
      const listed = (await api(who, "vault.items.list", {})).data.items as Array<{ handle: string }>;
      assert.ok(!listed.some((i) => i.handle === handle), `${who} does not see the item`);

      // the member asks; the agent answers on the Space key
      const th = await api(who, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `sk-${who}-s` });
      assert.equal(th.status, 200, JSON.stringify(th.data));
      const threadId = th.data.thread.threadId as string;
      await api(who, "chat.post", { threadId, body: `hello from ${who.replace("usr_", "")}`, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `sk-${who}-p` });
      const reply = await waitFor(async () => {
        await d.hooks?.pump?.();
        const ms = (await api(who, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined;
        return ms?.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body ?? null;
      }, 40_000, () => hostLog(d));
      assert.equal(reply, `${who.replace("usr_", "")} on the space key`);
      assert.ok(!reply.includes(SPACE_KEY));
    }

    const completions = seen.filter((s) => s.url === "/v1/chat/completions");
    assert.equal(completions.length, MEMBERS.length, JSON.stringify(seen));
    assert.ok(completions.every((s) => s.auth === `Bearer ${SPACE_KEY}`), "every member turn went out on the Space key");
    assert.ok(completions.every((s) => s.model === "glm-test"), "a model the key serves");

    // usage is the member's, against the key's item (the owner, who manages AI spend, reads it by person)
    const keyRow = ((await api("usr_olivia", "providers.list", {})).data.providers as Array<{ itemId: string; spaceKey?: boolean }>).find((p) => p.spaceKey);
    assert.ok(keyRow);
    const usage = await waitFor(async () => {
      const u = (await api("usr_olivia", "engine.usage.query", { by: "person", itemId: keyRow.itemId })).data as { rows: Array<{ key: string; totals: { turns: number; tokensIn: number } }> };
      return u.rows.length === MEMBERS.length ? u : null;
    }, 20_000, () => hostLog(d));
    assert.deepEqual(usage.rows.map((r) => [r.key, r.totals.turns, r.totals.tokensIn]).sort(), MEMBERS.map((m) => [m, 1, 40]).sort());

    // glm-test runs out of usage: Mia's next turn still gets an answer (on the next model the key serves), and the picker shows glm-test greyed with when it comes back
    out.add("glm-test");
    const mia = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "sk-mia-out-s" })).data.thread.threadId as string;
    await api("usr_mia", "chat.post", { threadId: mia, body: "hello from mia again", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "sk-mia-out-p" });
    const again = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await api("usr_mia", "chat.messages.list", { threadId: mia })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined;
      return ms?.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body ?? null;
    }, 40_000, () => hostLog(d));
    assert.equal(again, "mia on the space key", "the turn did not fail cold");
    assert.deepEqual(seen.filter((x) => x.url === "/v1/chat/completions").slice(-2).map((x) => x.model), ["glm-test", "kimi-test"]);
    const handle = ((await api("usr_mia", "engine.accounts.list", {})).data.accounts as Array<{ ref: string }>)[0]!.ref;
    const greyed = ((await api("usr_mia", "engine.models.list", { accountRef: handle })).data.models as Array<{ model: string; allowed: boolean; reason?: string; resetsAt?: number }>).find((m) => m.model === "glm-test");
    assert.deepEqual([greyed?.allowed, greyed?.reason], [false, "usage_limit"]);
    assert.ok(greyed?.resetsAt !== undefined && greyed.resetsAt > Date.now() + 800_000, `comes back in about 15 minutes: ${JSON.stringify(greyed)}`);

    // removing it: the next member turn has nothing to run on and says so; nobody's own setup changed
    const gone = await api("usr_olivia", "providers.space_key.remove", {});
    assert.equal(gone.status, 200, JSON.stringify(gone.data));
    assert.deepEqual((await api("usr_mia", "engine.accounts.list", {})).data.accounts, []);

    const log = hostLog(d);
    assert.ok(!log.includes(SPACE_KEY), "not in the host log");
    d.sink.flush();
    assert.deepEqual(filesHolding(dir, SPACE_KEY), [], "not in any file of the data directory in the clear");
  } finally {
    await stop(d);
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
