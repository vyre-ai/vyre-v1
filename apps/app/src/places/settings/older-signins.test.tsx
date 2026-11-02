// One entry per account in the composer and in Settings, AI: an account reads by its name ("Claude Code, dana@...", or the provider alone), never "Claude Code 4"; a chat pinned to a handle folded into an
// account, or to an older sign-in listed under it, shows that account; and older sign-ins sit under it as one quiet line.
import test from "node:test";
import assert from "node:assert/strict";
import { olderLine } from "./pages-a.tsx";
import { connectedAccounts, entryOf, stripAgents } from "../chats/conversation/brain.tsx";

const ROWS = [
  { ref: "#Claude_Code_3", driver: "claude_code", kind: "subscription", title: "Claude Code", name: "Claude Code", status: "ok", aliases: ["#Claude_Code", "#Claude_Code_2", "#Claude_Code_4"] },
  { ref: "#Codex", driver: "codex", kind: "subscription", title: "Codex", name: "Codex, dana@example.com", status: "ok", aliases: ["#Codex_2"] },
];

test("the composer offers one entry per account, by its name, and a pin to a folded or older handle shows that entry", () => {
  const accounts = connectedAccounts(ROWS);
  assert.deepEqual(accounts.map((a) => [a.ref, a.name]), [["#Claude_Code_3", "Claude Code"], ["#Codex", "Codex, dana@example.com"]]);
  assert.equal(entryOf(accounts, "#Claude_Code_4")?.ref, "#Claude_Code_3");
  assert.equal(entryOf(accounts, "#Codex_2")?.ref, "#Codex");
  assert.equal(entryOf(accounts, "#Codex")?.ref, "#Codex");
  assert.equal(entryOf(accounts, "#Nope"), undefined);
  assert.equal(entryOf(accounts, null), undefined);
});

test("the strip names the account a chat is pinned to, through a folded handle, and only when two of one provider are connected", () => {
  const accounts = connectedAccounts([...ROWS, { ref: "#Claude_Work", driver: "claude_code", kind: "subscription", title: "Claude Code", name: "Claude Code, Work Org", status: "ok" }]);
  const thread = { agents: [{ agentId: "agt_1", accountRef: "#Claude_Code_4", provider: "claude_code" }] } as unknown as Parameters<typeof stripAgents>[0];
  const [agent] = stripAgents(thread, () => "Agent", accounts, new Map());
  assert.equal((agent as { accountName?: string }).accountName, "Claude Code");
});

test("older sign-ins read as one quiet line", () => {
  assert.equal(olderLine(0), null);
  assert.equal(olderLine(1), "and 1 older sign-in");
  assert.equal(olderLine(3), "and 3 older sign-ins");
});
