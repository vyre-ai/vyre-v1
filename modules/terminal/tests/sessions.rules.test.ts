// Rules (spec 2.7, 2.14): a person's allow, ask and deny entries and the folders their terminal is locked to. Deny is a wall the module enforces itself; ask and allow are read by the local
// prompt through judge(). Matching is per simple command, so one allowed word cannot carry a forbidden one behind it.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { bindHost, entryMatches, judge, rulesOf, segmentsOf } from "../projections.ts";
import { assertEventsConform, codeOf, contractErrors, fakeHost, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>;
const call = async (hn: Harness, cap: string, input: unknown, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};
const rejects = async (f: () => unknown): Promise<string> => { try { await f(); } catch (e) { return codeOf(e); } return "no error"; };
const rules = (r: Partial<{ allow: string[]; ask: string[]; deny: string[]; folders: string[] }>) => ({ allow: [], ask: [], deny: [], folders: [], ...r });

test("an entry matches a command exactly, as a whole-word prefix, or as a * pattern over the whole command", () => {
  assert.equal(entryMatches("npm test", "npm test"), true);
  assert.equal(entryMatches("npm test", "npm test --watch"), true);
  assert.equal(entryMatches("npm test", "npm testing"), false, "a prefix ends on a word");
  assert.equal(entryMatches("npm", "npm install left-pad"), true);
  assert.equal(entryMatches("git push *", "git push origin main"), true);
  assert.equal(entryMatches("git push *", "git status"), false);
  assert.equal(entryMatches("*.sh", "deploy.sh"), true);
  assert.equal(entryMatches("rm -rf /", "rm -rf /"), true);
  assert.equal(entryMatches("a.b", "aXb"), false, "dots are dots, not wildcards");
  assert.equal(entryMatches("", "ls"), false);
  assert.equal(entryMatches("ls", "  "), false);
  assert.equal(entryMatches("  ls  ", "ls -la"), true, "entries are trimmed");
});

test("a command line is judged part by part: pipes, lists, && and newlines cannot smuggle one command behind another", () => {
  assert.deepEqual(segmentsOf("ls -la | grep x && rm -rf build; echo done\nwhoami"), ["ls -la", "grep x", "rm -rf build", "echo done", "whoami"]);
  assert.deepEqual(segmentsOf("  "), []);
  const r = rules({ allow: ["ls", "grep", "echo"], deny: ["rm -rf *"] });
  assert.deepEqual(judge(r, "ls -la | grep x"), { verdict: "allow" });
  assert.deepEqual(judge(r, "ls && rm -rf /"), { verdict: "deny", entry: "rm -rf *" });
  assert.deepEqual(judge(r, "ls && whoami"), { verdict: "none" }, "one part is not covered, so the line is not allowed");
  assert.deepEqual(judge(r, ""), { verdict: "none" });
});

test("deny beats ask, ask beats allow, and an entry on several lists keeps its strictest", () => {
  const r = rules({ allow: ["git"], ask: ["git push"], deny: ["git push --force"] });
  assert.deepEqual(judge(r, "git status"), { verdict: "allow" });
  assert.deepEqual(judge(r, "git push origin main"), { verdict: "ask", entry: "git push" });
  assert.deepEqual(judge(r, "git push --force origin main"), { verdict: "deny", entry: "git push --force" });
  assert.deepEqual(judge(r, "git status && git push --force"), { verdict: "deny", entry: "git push --force" });
});

test("rules.get and rules.set: per person, tidied, with the stricter list winning an overlap, and an event that names only the person", async () => {
  reset();
  const hn = harness();
  assert.deepEqual((await call(hn, "terminal.rules.get", {})).rules, rules({}));
  const set = await call(hn, "terminal.rules.set", { rules: rules({ allow: ["ls", " ls ", "npm test", "rm -rf build"], ask: ["npm publish", "rm -rf build"], deny: ["rm -rf /", "npm publish", ""], folders: ["fld_work", "fld_work"] }) });
  assert.deepEqual(set.rules, { allow: ["ls", "npm test"], ask: ["rm -rf build"], deny: ["rm -rf /", "npm publish"], folders: ["fld_work"] }, "blank and repeated entries go, and an entry on a stricter list leaves the weaker one");
  assert.deepEqual((await call(hn, "terminal.rules.get", {})).rules, set.rules, "what was saved is what is read");
  assert.deepEqual(hn.named("terminal.rules_changed").map((e) => e.payload), [{ personId: "usr_dana" }]);
  assert.deepEqual(assertEventsConform(hn), []);
  // Another person starts clean and is not touched.
  const ravi = hn.as({ kind: "person", id: "usr_ravi" });
  assert.deepEqual((await call(hn, "terminal.rules.get", {}, ravi)).rules, rules({}));
  await call(hn, "terminal.rules.set", { rules: rules({ allow: ["make"] }) }, ravi);
  assert.deepEqual(rulesOf(hn.db, "usr_dana").allow, ["ls", "npm test"]);
  // An agent acting for Dana changes Dana's rules, not its own.
  const agent = hn.as({ kind: "agent", id: "agt_intake" }, "usr_dana");
  await call(hn, "terminal.rules.set", { rules: rules({ allow: ["pwd"] }) }, agent);
  assert.deepEqual(rulesOf(hn.db, "usr_dana").allow, ["pwd"]);
  assert.deepEqual(rulesOf(hn.db, "agt_intake").allow, []);
});

test("rules.set refuses an entry that is too long or more than 200 rules in all", async () => {
  reset();
  const hn = harness();
  assert.equal(await rejects(() => h["terminal.rules.set"]!(hn.ctx, { rules: rules({ allow: ["x".repeat(201)] }) })), "validation.bad_input");
  const many = Array.from({ length: 201 }, (_, i) => `cmd${i}`);
  assert.equal(await rejects(() => h["terminal.rules.set"]!(hn.ctx, { rules: rules({ allow: many }) })), "validation.bad_input");
  const ok = Array.from({ length: 200 }, (_, i) => `cmd${i}`);
  assert.equal((await call(hn, "terminal.rules.set", { rules: rules({ allow: ok }) })).rules.allow.length, 200);
});

test("a deny rule stops a command in the module itself, whoever sends it; allow and ask entries do not stop it here", async () => {
  reset();
  const hn = harness();
  const host = fakeHost({ "rm -rf build": { exitCode: 0, output: "" }, "npm publish": { exitCode: 0, output: "published" }, ls: { exitCode: 0, output: "a" } });
  bindHost(host.host);
  await call(hn, "terminal.rules.set", { rules: rules({ deny: ["rm -rf *"], ask: ["npm publish"], allow: ["ls"] }) });
  const t = (await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: "i1" })).terminal;
  const agent = hn.as({ kind: "agent", id: "agt_intake" }, "usr_dana");
  assert.equal(await rejects(() => h["terminal.run"]!(agent, { command: "rm -rf build", terminalId: t.terminalId })), "permission.role_lacks_permission");
  assert.equal(await rejects(() => h["terminal.run"]!(agent, { command: "ls && rm -rf build", terminalId: t.terminalId })), "permission.role_lacks_permission");
  assert.equal(await rejects(() => h["terminal.run"]!(hn.ctx, { command: "rm -rf build", terminalId: t.terminalId })), "permission.role_lacks_permission", "a person's own API call too");
  assert.equal(host.count("run"), 0);
  assert.equal(hn.rows("SELECT * FROM terminal_commands").length, 0);
  assert.equal((await call(hn, "terminal.run", { command: "npm publish", terminalId: t.terminalId, idempotencyKey: "i2" }, agent)).output, "published");
  assert.equal((await call(hn, "terminal.run", { command: "ls", terminalId: t.terminalId, idempotencyKey: "i3" }, agent)).output, "a");
  // The wall is the acting person's: another person's session is not bound by Dana's rules.
  const ravi = hn.as({ kind: "person", id: "usr_ravi" });
  assert.equal((await call(hn, "terminal.run", { command: "rm -rf build", terminalId: t.terminalId, idempotencyKey: "i4" }, ravi)).exitCode, 0);
});
