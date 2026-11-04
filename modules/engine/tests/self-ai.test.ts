// engine.my_ai: the real values behind "what model are you, and what else can I use and how much is left?" (and /usage), from the account resolver and the turn records, never the model's own words.
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/engine.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { selfAi } from "../handlers/self-ai.ts";
import { usageText } from "../../../lib/usage-text.ts";
import { ensureExtra } from "../handlers/extra/schema.ts";
import { harness, NOW } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const CLAUDE = { ref: "#Claude_Code", driver: "claude_code", kind: "subscription", title: "Claude Code", name: "Claude Code (Max)", mine: true, status: "ok", usable: true };
const GO = { ref: "#OpenCode_Go", driver: "opencode_go", kind: "api_key", title: "OpenCode Go", name: "OpenCode Go", mine: false, status: "ok", usable: true, models: ["glm-5.3", "kimi-k3"] };
const LOCKED = { ref: "#Codex", driver: "codex", kind: "subscription", title: "Codex", name: "Codex", mine: true, status: "ok", usable: false, why: "Your Codex sign-in is locked on this server." };

test("the running account, every account with its models, usability and limits (read or plainly not readable), and the person's use with cached input apart", async () => {
  const h = harness();
  ensureExtra(h.db);
  h.db.run("CREATE TABLE IF NOT EXISTS engine_turn_info (turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, reply_message_id TEXT, info TEXT, cost TEXT, updated_at INTEGER NOT NULL)");
  h.db.run("INSERT INTO engine_usage (turn_id, thread_id, agent_id, person_id, model, at, tokens_in, tokens_out, cost_micros) VALUES ('trn_a', 'thr_1', 'agt_1', 'usr_irfad', 'claude-sonnet-5-5', ?, 1000000, 8300, 0)", NOW);
  h.db.run("INSERT INTO engine_turn_info (turn_id, thread_id, info, updated_at) VALUES ('trn_a', 'thr_1', ?, ?)", JSON.stringify({ tools: [], switches: [], cacheReadTokens: 940_000 }), NOW);
  const ctx = {
    ...h.ctx, now: () => NOW, principal: { kind: "person", id: "usr_irfad" },
    async call(cap: string, input: Record<string, unknown>) {
      if (cap === "engine.accounts.list") { assert.equal(input["place"], "chat"); return { accounts: [CLAUDE, GO, LOCKED] }; }
      if (cap === "engine.usage.get") {
        if (input["accountRef"] === "#Claude_Code") return { session: { pct: 41, resetsAt: NOW + 3_600_000 }, week: { pct: 12 } };
        if (input["accountRef"]) return { session: null, week: null };
        return { context: { used: 61_000, window: 200_000 }, lastTurn: { model: "claude-sonnet-5-5", account: { ref: "#Claude_Code", name: "Claude Code (Max)", provider: "anthropic" }, paid: "Claude Code (Max) · your sign-in" } };
      }
      if (cap === "engine.models.list") return { models: [{ model: "claude-sonnet-5-5", allowed: true }, { model: "claude-opus-5-5", allowed: true }] };
      throw new Error(cap);
    },
  } as unknown as EngineCtx;
  const out = await selfAi(ctx, { threadId: "thr_1", agentId: "agt_1" }) as { running: Record<string, unknown>; accounts: Array<Record<string, any>>; use: Record<string, Record<string, number>> };   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(validate(manifest.capabilities!.find((c) => c.name === "engine.my_ai")!.output, out, "", {}), []);
  assert.equal(out.running["model"], "claude-sonnet-5-5");
  assert.deepEqual(out.accounts.map((a) => [a["name"], a["usable"], a["models"], a["limits"].state]), [
    ["Claude Code (Max)", true, ["claude-sonnet-5-5", "claude-opus-5-5"], "read"], ["OpenCode Go", true, ["glm-5.3", "kimi-k3"], "not_readable"], ["Codex", false, [], "not_readable"],
  ]);
  assert.equal(out.accounts[1]!["limits"].note, "OpenCode Go does not report its quota.");
  assert.deepEqual(out.accounts[0]!["limits"].session, { pct: 41, resetsAt: NOW + 3_600_000 });
  assert.deepEqual(out.use["today"], { turns: 1, input: 60_000, cachedInput: 940_000, output: 8_300, costMicros: 0 });
  const text = usageText(out as never);
  assert.match(text, /^This chat: claude-sonnet-5-5 on Claude Code \(Max\) \(paid by Claude Code \(Max\) · your sign-in\), context 61k of 200k\./);
  assert.match(text, /Claude Code \(Max\): session 41% used, week 12% used\. Models: claude-sonnet-5-5, claude-opus-5-5/);
  assert.match(text, /OpenCode Go: limits not readable \(OpenCode Go does not report its quota\.\)/);
  assert.match(text, /Codex: cannot run here: Your Codex sign-in is locked on this server\./);
  assert.match(text, /Today: 1 turn, 60k new in, 940k cached, 8\.3k out/);
});
