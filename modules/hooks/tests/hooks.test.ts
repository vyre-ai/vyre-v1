// Hooks: scope order, who may set what, how a block, a note, a timeout and an error each end, persistence across turns, helpers, plugins and the quiet lines.
import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN, MAYA, admin, agent, maya, ok, world } from "../fixtures/world.ts";
import { parseCheck, redact } from "../../../lib/hooks.ts";

const stop = { code: 2, stdout: "", stderr: "Not on a Friday.", timedOut: false };

test("scope order: Space, person, agent, chat, run; an admin's block ends the run of hooks and wins", async () => {
  const w = world();
  const c = (scope: string, who = maya, extra: Record<string, unknown> = {}) => w.call("hooks.set", { scope, event: "tool.before", kind: "command", command: `c-${scope}`, ...extra }, who);
  await c("run", agent(), { threadId: "thr_a" });
  await c("chat", agent(), { threadId: "thr_a" });
  await c("agent", agent());
  await c("person", maya);
  await c("space", admin);
  await w.fire({ event: "tool.before", tool: "mail_send" });
  assert.deepEqual(w.s.ran, ["command:c-space", "command:c-person", "command:c-agent", "command:c-chat", "command:c-run"]);
  w.s.ran.length = 0;
  w.s.command = async (cmd) => (cmd === "c-space" ? { code: 2, stdout: "", stderr: "Client mail needs a second look.", timedOut: false } : ok);
  const v = await w.fire({ event: "tool.before", tool: "mail_send" });
  assert.deepEqual(w.s.ran, ["command:c-space"], "nothing after an admin's block runs");
  assert.equal(v.block.reason, "Client mail needs a second look.");
  assert.equal(v.block.scope, "space");
});

test("an agent cannot loosen a rule: no Space or person hooks, only itself, nothing that approves, and no change to a hook that is not its own", async () => {
  const w = world();
  const base = { event: "tool.before", kind: "check", instruction: "be careful" };
  await assert.rejects(w.call("hooks.set", { ...base, scope: "space" }, agent()), /Space and person hooks are a person's/);
  await assert.rejects(w.call("hooks.set", { ...base, scope: "person" }, agent()), /person's/);
  await assert.rejects(w.call("hooks.set", { ...base, scope: "agent", agentId: "agt_other" }, agent()), /itself only/);
  for (const cap of ["gate.approve", "hooks.set", "access.grant", "settings.set", "tasks.approve"]) {
    await assert.rejects(w.call("hooks.set", { scope: "agent", event: "tool.after", kind: "action", cap }, agent()), /cannot approve|may not/, cap);
  }
  const spaceHook = (await w.call("hooks.set", { ...base, scope: "space", kind: "command", command: "guard" }, admin)).hook;
  await assert.rejects(w.call("hooks.remove", { id: spaceHook.id }, agent()), /only the hooks it made/);
  await assert.rejects(w.call("hooks.pause", { id: spaceHook.id, paused: true }, agent()), /only the hooks it made/);
  await assert.rejects(w.call("hooks.set", { ...base, scope: "space" }, maya), /Space admin/);
  // a check that says allow cannot undo an admin's block: allow is not an answer that approves
  w.s.command = async () => stop;
  w.s.check = async () => ({ decision: "allow" });
  await w.call("hooks.set", { ...base, scope: "agent" }, agent());
  const v = await w.fire({ event: "tool.before", tool: "mail_send" });
  assert.equal(v.block.scope, "space");
});

test("an admin can turn agent-made hooks off for the Space: they stop running and none can be added", async () => {
  const w = world();
  await w.call("hooks.set", { scope: "agent", event: "prompt.submit", kind: "check", instruction: "No jokes" }, agent());
  w.s.check = async () => ({ decision: "block", reason: "A joke" });
  assert.ok((await w.fire({ event: "prompt.submit", prompt: "x" })).block);
  await assert.rejects(w.call("hooks.policy.set", { agentHooks: false }, maya), /admin/);
  await w.call("hooks.policy.set", { agentHooks: false }, admin);
  assert.equal((await w.fire({ event: "prompt.submit", prompt: "x" })).block, null);
  await assert.rejects(w.call("hooks.set", { scope: "agent", event: "prompt.submit", kind: "check", instruction: "x" }, agent()), /turned off hooks made by agents/);
  assert.equal((await w.call("hooks.list", {}, maya)).agentHooks, false);
  // a person's own hook still runs
  w.s.command = async () => stop;
  await w.call("hooks.set", { scope: "person", event: "prompt.submit", kind: "command", command: "mine" }, maya);
  assert.ok((await w.fire({ event: "prompt.submit", prompt: "x" })).block);
});

test("every hook carries who made it", async () => {
  const w = world();
  await w.call("hooks.set", { scope: "space", event: "turn.end", kind: "command", command: "a" }, admin);
  await w.call("hooks.set", { scope: "chat", event: "turn.end", kind: "check", instruction: "b", threadId: "thr_a" }, agent());
  await w.call("hooks.set", { scope: "person", event: "turn.end", kind: "command", command: "c" }, maya);
  const { hooks } = await w.call("hooks.list", { threadId: "thr_a" }, maya);
  const by = Object.fromEntries(hooks.map((h: { scope: string; madeBy: string; madeByKind: string }) => [h.scope, [h.madeBy, h.madeByKind]]));
  assert.deepEqual(by, { space: [ADMIN, "admin"], chat: ["agt_intake", "agent"], person: [MAYA, "person"] });
});

test("a persistent chat hook fires in a later turn, and not in another chat", async () => {
  const w = world();
  await w.call("hooks.set", { scope: "chat", event: "outward.before", kind: "check", instruction: "check the address is in Contacts", threadId: "thr_a", summary: "before any email, check the address is in Contacts" }, agent());
  w.s.check = async () => ({ decision: "block", reason: "That address is not in Contacts" });
  for (const turnId of ["t1", "t2"]) {
    const v = await w.fire({ event: "outward.before", tool: "mail_send", cap: "mail.send", turnId });
    assert.equal(v.block.reason, "That address is not in Contacts", turnId);
  }
  assert.equal((await w.fire({ event: "outward.before", tool: "mail_send", threadId: "thr_b" })).block, null);
  assert.equal((await w.fire({ event: "outward.before", tool: "mail_send", agentId: "agt_other" })).block, null, "an agent's own hook is its own");
});

test("a check hook's block reason is what the model is told, and a note comes back as a note", async () => {
  const w = world();
  await w.call("hooks.set", { scope: "agent", event: "tool.before", matcher: "mail", kind: "check", instruction: "address in Contacts?" }, agent());
  w.s.check = async () => ({ decision: "block", reason: "Maya's address is not in Contacts" });
  const v = await w.fire({ event: "tool.before", tool: "mail_send", cap: "mail.send" });
  assert.equal(v.block.reason, "Maya's address is not in Contacts");
  w.s.check = async () => ({ decision: "note", note: "Use her work address" });
  const n = await w.fire({ event: "tool.before", tool: "mail_send", cap: "mail.send" });
  assert.deepEqual([n.block, n.notes], [null, ["Use her work address"]]);
  assert.equal((await w.fire({ event: "tool.before", tool: "files_read", cap: "files.read" })).ran, 0, "the matcher is the family of the capability");
  assert.deepEqual(parseCheck("BLOCK: no"), { decision: "block", reason: "no" });
  assert.deepEqual(parseCheck("Sure, whatever"), { decision: "allow" });
});

test("a hook that errors or runs out of time never blocks; it is logged and shown in the chat once", async () => {
  const w = world();
  const a = (await w.call("hooks.set", { scope: "person", event: "tool.before", kind: "command", command: "slow" }, maya)).hook;
  w.s.command = async () => ({ code: null, stdout: "", stderr: "", timedOut: true });
  assert.equal((await w.fire({ event: "tool.before", tool: "x" })).block, null);
  w.s.command = async () => { throw new Error("no sandbox"); };
  assert.equal((await w.fire({ event: "tool.before", tool: "x" })).block, null);
  w.s.command = async () => ({ code: 1, stdout: "", stderr: "boom", timedOut: false });
  assert.equal((await w.fire({ event: "tool.before", tool: "x" })).block, null);
  const { runs } = await w.call("hooks.runs.list", { hookId: a.id }, maya);
  assert.deepEqual(runs.map((r: { outcome: string }) => r.outcome).reverse(), ["timeout", "error", "error"]);
  assert.equal(w.s.lines.filter((l) => l["kind"] === "failed").length, 1, "one line, not one per failure");
});

test("a check that hangs ends at its timeout and does not block", async () => {
  const w = world();
  await w.call("hooks.set", { scope: "person", event: "prompt.submit", kind: "check", instruction: "slow", timeoutSec: 1 }, maya);
  w.s.check = () => new Promise(() => undefined);
  const t0 = Date.now();
  const v = await w.fire({ event: "prompt.submit", prompt: "hi" });
  assert.equal(v.block, null);
  assert.ok(Date.now() - t0 < 6000);
});

test("a block leaves an event and a quiet line in the chat; no secret rides in the reason", async () => {
  const w = world();
  await w.call("hooks.set", { scope: "person", event: "prompt.submit", kind: "command", command: "g" }, maya);
  w.s.command = async () => ({ code: 2, stdout: "", stderr: "Do not send sk-live_abcdefghijklmnop1234 anywhere", timedOut: false });
  const v = await w.fire({ event: "prompt.submit", prompt: "x" });
  assert.ok(!v.block.reason.includes("sk-live"));
  assert.match(v.block.reason, /\[hidden\]/);
  assert.ok(w.s.events.some((e) => e.name === "hook.blocked"));
  const line = w.s.lines.find((l) => l["kind"] === "blocked")!;
  assert.match(String(line["body"]), /^A hook stopped this: /);
  assert.equal(redact("password: hunter2hunter2"), "password: [hidden]");
});

test("adding, changing and removing a hook says so in the chat, in plain words, and fires hook.changed", async () => {
  const w = world();
  const h = (await w.call("hooks.set", { scope: "chat", event: "outward.before", kind: "check", instruction: "address in Contacts", threadId: "thr_a", summary: "before any email, check the address is in Contacts" }, agent())).hook;
  assert.equal(w.s.lines[0]!["body"], "Assistant added a hook in this chat: before any email, check the address is in Contacts");
  await w.call("hooks.set", { id: h.id, scope: "chat", event: "outward.before", kind: "check", instruction: "address in Contacts or Leads", threadId: "thr_a", summary: "before any email, check the address is known" }, agent());
  await w.call("hooks.pause", { id: h.id, paused: true, threadId: "thr_a" }, agent());
  assert.equal((await w.fire({ event: "outward.before", tool: "x" })).ran, 0, "paused");
  await w.call("hooks.remove", { id: h.id, threadId: "thr_a" }, agent());
  assert.deepEqual(w.s.lines.map((l) => l["kind"]), ["added", "changed", "paused", "removed"]);
  assert.deepEqual(w.s.events.filter((e) => e.name === "hook.changed").map((e) => e.payload["change"]), ["added", "changed", "paused", "removed"]);
});

test("helpers: they inherit the run's hooks, get the extra ones their parent gave them, and the hooks end with the last helper", async () => {
  const w = world();
  w.helperStarted("thr_h1", "thr_a");
  await w.call("hooks.set", { scope: "run", event: "tool.before", kind: "command", command: "run-all", threadId: "thr_a" }, agent());
  await w.call("hooks.set", { scope: "run", event: "tool.before", kind: "command", command: "own-only", threadId: "thr_a", helpers: false }, agent());
  await w.call("hooks.set", { scope: "run", event: "tool.before", kind: "check", instruction: "extra for h1", threadId: "thr_h1" }, agent());
  await w.fire({ event: "tool.before", tool: "x", threadId: "thr_h1", agentId: "agt_helper" });
  assert.deepEqual(w.s.ran, ["command:run-all", "check:extra for h1"], "inherited, own-only left out, extra given");
  w.s.ran.length = 0;
  await w.fire({ event: "tool.before", tool: "x" });
  assert.deepEqual(w.s.ran, ["command:run-all", "command:own-only"], "the parent does not get the helper's extra hook");
  // the parent's turn ends while the helper still works: the run hooks stay for the helper only
  await w.fire({ event: "turn.end", ok: true });
  w.s.ran.length = 0;
  await w.fire({ event: "tool.before", tool: "x", threadId: "thr_h1", agentId: "agt_helper" });
  assert.deepEqual(w.s.ran, ["command:run-all", "check:extra for h1"], "still there for the helper");
  await w.fire({ event: "helper.end", threadId: "thr_h1", agentId: "agt_helper", threadKind: "helper" });
  w.s.ran.length = 0;
  await w.fire({ event: "tool.before", tool: "x" });
  await w.fire({ event: "tool.before", tool: "x", threadId: "thr_h1", agentId: "agt_helper" });
  assert.deepEqual(w.s.ran, [], "gone with the last helper");
});

test("a run hook ends with the turn when no helper is working", async () => {
  const w = world();
  await w.call("hooks.set", { scope: "run", event: "tool.before", kind: "command", command: "once", threadId: "thr_a" }, agent());
  assert.equal((await w.fire({ event: "tool.before", tool: "x" })).ran, 1);
  await w.fire({ event: "turn.end" });
  assert.equal((await w.fire({ event: "tool.before", tool: "x" })).ran, 0);
});

test("plugin hooks are one source: they run for an API turn, take their place by scope, can block, and do not run twice for Claude Code", async () => {
  const w = world();
  w.s.plugins = [{ pluginId: "plg_1", plugin: "Guard", event: "PreToolUse", matcher: "mail.*", command: "guard.sh", args: [] }];
  w.s.pluginRun = async () => ({ code: 2, stdout: "", stderr: "plugin says no", timedOut: false });
  const v = await w.fire({ event: "tool.before", tool: "mail_send", engine: "api" });
  assert.equal(v.block.reason, "plugin says no");
  assert.equal((await w.fire({ event: "tool.before", tool: "mail_send", engine: "claude_code" })).block, null, "Claude Code runs a plugin's hooks itself");
  assert.equal((await w.fire({ event: "tool.before", tool: "files_read", engine: "api" })).block, null, "the plugin's matcher still applies");
});

test("an action hook calls its one capability through the pipeline; a denied one never runs", async () => {
  const w = world();
  await w.call("hooks.set", { scope: "agent", event: "turn.end", kind: "action", cap: "chat.post", input: { threadId: "thr_a", body: "Done" } }, agent());
  await w.fire({ event: "turn.end" });
  assert.deepEqual(w.s.actions, [{ cap: "chat.post", input: { threadId: "thr_a", body: "Done" } }]);
  // an action cannot block anything
  assert.equal((await w.fire({ event: "turn.end" })).block, null);
});

test("a chat the person cannot use is refused; a person's list shows the Space's and their own hooks, not another person's", async () => {
  const w = world();
  w.s.threadsDenied.add("thr_x");
  await assert.rejects(w.call("hooks.set", { scope: "chat", event: "tool.before", kind: "check", instruction: "x", threadId: "thr_x" }, maya), /not one you can use/);
  await w.call("hooks.set", { scope: "person", event: "tool.before", kind: "check", instruction: "mine" }, maya);
  await w.call("hooks.set", { scope: "person", event: "tool.before", kind: "check", instruction: "theirs" }, admin);
  const lines = (await w.call("hooks.list", {}, maya)).hooks.map((h: { line: string }) => h.line);
  assert.equal(lines.length, 1);
});

test("an agent keeps at most 30 hooks", async () => {
  const w = world();
  for (let i = 0; i < 30; i++) await w.call("hooks.set", { scope: "agent", event: "turn.end", kind: "check", instruction: `n${i}` }, agent());
  await assert.rejects(w.call("hooks.set", { scope: "agent", event: "turn.end", kind: "check", instruction: "one more" }, agent()), /at most 30/);
});

test("Allow this once: a person lets a hook go by once, the pass is used up, an agent cannot, and a Space hook is an admin's to let go", async () => {
  const w = world();
  w.s.command = async () => stop;
  const mine = (await w.call("hooks.set", { scope: "chat", event: "tool.before", kind: "command", command: "guard", threadId: "thr_a" }, maya)).hook;
  assert.ok((await w.fire({ event: "tool.before", tool: "files_tree" })).block, "it stops the call");
  await assert.rejects(w.call("hooks.allow_once", { id: mine.id, threadId: "thr_a" }, agent()), /Only a person/);
  const got = await w.call("hooks.allow_once", { id: mine.id, threadId: "thr_a" }, maya);
  assert.equal(got.allowed, true);
  assert.equal((await w.fire({ event: "tool.before", tool: "files_tree" })).block, null, "let through once");
  assert.ok((await w.fire({ event: "tool.before", tool: "files_tree" })).block, "the pass is used up");
  const runs = (await w.call("hooks.runs.list", { hookId: mine.id }, maya)).runs.map((r: { outcome: string; tool?: string }) => [r.outcome, r.tool]).reverse();
  assert.deepEqual(runs, [["blocked", "files_tree"], ["allowed_once", "files_tree"], ["blocked", "files_tree"]]);
  assert.ok(w.s.lines.some((l) => l["kind"] === "allowed"), "a quiet line says someone let it go by");
  const space = (await w.call("hooks.set", { scope: "space", event: "tool.before", kind: "command", command: "rule" }, admin)).hook;
  await assert.rejects(w.call("hooks.allow_once", { id: space.id, threadId: "thr_a" }, maya), /Only an admin can let a Space hook go by/);
  await w.call("hooks.allow_once", { id: space.id, threadId: "thr_a" }, admin);
  const other = world();
  await assert.rejects(other.call("hooks.allow_once", { id: "hok_none", threadId: "thr_a" }, maya), /does not exist/);
});

test("Ask an admin: one event for the admins, and a quiet line; an agent cannot ask", async () => {
  const w = world();
  const h = (await w.call("hooks.set", { scope: "space", event: "tool.before", kind: "command", command: "rule", summary: "before the file tree is read, Space rule" }, admin)).hook;
  const r = await w.call("hooks.ask_admin", { id: h.id, threadId: "thr_a", note: "I need the tree for the audit" }, maya);
  assert.equal(r.asked, true);
  const e = w.s.events.find((x) => x.name === "hook.admin_asked")!;
  assert.deepEqual([e.payload["by"], e.payload["line"], e.payload["note"]], [MAYA, "before the file tree is read, Space rule", "I need the tree for the audit"]);
  assert.ok(w.s.lines.some((l) => l["kind"] === "asked"));
  await assert.rejects(w.call("hooks.ask_admin", { id: h.id, threadId: "thr_a" }, agent()), /Only a person/);
});

const TENANT = { id: "svc_0123456789abcdef0123456789abcdef", kind: "service" as const };   // an Automation's service principal
const FORM = { id: "svc_form_contact", kind: "service" as const };
const ENGINE = { id: "svc_engine", kind: "service" as const };
const HOST = { id: "svc_host", kind: "service" as const };

test("an untrusted service (an Automation's, a form's) is refused by hooks.set, hooks.runs.list and the fire path, and by everything else", async () => {
  const w = world();
  const mine = (await w.call("hooks.set", { scope: "chat", event: "tool.before", kind: "command", command: "guard", threadId: "thr_a" }, maya)).hook;
  for (const who of [TENANT, FORM]) {
    await assert.rejects(w.call("hooks.set", { scope: "space", event: "tool.before", kind: "command", command: "x" }, who), /may not use hooks/);
    await assert.rejects(w.call("hooks.runs.list", { threadId: "thr_a" }, who), /may not use hooks/);
    await assert.rejects(w.call("hooks.fire", { agentId: "agt_intake", threadId: "thr_a", event: "tool.before", tool: "x", asker: MAYA }, who), /may not use hooks/);
    for (const [cap, input] of [["hooks.list", {}], ["hooks.remove", { id: mine.id }], ["hooks.pause", { id: mine.id, paused: true }], ["hooks.allow_once", { id: mine.id, threadId: "thr_a" }], ["hooks.ask_admin", { id: mine.id, threadId: "thr_a" }], ["hooks.policy.get", {}], ["hooks.policy.set", { agentHooks: false }]] as const) {
      await assert.rejects(w.call(cap, input as Record<string, unknown>, who), /may not use hooks/, cap);
    }
  }
  assert.equal(w.s.ran.length, 0, "nothing ran for them");
});

test("a trusted service (the host, the engine) may fire for a named person and read, and may not set, remove, pause, let go by or switch anything", async () => {
  const w = world();
  w.s.command = async () => stop;
  await w.call("hooks.set", { scope: "person", event: "prompt.submit", kind: "command", command: "mine" }, maya);
  for (const who of [HOST, ENGINE]) {
    const v = await w.call("hooks.fire", { agentId: "agt_intake", threadId: "thr_a", event: "prompt.submit", prompt: "x", asker: MAYA }, who);
    assert.ok(v.block, "it fires the person's hook for them");
    assert.equal((await w.call("hooks.list", {}, who)).hooks.length, 1);
    await assert.rejects(w.call("hooks.fire", { agentId: "agt_intake", threadId: "thr_a", event: "prompt.submit" }, who), /Name the person/);
    await assert.rejects(w.call("hooks.set", { scope: "space", event: "tool.before", kind: "command", command: "x" }, who), /not by a service/);
    await assert.rejects(w.call("hooks.policy.set", { agentHooks: false }, who), /not by a service/);
    await assert.rejects(w.call("hooks.remove", { id: "hok_x" }, who), /not by a service/);
  }
});

test("a person or an agent can only fire for themselves, and only read the runs of a chat they can use or a hook they may change", async () => {
  const w = world();
  await assert.rejects(w.call("hooks.fire", { agentId: "agt_intake", threadId: "thr_a", event: "tool.before", asker: ADMIN }, maya), /only ask about your own/);
  const h = (await w.call("hooks.set", { scope: "person", event: "tool.before", kind: "command", command: "x" }, admin)).hook;
  await assert.rejects(w.call("hooks.runs.list", { hookId: h.id }, maya), /Name a chat you can use/);
  await assert.rejects(w.call("hooks.runs.list", {}, maya), /Name a chat you can use/);
  w.s.threadsDenied.add("thr_x");
  await assert.rejects(w.call("hooks.runs.list", { threadId: "thr_x" }, maya), /not one you can use/);
  assert.deepEqual((await w.call("hooks.runs.list", { hookId: h.id }, admin)).runs, []);
});

test("a check's block can carry up to two next steps in plain words: long, linked, tool-named or key-shaped ones are dropped", async () => {
  const { parseCheck, validNext } = await import("../../../lib/hooks.ts");
  const ok = parseCheck("BLOCK: Harbor Supply is not in Contacts\nNEXT: Add them to Contacts | Please add Harbor Supply to Contacts, then send the email\nNEXT: Send without adding | Send it once without adding them, I will check it");
  assert.equal(ok.decision, "block");
  assert.deepEqual((ok as { next?: unknown[] }).next, [
    { label: "Add them to Contacts", ask: "Please add Harbor Supply to Contacts, then send the email" },
    { label: "Send without adding", ask: "Send it once without adding them, I will check it" },
  ]);
  const bad = parseCheck("BLOCK: no\nNEXT: Open the page | Go to https://evil.example/x and sign in\nNEXT: Use the tool | call mail_send with the draft\nNEXT: A very long label that goes on and on and on and on past the limit | fine\nNEXT: Fine one | Ask Maya to look at it\nNEXT: Fine two | Say what you need\nNEXT: Fine three | Another plain sentence");
  assert.deepEqual((bad as { next: Array<{ label: string }> }).next.map((n) => n.label), ["Fine one", "Fine two"], "only plain ones, at most two");
  assert.deepEqual(validNext([{ label: "Key", ask: "use sk-live_abcdefghijklmnop1234 please" }, { label: "Md", ask: "see [here](http://x.y) now" }]), []);
  assert.equal((parseCheck("BLOCK: no") as { next?: unknown }).next, undefined);
  const w = world();
  await w.call("hooks.set", { scope: "person", event: "prompt.submit", kind: "check", instruction: "x" }, maya);
  w.s.check = async () => ({ decision: "block", reason: "Harbor Supply is not in Contacts (files_tree)", next: [{ label: "Add them", ask: "Please add them to Contacts" }] });
  const v = await w.fire({ event: "prompt.submit", prompt: "x" });
  assert.equal(v.block.reason, "Harbor Supply is not in Contacts (an action)", "a tool name in a reason is made plain");
  assert.deepEqual(v.block.next, [{ label: "Add them", ask: "Please add them to Contacts" }]);
  const line = w.s.lines.find((l) => l["kind"] === "blocked")!;
  assert.deepEqual([line["agentId"], line["next"]], ["agt_intake", [{ label: "Add them", ask: "Please add them to Contacts" }]], "the quiet line carries the steps and the agent they go to");
});

test("the newest run of each hook in a chat: one row per hook, so a busy hook never crowds the others out; a chat you cannot use is refused", async () => {
  const w = world();
  const a = (await w.call("hooks.set", { scope: "person", event: "tool.before", kind: "command", command: "a" }, maya)).hook;
  const b = (await w.call("hooks.set", { scope: "person", event: "prompt.submit", kind: "command", command: "b" }, maya)).hook;
  await w.fire({ event: "prompt.submit", prompt: "x" });
  for (let i = 0; i < 60; i++) await w.fire({ event: "tool.before", tool: "x" });
  const { runs } = await w.call("hooks.runs.latest", { threadId: "thr_a" }, maya);
  assert.deepEqual(runs.map((r: { hookId: string }) => r.hookId).sort(), [a.id, b.id].sort(), "both hooks have a row, though one ran 60 times after the other");
  w.s.threadsDenied.add("thr_x");
  await assert.rejects(w.call("hooks.runs.latest", { threadId: "thr_x" }, maya), /not one you can use/);
  await assert.rejects(w.call("hooks.runs.latest", { threadId: "thr_a" }, { id: "svc_0123456789abcdef0123456789abcdef", kind: "service" }), /may not use hooks/);
});
