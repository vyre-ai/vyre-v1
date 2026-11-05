// A member's own sign-in the server does not hold (locked-account.ts): when the person picked a model only that sign-in serves, the turn says so in one plain line and runs nothing else. A turn nobody picked a
// model for still answers on the next account, with the chat's line.
import test from "node:test";
import assert from "node:assert/strict";
import { lockedWords, skipLocked } from "../locked-account.ts";
import type { AccountQuery, ResolvedAccount } from "../../../agent/src/turn-engine/types.ts";

const CLAUDE: ResolvedAccount = { ref: "#Claude_Code", driver: "claude_code", provider: "anthropic", kind: "subscription", payer: "usr_dana", reason: "starter" };
const TEAM: ResolvedAccount = { ref: "#Team", driver: "opencode_go", provider: "opencode_go", kind: "api_key", payer: "usr_dana", reason: "starter", shared: true, spaceKey: true };
const q: AccountQuery = { threadId: "thr_1", agentId: "agt_1", askerId: "usr_dana" };

test("the picked model needs the locked sign-in and nothing else serves it: one plain line, no other model", async () => {
  const resolve = async (x: AccountQuery): Promise<ResolvedAccount | null> => {
    if (!x.unavailable?.includes("#Claude_Code")) return CLAUDE;
    throw Object.assign(new Error("Claude Sonnet 5.5 cannot run here: ..."), { code: "engine.model_unavailable" });
  };
  const wrapped = skipLocked({ resolve, held: () => false });
  await assert.rejects(wrapped(q), (e: { code?: string; message?: string }) => e.code === "engine.model_unavailable" && e.message === "Your Claude Code sign-in is locked on this server. Unlock Vyre on your device, or pick another model.");
  assert.equal(lockedWords({ driver: "codex" }), "Your Codex sign-in is locked on this server. Unlock Vyre on your device, or pick another model.");
});

test("an unlocked sign-in answers, and with nothing picked the Space's account answers with the line", async () => {
  const posts: string[] = [];
  const open = skipLocked({ resolve: async () => CLAUDE, held: () => true });
  assert.equal((await open(q))?.ref, "#Claude_Code");
  const wrapped = skipLocked({ resolve: async (x) => (x.unavailable?.includes("#Claude_Code") ? TEAM : CLAUDE), held: () => false, postAs: async (_a, post) => { { const d = ((post as { blocks: Array<{ data: { text: string; state: string } }> }).blocks)[0]!.data; assert.equal(d.state, "key_locked", "the line carries Unlock in the chat"); posts.push(String(d.text)); } return {}; } });
  assert.equal((await wrapped(q))?.ref, "#Team");
  assert.deepEqual(posts, ["Your sign-ins are locked on this server, so the Space AI key answered."]);
});

test("a turn that runs on the person's own computer keeps their sign-in even though the server does not hold the key", async () => {
  const wrapped = skipLocked({ resolve: async (x) => (x.unavailable?.includes("#Claude_Code") ? TEAM : CLAUDE), held: () => false, onDevice: async () => true });
  assert.equal((await wrapped(q))?.ref, "#Claude_Code", "their Mac holds the sign-in: the turn goes there, not to the Space's key");
  const server = skipLocked({ resolve: async (x) => (x.unavailable?.includes("#Claude_Code") ? TEAM : CLAUDE), held: () => false, onDevice: async () => false });
  assert.equal((await server(q))?.ref, "#Team", "on the server the key is not there, so the next account answers");
});
