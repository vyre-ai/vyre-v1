// One list: the composer, the automation "Runs on" and the agent's AI accounts all read engine.accounts.list with a place, so an account that is Working in the Vault is offered everywhere it is allowed,
// and one that cannot run in a place carries the reason. The same answer is read by each reader; what differs is only what the place allows.
import test from "node:test";
import assert from "node:assert/strict";
import { connectedAccounts } from "../../places/chats/conversation/brain.tsx";
import { keysFromAccounts } from "../../places/automations/values/typed.ts";

const rows = (place: "chat" | "automation") => [
  { ref: "#Mine_Claude", providerId: "prv_m", driver: "claude_code", kind: "subscription", title: "Claude Code", name: "My Claude", mine: true, status: "ok", usable: place === "chat", ...(place === "chat" ? {} : { why: 'Turn on "Let the Space run work on my subscription" for this account to use it here.' }) },
  { ref: "#Team_Key", providerId: "prv_t", driver: "anthropic", kind: "api_key", title: "Anthropic", name: "Team key", mine: false, status: "ok", usable: true },
  { ref: "#Chat_Only", providerId: "prv_c", driver: "openrouter", kind: "api_key", title: "OpenRouter", name: "Chat only", mine: false, status: "ok", usable: place === "chat", ...(place === "chat" ? {} : { why: "An admin has not kept this account for this kind of work." }) },
  { ref: "#Old", providerId: "prv_o", driver: "codex", kind: "subscription", title: "Codex", mine: true, status: "expired", usable: false, why: "Sign in to this account again." },
];

test("the composer and the automation picker list the same accounts; each place says which it can run and why not", () => {
  const chat = rows("chat"), auto = rows("automation");
  const composer = connectedAccounts(chat).map((a) => a.ref);
  const runsOn = keysFromAccounts({ accounts: auto })!;
  // every account is in the automation picker, whether it can run there or not
  assert.deepEqual(runsOn.map((k) => k.id), chat.map((r) => r.providerId));
  // the composer offers what can run a chat; the picker marks what cannot run an automation, with the reason
  assert.deepEqual(composer, ["#Mine_Claude", "#Team_Key", "#Chat_Only"]);
  assert.deepEqual(runsOn.filter((k) => k.usable === false).map((k) => k.id), ["prv_m", "prv_c", "prv_o"]);
  assert.match(runsOn.find((k) => k.id === "prv_m")!.why!, /Let the Space run work on my subscription/);
  assert.match(runsOn.find((k) => k.id === "prv_c")!.why!, /not kept this account for this kind of work/);
  assert.match(runsOn.find((k) => k.id === "prv_o")!.why!, /Sign in/);
  // an account that works everywhere is offered by both
  assert.ok(composer.includes("#Team_Key") && runsOn.find((k) => k.id === "prv_t")!.usable === true);
});
