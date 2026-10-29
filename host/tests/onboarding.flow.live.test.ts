// The owner's onboarding flowchart, walked on booted daemons (each its own process, as a person runs them): a Personal Space is claimed and gets its private assistant; AI is connected
// (a key into Mine; the scripted path needs none); the memory interview is saved; a Team Space is created and claimed; "use the same AI account" copies the one key only with a yes; a
// member is invited, joins on the web, gets their own assistant, sees only their own data and keeps their own progress. Every step is the same capability call the screen makes.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFreshSpace } from "../../apps/app/tests/real-app-harness.test.ts";
import type { Space } from "../../apps/app/tests/real-app-harness.test.ts";
import { copyAccount, copyableAccounts } from "../../apps/app/src/onboarding/same-account.ts";
import { saveInterview } from "../../apps/app/src/onboarding/interview.ts";
import { saveApiKey } from "../../apps/app/src/onboarding/connect-ai.ts";
import { loadFlow, markStep } from "../../apps/app/src/onboarding/store.ts";
import type { CapCall } from "../../apps/app/src/shell/session/caps.ts";

const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

type Json = { data?: any; error?: { code: string; message: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (d: Space, p: string, body: unknown, token?: string): Promise<{ status: number; json: Json }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Json };
};
/** The same shape the screen's CapCall has: a capability name and its input, as a signed-in person. */
const caller = (d: Space, token: string): CapCall => (async (cap: string, input: unknown) => {
  const r = await post(d, `/v1/${cap.replaceAll(".", "/")}`, input, token);
  if (r.status !== 200) throw Object.assign(new Error(r.json.error?.message ?? `${cap} ${r.status}`), { code: r.json.error?.code });
  return r.json.data;
}) as unknown as CapCall;

/** The person's client unlocks their key on their own computer's node, as the desktop app does after sign-in. */
async function unlock(d: Space, token: string): Promise<void> {
  const res = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(res.status, 204, `unlock ${res.status}`);
}

async function claim(d: Space, username: string, name: string): Promise<string> {
  const code = decodeURIComponent(new URL(d.claim!).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Mac", deviceClass: "desktop" };
  const claimed = await post(d, "/v1/identity/claim_owner", { code, spaceId: d.space, username, displayName: name, password: PASSWORD, ...device, keys: KEYS });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  const signedIn = await post(d, "/v1/identity/sign_in", { username, password: PASSWORD, ...device });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  return signedIn.json.data.session.token as string;
}

/** The person's private assistants as the Console finds them: their own personal agent with the assistant role. */
const assistantsOf = async (call: CapCall): Promise<{ agentId: string; ownerId: string }[]> => {
  const out = (await call("agents.list", { section: "personal", limit: 100 })) as { agents: { agentId: string; ownerId: string; role?: string }[] };
  return out.agents.filter((a) => a.role === "assistant");
};
const untilAssistant = async (call: CapCall, who: string): Promise<{ agentId: string; ownerId: string }> => {
  const end = Date.now() + 15_000;
  for (;;) {
    const mine = (await assistantsOf(call)).filter((a) => a.ownerId === who);
    if (mine[0]) return mine[0];
    assert.ok(Date.now() < end, "the assistant exists by the time the person's account does");
    await new Promise((r) => setTimeout(r, 150));
  }
};
const whoami = async (call: CapCall): Promise<string> => ((await call("identity.whoami", {})) as { principal: { id: string } }).principal.id;

test("a Personal Space is claimed and gets its assistant; progress, AI, the memory interview", async () => {
  const d = await bootFreshSpace("personal");
  try {
    const token = await claim(d, "dana", "Dana Reyes");
    await unlock(d, token);
    const call = caller(d, token);
    const me = await whoami(call);
    await untilAssistant(call, me);   // before any AI account exists

    // the screen opens on a fresh person: nothing done, not yet seen
    assert.deepEqual(await loadFlow(call, "personal"), { seen: false, progress: {} });
    await call("spaces.onboarding.seen", { flow: "personal" });
    assert.equal((await loadFlow(call, "personal")).seen, true);

    // scripted path: skipping the AI step is allowed, and the steps after it still work
    await markStep(call, "personal", "ai", "later");
    assert.equal(await saveInterview(call, { work: "runs operations" }, "live-int-0"), 1, "the interview needs no AI account");
    await markStep(call, "personal", "interview", "done");

    // connect AI: a key goes into the person's Mine folder through providers.add
    const providerId = await saveApiKey(call, "anthropic", "sk-ant-live-test-0001", "live-ai-1");
    assert.match(providerId, /^prv_/);
    await markStep(call, "personal", "ai", "done");
    const accounts = await copyableAccounts(call);
    assert.deepEqual(accounts.map((a) => a.providerKey), ["anthropic"]);

    // the rest of the interview lands in the person's own memory
    assert.equal(await saveInterview(call, { work: "runs operations", tools: "Gmail, Sheets", style: "short" }, "live-int-1"), 3);
    const facts = (await call("memory.facts.list", { layer: "person" })) as { facts: { text: string; status: string }[] };
    assert.ok(facts.facts.some((f) => f.text === "Works as: runs operations" && f.status === "current"), JSON.stringify(facts));
    assert.deepEqual((await loadFlow(call, "personal")).progress, { ai: "done", interview: "done" });
  } finally { await d.stop(); }
});

test("a Team Space: the same AI account is copied only with a yes; a member joins on the web with their own assistant, data and progress", async () => {
  const personal = await bootFreshSpace("personal");
  const team = await bootFreshSpace();
  try {
    // the founder: Personal first (an AI key in Mine), then the Team Space
    const pTok = await claim(personal, "dana", "Dana Reyes");
    await unlock(personal, pTok);
    const pCall = caller(personal, pTok);
    await saveApiKey(pCall, "anthropic", "sk-ant-live-test-0002", "live-p2-ai");
    const tTok = await claim(team, "dana", "Dana Reyes");
    await unlock(team, tTok);
    const tCall = caller(team, tTok);
    const owner = await whoami(tCall);
    await untilAssistant(tCall, owner);
    assert.deepEqual(await loadFlow(tCall, "team"), { seen: false, progress: {} });

    // Q4: nothing is copied by itself. The offer only reads the Personal side; the team side stays empty until a yes.
    const offered = await copyableAccounts(pCall);
    assert.equal(offered.length, 1);
    assert.equal(((await tCall("providers.list", {})) as { providers: unknown[] }).providers.length, 0, "without a yes the Team Space holds no AI account");
    const copied = await copyAccount(pCall, tCall, offered[0]!, "live-q4");
    assert.match(copied, /^prv_/);
    const after = (await tCall("providers.list", {})) as { providers: { scope: string; providerKey: string }[] };
    assert.deepEqual(after.providers.map((p) => [p.scope, p.providerKey]), [["mine", "anthropic"]], "one key, in the owner's private Mine, never shared");
    assert.equal(((await pCall("providers.list", {})) as { providers: unknown[] }).providers.length, 1, "the Personal Space keeps its own");

    // Kits: the pick lists what the Space can install and shows the sheet first
    const kits = (await tCall("kits.list", { limit: 50 })) as { kits: { kitId: string }[] };
    if (kits.kits[0]) assert.ok(((await tCall("kits.install_sheet", { kitId: kits.kits[0].kitId })) as { sheet: unknown }).sheet);

    // a member is invited, opens the link on the web (no desktop app) and joins
    const roles = ((await tCall("access.roles.list", {})) as { roles: { id: string; name: string }[] }).roles;
    const invite = (await tCall("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id, idempotencyKey: "live-invite" })) as { link: string };
    const code = /\/join\/([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(invite.link)?.[1];
    assert.ok(code, invite.link);
    assert.equal((await post(team, "/v1/members/invites/preview", { code })).status, 200);
    const joined = await post(team, "/v1/members/accept", { code, username: "omar", displayName: "Omar Haddad", password: PASSWORD, deviceName: "Web browser", deviceClass: "web", keys: KEYS });
    assert.equal(joined.status, 200, JSON.stringify(joined.json));
    const mCall = caller(team, joined.json.data.token as string);
    const member = await whoami(mCall);
    assert.notEqual(member, owner);
    const theirs = await untilAssistant(mCall, member);
    assert.equal(theirs.ownerId, member, "the member's assistant is their own");

    // the owner's assistant is private to the owner: another member cannot see it, @mention it or open a chat with it
    const ownerAssistant = await untilAssistant(tCall, owner);
    for (const section of ["personal", "shared", "space"]) {
      const seen = ((await mCall("agents.list", { section, limit: 100 })) as { agents: { agentId: string }[] }).agents;
      assert.ok(!seen.some((a) => a.agentId === ownerAssistant.agentId), `the owner's assistant is not in the member's ${section} list`);
    }
    await assert.rejects(() => mCall("agents.get", { agentId: ownerAssistant.agentId }), (e: { code?: string }) => e.code === "validation.not_found");
    await assert.rejects(() => mCall("chat.start", { kind: "chat", agentIds: [ownerAssistant.agentId], idempotencyKey: "live-m-chat-owner" }), "the member cannot open a chat with the owner's assistant");
    const own = await mCall("chat.start", { kind: "chat", agentIds: [theirs.agentId], idempotencyKey: "live-m-chat-own" }) as { threadId: string };
    await assert.rejects(() => mCall("chat.post", { threadId: own.threadId, body: "hello", mentions: [{ kind: "agent", id: ownerAssistant.agentId }], idempotencyKey: "live-m-mention" }), "the member cannot @mention the owner's assistant");

    // the Console assistant finds the owner's own assistant by its role, so the old "connect an AI account first" error is gone for the right reason
    const opened = await tCall("console.assistant_open", { page: "console.home", idempotencyKey: "live-console" }).then(() => "opened", (e: Error) => e.message);
    assert.ok(!/not set up yet|Connect an AI account first/i.test(opened), opened);

    // a member sees only their own AI accounts; the owner's key is not theirs
    assert.equal(((await mCall("providers.list", {})) as { providers: unknown[] }).providers.length, 0, "the owner's Mine key is not visible to a member");
    // the member's own onboarding has its own flow and progress
    assert.deepEqual(await loadFlow(mCall, "member"), { seen: false, progress: {} });
    await markStep(mCall, "member", "apps", "later");
    assert.deepEqual((await loadFlow(mCall, "member")).progress, { apps: "later" });
    assert.deepEqual(await loadFlow(tCall, "member"), { seen: false, progress: {} }, "the owner's progress is separate");
    // a browser-only member's Mine Vault is locked until they unlock it on their own computer; the card says so in plain words
    const locked = await saveApiKey(mCall, "openai", "sk-live-member-0001", "live-m-ai").then(() => "saved", (e: Error) => e.message);
    assert.match(locked, /locked/);
  } finally { await personal.stop(); await team.stop(); }
});
