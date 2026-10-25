// The Chrome, Screen and Files tools of an agent computer (P-L2_16b; spec 2.7, ARCH 6.6, 6.11, 7.2) against a scripted agentd: who may call them and on which computer, waking, the person's
// controls, what each tool refuses before agentd hears of it, what agentd refuses and how that is told, held items and the batch, secrets and the scrub, the timeline, the paths of the
// Files folder, and the shape of every answer. Real SQLite behind the host's ctx.db guard; the container is the fake machine.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { giveBack, takeOver } from "../handlers/lifecycle.ts";
import { timeline } from "../handlers/record.ts";
import { folderPath } from "../handlers/tools/files.ts";
import { bindHost, bindKit, forgetSecrets, bindTeam } from "../projections.ts";
import type { ScrubKit } from "../projections.ts";
import { asPerson, codeOf, harness, OMAR } from "../fixtures/harness.ts";
import { agentd, PNG, steps, tool, world } from "./tools.fixture.ts";

const code = (e: unknown): string => codeOf(e);
const INTAKE_ID = "agt_intake";
const declared = (cap: string): readonly string[] => registry.capabilities.find((c) => c.name === cap)!.errors as readonly string[];

/** Every refusal the tests below provoke, with the capability it came from: each must be an error that capability declares. */
const seen: Array<[string, string]> = [];
async function refused(cap: string, run: () => Promise<unknown>, want: string, why = cap): Promise<void> {
  await assert.rejects(run, (e) => {
    assert.equal(code(e), want, why);
    seen.push([cap, code(e)]);
    return true;
  });
}

const SCRUB: ScrubKit = {
  createScrubber: (secrets) => ({ scrub: (text: string) => secrets.reduce((t, s) => t.split(s.value).join(`[${s.handle}]`), text) }),
};

// ---- whose computer, awake or asleep, whose hands

test("an agent that leaves the computer out uses its own; a person has to name it", async () => {
  const w = await world();
  const out = await tool["computers.chrome.state"]!(w.agent().ctx, {});
  assert.equal(out.url, "https://example.com/");
  assert.equal(w.d.calls[0]?.computerId, w.id);
  await refused("computers.chrome.state", () => tool["computers.chrome.state"]!(w.h.ctx, {}), "validation.bad_input");
  const stranger = asPerson(w.h, { kind: "agent", id: "agt_nobody" });
  w.d.rebind();
  await refused("computers.chrome.state", () => tool["computers.chrome.state"]!(stranger.ctx, {}), "validation.not_found", "an agent with no computer");
  bindHost(null);
});

test("a computer that is not the caller's needs a grant to use it", async () => {
  const w = await world();
  w.h.deny(`computer:${w.id}`);
  await refused("computers.chrome.click", () => tool["computers.chrome.click"]!(w.h.ctx, { computerId: w.id, ref: "e1" }), "permission.no_grant", "a person without the grant");
  const stranger = asPerson(w.h, { kind: "agent", id: "agt_other" }, { deny: [`computer:${w.id}`] });
  w.d.rebind();
  await refused("computers.screen.click", () => tool["computers.screen.click"]!(stranger.ctx, { computerId: w.id, x: 1, y: 1 }), "permission.no_grant", "another agent without the grant");
  assert.equal(w.d.calls.length, 0, "agentd heard of neither");
  // The owner needs none.
  assert.equal((await tool["computers.chrome.state"]!(w.agent().ctx, {})).loading, false);
  bindHost(null);
});

test("a Personal Space has no agent computers", async () => {
  const w = await world({ harness: { personalSpace: true } }).catch(() => null);
  // provisioning is refused there, so the world cannot even be built: the tools say the same by themselves.
  assert.equal(w, null);
  bindTeam(null);
  const h = harness();
  const d = agentd(h);
  bindTeam(() => false);
  await refused("computers.chrome.state", () => tool["computers.chrome.state"]!(h.ctx, { computerId: "cmt_x" }), "permission.needs_team");
  assert.equal(d.calls.length, 0);
  bindTeam(null);
  bindHost(null);
});

test("a sleeping computer is woken by the first tool, and status, stop and resume leave it asleep", async () => {
  const w = await world({ asleep: true });
  assert.equal((await tool["computers.chrome.status"]!(w.h.ctx, { computerId: w.id })).connected, false);
  assert.deepEqual(await tool["computers.chrome.stop"]!(w.h.ctx, { computerId: w.id }), { stopped: true });
  assert.deepEqual(await tool["computers.chrome.resume"]!(w.h.ctx, { computerId: w.id }), { resumed: false });
  assert.equal(w.d.calls.length, 0);
  assert.equal(w.h.fake.named("start").length, 0);
  assert.equal(w.h.rows("SELECT state FROM computers_computers")[0]?.["state"], "asleep");
  const agent = w.agent();
  const out = await tool["computers.chrome.open"]!(agent.ctx, { url: "https://example.com/form" });
  assert.equal(out.url, "https://example.com/form");
  assert.equal(w.h.fake.named("start").length, 1);
  assert.equal(w.h.rows("SELECT state FROM computers_computers")[0]?.["state"], "working");
  assert.deepEqual(agent.named("computer.started").map((e) => e.payload["by"]), [INTAKE_ID], "the agent woke its own computer");
  assert.equal(w.d.calls.length, 1);
  bindHost(null);
});

test("a computer that will not start is told as a fault, and agentd hears nothing", async () => {
  const w = await world({ asleep: true });
  w.h.fake.failing.add("start");
  await refused("computers.chrome.open", () => tool["computers.chrome.open"]!(w.h.ctx, { computerId: w.id, url: "https://example.com" }), "internal.unexpected");
  assert.equal(w.d.calls.length, 0);
  bindHost(null);
});

test("while a person has the controls the agent's tools wait, and give back lets them go on", async () => {
  const w = await world();
  await takeOver(w.h.ctx, { computerId: w.id });
  const agent = w.agent();
  for (const [cap, input] of [["computers.chrome.click", { ref: "e1" }], ["computers.screen.type", { text: "x" }], ["computers.files.write", { path: "a.md", content: "x" }]] as const) {
    await refused(cap, () => tool[cap]!(agent.ctx, input), "validation.bad_input", `${cap} during a takeover`);
  }
  assert.equal(w.d.calls.length, 0);
  // Looking at whether Chrome is paused is how the agent finds out; stop is allowed to stop it.
  assert.equal((await tool["computers.chrome.status"]!(agent.ctx, {})).connected, true);
  assert.deepEqual(await tool["computers.chrome.stop"]!(agent.ctx, {}), { stopped: true });
  await giveBack(w.h.ctx, { computerId: w.id });
  assert.equal((await tool["computers.chrome.click"]!(w.agent().ctx, { ref: "e1" })).ok, true);
  bindHost(null);
});

// ---- what agentd refuses, and how it is told

test("what agentd refuses is told as the error it is: Esc, a missing element, a bad argument, a timeout, a silent computer", async () => {
  const w = await world();
  const agent = w.agent();
  w.d.refuse("chrome_click", "paused");
  await assert.rejects(() => tool["computers.chrome.click"]!(agent.ctx, { ref: "e1" }), (e: any) => {
    assert.equal(code(e), "provider.unavailable");
    assert.match(e.error.message, /Esc/);
    seen.push(["computers.chrome.click", code(e)]);
    return true;
  });
  w.d.refuse("chrome_click", "not_found", "no element e9");
  await refused("computers.chrome.click", () => tool["computers.chrome.click"]!(agent.ctx, { ref: "e9" }), "validation.not_found");
  w.d.refuse("chrome_click", "bad_input", "ref is not an element");
  await refused("computers.chrome.click", () => tool["computers.chrome.click"]!(agent.ctx, { ref: "zz" }), "validation.bad_input");
  w.d.refuse("chrome_click", "held", "something is already held");
  await refused("computers.chrome.click", () => tool["computers.chrome.click"]!(agent.ctx, { ref: "e1" }), "validation.bad_input");
  w.d.refuse("chrome_click", "timeout", "too slow");
  await refused("computers.chrome.click", () => tool["computers.chrome.click"]!(agent.ctx, { ref: "e1" }), "timeout.deadline");
  w.d.refuse("chrome_click", "unavailable", "agentd is down");
  await refused("computers.chrome.click", () => tool["computers.chrome.click"]!(agent.ctx, { ref: "e1" }), "provider.unavailable");
  w.d.allow("chrome_click");
  w.d.table["chrome_state"] = () => { throw new Error("boom"); };
  await refused("computers.chrome.state", () => tool["computers.chrome.state"]!(agent.ctx, {}), "provider.unavailable", "an unexpected failure of the host");
  assert.equal(steps(w.h).length, 0, "a failed call leaves no step");
  bindHost(null);
});

test("a host that cannot run tools, or no host, is a provider fault", async () => {
  const w = await world();
  bindHost(w.h.fake.host);
  await refused("computers.screen.key", () => tool["computers.screen.key"]!(w.h.ctx, { computerId: w.id, combo: "ctrl+l" }), "provider.unavailable", "a host without tools");
  bindHost(null);
  await refused("computers.screen.key", () => tool["computers.screen.key"]!(w.h.ctx, { computerId: w.id, combo: "ctrl+l" }), "provider.unavailable", "no host");
});

test("an answer that does not fit the capability is a fault, extra keys never reach the model, and only the capability's keys come back", async () => {
  const w = await world({ answers: { chrome_state: () => ({ url: "https://example.com/", title: "T", loading: false, internal: "agentd debug", used: [], frame: "" }) } });
  const agent = w.agent();
  assert.deepEqual(await tool["computers.chrome.state"]!(agent.ctx, {}), { url: "https://example.com/", title: "T", loading: false });
  w.d.table["chrome_state"] = () => ({ url: "https://example.com/", title: "T", loading: "no" });
  await refused("computers.chrome.state", () => tool["computers.chrome.state"]!(agent.ctx, {}), "provider.unavailable", "a wrong kind");
  w.d.table["chrome_state"] = () => ({ url: "https://example.com/", loading: false });
  await refused("computers.chrome.state", () => tool["computers.chrome.state"]!(agent.ctx, {}), "provider.unavailable", "a missing key");
  w.d.table["computer_files_list"] = () => ({ entries: [{ name: "x", kind: "socket" }] });
  await refused("computers.files.list", () => tool["computers.files.list"]!(agent.ctx, {}), "provider.unavailable", "an entry that is neither a file nor a folder");
  bindHost(null);
});

// ---- the timeline

test("an action adds a step with words and the agent's name, a look adds none, and agentd's own caption and frame win", async () => {
  const w = await world({ answers: { chrome_click: () => ({ ok: true, caption: "Clicked Submit", frame: PNG }) } });
  const agent = w.agent();
  const before = steps(w.h).length;
  await tool["computers.chrome.snapshot"]!(agent.ctx, {});
  await tool["computers.chrome.state"]!(agent.ctx, {});
  await tool["computers.screen.move"]!(agent.ctx, { x: 1, y: 1 });
  assert.equal(steps(w.h).length, before, "looks and a pointer move add no step");
  await tool["computers.chrome.open"]!(agent.ctx, { url: "https://example.com/form" });
  await tool["computers.chrome.click"]!(agent.ctx, { ref: "e2" });
  await tool["computers.screen.key"]!(agent.ctx, { combo: "ctrl+l" });
  const rows = steps(w.h).slice(before);
  assert.deepEqual(rows.map((r) => r["caption"]), ["Opened example.com", "Clicked Submit", "Pressed ctrl+l"]);
  assert.deepEqual(rows.map((r) => r["tool"]), ["chrome_open", "chrome_click", "screen_key"]);
  assert.ok(rows.every((r) => r["by_who"] === "agent"));
  assert.equal(rows[1]?.["frame_file_id"], "fil_shot1", "the frame agentd sent is the step's picture");
  assert.equal(rows[0]?.["frame_file_id"], null);
  assert.equal(agent.calls("files.create").length, 1);
  assert.equal((agent.calls("files.create")[0]?.input["content"] as { base64: string }).base64, PNG);
  const tl = await timeline(w.h.ctx, { computerId: w.id });
  assert.equal(tl.steps.length, rows.length + before);
  // A person using the tool is "person" on the step.
  await tool["computers.screen.key"]!(w.h.ctx, { computerId: w.id, combo: "Return" });
  assert.equal(steps(w.h).at(-1)?.["by_who"], "person");
  bindHost(null);
});

test("the run and thread of the caller are on the step, and a frame that cannot be kept does not fail the call", async () => {
  const w = await world({ answers: { chrome_click: () => ({ ok: true, frame: PNG }) } });
  const a = w.agent();
  a.ctx.run = "run_1";
  a.ctx.thread = "thr_1";
  a.respond["files.create"] = () => { throw new Error("storage is full"); };
  assert.equal((await tool["computers.chrome.click"]!(a.ctx, { ref: "e1" })).ok, true);
  const row = steps(w.h).at(-1)!;
  assert.equal(row["run_id"], "run_1");
  assert.equal(row["thread_id"], "thr_1");
  assert.equal(row["frame_file_id"], null);
  bindHost(null);
});

test("what is typed is never in the timeline, and a held item says so", async () => {
  const w = await world({ answers: { chrome_act: () => ({ ok: true, heldId: "held_1" }), chrome_type: () => ({ ok: true }) } });
  const agent = w.agent();
  await tool["computers.chrome.type"]!(agent.ctx, { ref: "e3", text: "correct-horse-battery" });
  await tool["computers.screen.type"]!(agent.ctx, { text: "#Dana_Site.password" });
  const held = await tool["computers.chrome.act"]!(agent.ctx, { ref: "e9", action: "click" });
  assert.equal(held.heldId, "held_1");
  const all = steps(w.h).map((r) => String(r["caption"]));
  assert.ok(all.every((c) => !c.includes("correct-horse") && !c.includes("#Dana")), all.join(" | "));
  assert.equal(all.at(-1), "Waiting for approval: Clicked element e9");
  const sent = await tool["computers.chrome.send"]!(agent.ctx, { heldId: "held_1", idempotencyKey: "k" });
  assert.equal(sent.sent, true);
  assert.deepEqual(w.d.named("chrome_send")[0]?.args, { heldId: "held_1" });
  await refused("computers.chrome.send", () => tool["computers.chrome.send"]!(agent.ctx, { heldId: "", idempotencyKey: "k" }), "validation.bad_input");
  bindHost(null);
});

// ---- secrets

test("a #Handle.field goes to agentd as written, the values it filled are scrubbed from every answer, and a value too short to scrub is never kept", async () => {
  bindKit(SCRUB);
  const value = "s3cret-Value-9";
  const w = await world({
    answers: {
      chrome_fill: () => ({ ok: true, filled: 1, used: [{ handle: "#Dana_Site.password", itemId: "itm_1", value }, { handle: "#Dana_Site.pin", itemId: "itm_2", value: "123" }] }),
      chrome_snapshot: () => ({ url: "https://example.com/", title: `Welcome ${value}`, tree: `- textbox [e3] value "${value}"`, truncated: false }),
      chrome_console: () => ({ messages: [{ level: "log", text: `typed ${value}`, at: 1 }] }),
      computer_files_read: () => ({ content: `password=${value}`, encoding: "utf8", truncated: false }),
    },
  });
  const agent = w.agent();
  const filled = await tool["computers.chrome.fill"]!(agent.ctx, { fields: [{ ref: "e3", value: "#Dana_Site.password" }] });
  assert.deepEqual(filled, { ok: true, filled: 1 });
  assert.deepEqual(w.d.named("chrome_fill")[0]?.args, { fields: [{ ref: "e3", value: "#Dana_Site.password" }] }, "the handle, not a value");
  const snap = await tool["computers.chrome.snapshot"]!(agent.ctx, {});
  assert.ok(!JSON.stringify(snap).includes(value));
  assert.match(snap.tree, /\[#Dana_Site\.password\]/);
  assert.ok(!JSON.stringify(await tool["computers.chrome.console"]!(agent.ctx, {})).includes(value));
  assert.ok(!JSON.stringify(await tool["computers.files.read"]!(agent.ctx, { path: "work/login.txt" })).includes(value));
  assert.ok(!JSON.stringify(steps(w.h)).includes(value));
  forgetSecrets(w.id);
  bindKit(null);
  bindHost(null);
});

// ---- the batch

test("a batch runs its steps in order against one computer and stops at the first held item or failure", async () => {
  const w = await world({ answers: { chrome_click: (a) => (a["ref"] === "e7" ? { ok: true, heldId: "held_7" } : { ok: true }) } });
  const agent = w.agent();
  const all = await tool["computers.chrome.batch"]!(agent.ctx, { steps: [{ tool: "open", args: { url: "https://example.com" } }, { tool: "chrome_click", args: { ref: "e2" } }, { tool: "computers.chrome.state", args: {} }] });
  assert.deepEqual(all.results.map((r: any) => [r.tool, r.ok]), [["open", true], ["click", true], ["state", true]]);
  assert.deepEqual(w.d.calls.map((c) => c.tool), ["chrome_open", "chrome_click", "chrome_state"]);
  const before = w.d.calls.length;
  const held = await tool["computers.chrome.batch"]!(agent.ctx, { steps: [{ tool: "click", args: { ref: "e7" } }, { tool: "state", args: {} }] });
  assert.equal(held.results.length, 1);
  assert.equal(held.results[0].heldId, "held_7");
  assert.equal(w.d.calls.length, before + 1, "nothing ran after the held item");
  w.d.refuse("chrome_click", "not_found", "no element e8");
  const failed = await tool["computers.chrome.batch"]!(agent.ctx, { steps: [{ tool: "click", args: { ref: "e8" } }, { tool: "state", args: {} }] });
  assert.equal(failed.results.length, 1);
  assert.equal(failed.results[0].ok, false);
  assert.match(failed.results[0].result.error, /no element e8/);
  bindHost(null);
});

test("a batch cannot do what its parts could not do alone: send, api, eval, stop, resume and a nested batch are refused before anything runs", async () => {
  const w = await world();
  const agent = w.agent();
  for (const name of ["send", "api", "eval", "stop", "resume", "batch", "chrome_send", "computers.chrome.api", "nope"]) {
    await refused("computers.chrome.batch", () => tool["computers.chrome.batch"]!(agent.ctx, { steps: [{ tool: "state", args: {} }, { tool: name, args: {} }] }), "validation.bad_input", name);
  }
  await refused("computers.chrome.batch", () => tool["computers.chrome.batch"]!(agent.ctx, { steps: [] }), "validation.bad_input", "no steps");
  await refused("computers.chrome.batch", () => tool["computers.chrome.batch"]!(agent.ctx, { steps: Array.from({ length: 51 }, () => ({ tool: "state", args: {} })) }), "validation.bad_input", "51 steps");
  assert.equal(w.d.calls.length, 0);
  bindHost(null);
});

// ---- what each tool refuses before agentd hears of it

test("Chrome tools refuse a bad argument without calling agentd", async () => {
  const w = await world();
  const a = w.agent().ctx;
  const bad: Array<[string, Record<string, unknown>]> = [
    ["computers.chrome.act", { action: "click" }],
    ["computers.chrome.act", { action: "press" }],
    ["computers.chrome.act", { action: "select", ref: "e1" }],
    ["computers.chrome.click", {}],
    ["computers.chrome.click", { x: 5 }],
    ["computers.chrome.click", { x: -1, y: 5 }],
    ["computers.chrome.type", { text: "x".repeat(20_001) }],
    ["computers.chrome.fill", { fields: [] }],
    ["computers.chrome.fill", { fields: [{ ref: "", value: "x" }] }],
    ["computers.chrome.open", { url: "file:///etc/passwd" }],
    ["computers.chrome.open", { url: "javascript:alert(1)" }],
    ["computers.chrome.tabs", { action: "close" }],
    ["computers.chrome.tabs", { action: "new", url: "ftp://x" }],
    ["computers.chrome.wait", { until: "text" }],
    ["computers.chrome.wait", { until: "time", value: "999999" }],
    ["computers.chrome.eval", { expression: "  " }],
    ["computers.chrome.inspect", { ref: "" }],
    ["computers.chrome.plan", { goal: " " }],
    ["computers.chrome.api", { method: "GET", url: "gopher://x" }],
    ["computers.chrome.api", { method: "GET", url: "https://example.com", body: { a: 1 } }],
  ];
  for (const [cap, input] of bad) await refused(cap, () => tool[cap]!(a, input), "validation.bad_input", `${cap} ${JSON.stringify(input).slice(0, 60)}`);
  assert.equal(w.d.calls.length, 0);
  bindHost(null);
});

test("Screen tools refuse a position off the screen, a bad key and a wait out of range", async () => {
  const w = await world();
  const a = w.agent().ctx;
  const bad: Array<[string, Record<string, unknown>]> = [
    ["computers.screen.click", { x: -1, y: 0 }],
    ["computers.screen.click", { x: 1.5, y: 0 }],
    ["computers.screen.click", { x: 0, y: 20_000 }],
    ["computers.screen.move", { x: 0, y: -4 }],
    ["computers.screen.drag", { fromX: 0, fromY: 0, toX: 99_999, toY: 0 }],
    ["computers.screen.type", { text: "" }],
    ["computers.screen.type", { text: "x".repeat(20_001) }],
    ["computers.screen.key", { combo: "" }],
    ["computers.screen.key", { combo: "ctrl+;" }],
    ["computers.screen.key", { combo: "a+b+c+d+e+f+g" }],
    ["computers.screen.key", { combo: "ctrl + l" }],
    ["computers.screen.scroll", { x: 1, y: 1, dy: 1.5 }],
    ["computers.screen.scroll", { x: 1, y: 1, dy: 1_000_000 }],
    ["computers.screen.wait", { ms: 49 }],
    ["computers.screen.wait", { ms: 60_001 }],
  ];
  for (const [cap, input] of bad) await refused(cap, () => tool[cap]!(a, input), "validation.bad_input", `${cap} ${JSON.stringify(input).slice(0, 60)}`);
  assert.equal(w.d.calls.length, 0);
  for (const [cap, input] of [["computers.screen.key", { combo: "F5" }], ["computers.screen.key", { combo: "alt+Tab" }], ["computers.screen.click", { x: 16_384, y: 0 }], ["computers.screen.wait", { ms: 60_000 }]] as const) {
    assert.equal((await tool[cap]!(a, input)).ok, true, cap);
  }
  assert.equal(w.d.named("screen_wait")[0]?.timeoutMs, 65_000, "the call waits as long as the wait");
  bindHost(null);
});

test("the paths of the Files folder stay inside it", async () => {
  const w = await world();
  const a = w.agent().ctx;
  for (const p of ["../x", "a/../../b", "/etc/passwd", "~/x", "C:/x", "a\\b", "x\0y", "", ".", "./", "a/..", `${"a/".repeat(600)}b`]) {
    await refused("computers.files.read", () => tool["computers.files.read"]!(a, { path: p }), "validation.bad_input", JSON.stringify(p).slice(0, 40));
    await refused("computers.files.delete", () => tool["computers.files.delete"]!(a, { path: p }), "validation.bad_input", `delete ${JSON.stringify(p).slice(0, 40)}`);
  }
  await refused("computers.files.move", () => tool["computers.files.move"]!(a, { from: "a.md", to: "../a.md" }), "validation.bad_input");
  await refused("computers.files.move", () => tool["computers.files.move"]!(a, { from: "a.md", to: "./a.md" }), "validation.bad_input", "the same file");
  await refused("computers.files.list", () => tool["computers.files.list"]!(a, { path: "../.." }), "validation.bad_input");
  assert.equal(w.d.calls.length, 0);
  assert.equal(folderPath(w.h.ctx, "./work//sub/"), "work/sub");
  assert.equal(folderPath(w.h.ctx, "", { allowRoot: true }), "");
  await tool["computers.files.list"]!(a, {});
  await tool["computers.files.list"]!(a, { path: "./work//sub" });
  assert.deepEqual(w.d.named("computer_files_list").map((c) => c.args), [{ path: "" }, { path: "work/sub" }]);
  bindHost(null);
});

test("a write names its mode and encoding, refuses a file too large for one call and content that is not base64", async () => {
  const w = await world();
  const a = w.agent().ctx;
  await tool["computers.files.write"]!(a, { path: "work/a.md", content: "hello" });
  await tool["computers.files.write"]!(a, { path: "work/b.bin", content: "aGVsbG8=", encoding: "base64", mode: "create" });
  assert.deepEqual(w.d.named("computer_files_write").map((c) => c.args), [
    { path: "work/a.md", content: "hello", encoding: "utf8", mode: "overwrite" },
    { path: "work/b.bin", content: "aGVsbG8=", encoding: "base64", mode: "create" },
  ]);
  await refused("computers.files.write", () => tool["computers.files.write"]!(a, { path: "work/big.txt", content: "x".repeat(90_001) }), "validation.bad_input", "too large");
  await refused("computers.files.write", () => tool["computers.files.write"]!(a, { path: "work/c.bin", content: "not base64 !", encoding: "base64" }), "validation.bad_input", "not base64");
  assert.equal(w.d.named("computer_files_write").length, 2);
  assert.deepEqual(steps(w.h).map((r) => r["caption"]), ["Wrote work/a.md", "Wrote work/b.bin"]);
  bindHost(null);
});

test("a read defaults to a megabyte and passes the limit it is given", async () => {
  const w = await world();
  const a = w.agent().ctx;
  await tool["computers.files.read"]!(a, { path: "work/a.md" });
  await tool["computers.files.read"]!(a, { path: "work/a.md", maxBytes: 100 });
  assert.deepEqual(w.d.named("computer_files_read").map((c) => c.args), [{ path: "work/a.md", maxBytes: 1_000_000 }, { path: "work/a.md", maxBytes: 100 }]);
  w.d.table["computer_files_read"] = () => ({ content: "abc", encoding: "rot13", truncated: false });
  await refused("computers.files.read", () => tool["computers.files.read"]!(a, { path: "work/a.md" }), "provider.unavailable", "an encoding that is not one");
  bindHost(null);
});

// ---- screenshots, net, api

test("both screenshots are kept in the agent's folder and the model gets the file, not the picture", async () => {
  const w = await world();
  const a = w.agent().ctx;
  const chrome = await tool["computers.chrome.screenshot"]!(a, { ref: "e2" });
  const screen = await tool["computers.screen.screenshot"]!(a, {});
  assert.deepEqual(chrome, { fileId: "fil_shot1", width: 800, height: 600 });
  assert.deepEqual(screen, { fileId: "fil_shot2", width: 1280, height: 800 });
  const made = w.agent().calls("files.create");
  assert.equal(made.length, 2);
  assert.equal(made[0]?.input["folderId"], "fld_intake");
  assert.equal((made[0]?.input["content"] as { base64: string }).base64, PNG);
  assert.equal(made[0]?.input["mime"], "image/png");
  assert.deepEqual(w.d.named("chrome_screenshot")[0]?.args, { ref: "e2" });
  assert.equal(steps(w.h).length, 0, "a picture is not a step");
  w.agent().respond["agents.get"] = () => ({ agent: {} });
  await refused("computers.screen.screenshot", () => tool["computers.screen.screenshot"]!(a, {}), "validation.bad_input", "an agent with no folder");
  bindHost(null);
});

test("network bodies are masked by key and dropped unless asked for; the answer of api keeps no credential the site sent", async () => {
  const w = await world();
  const a = w.agent().ctx;
  const without = await tool["computers.chrome.net"]!(a, {});
  assert.equal(without.requests[0].body, undefined);
  const withBodies = await tool["computers.chrome.net"]!(a, { bodies: true });
  assert.deepEqual(JSON.parse(withBodies.requests[0].body), { token: "[masked]", ok: true });
  const r = await tool["computers.chrome.api"]!(a, { method: "GET", url: "https://example.com/api/items", idempotencyKey: "k" });
  assert.equal(r.headers["set-cookie"], "[masked]");
  assert.equal(r.headers["content-type"], "application/json");
  assert.deepEqual(r.body, { ok: true, session: "[masked]" });
  assert.equal(w.d.named("chrome_api")[0]?.timeoutMs, 60_000);
  assert.equal(steps(w.h).at(-1)?.["caption"], "Called GET example.com");
  bindHost(null);
});

test("wait asks agentd for the time it was given plus a margin, and every call is capped", async () => {
  const w = await world();
  const a = w.agent().ctx;
  await tool["computers.chrome.wait"]!(a, { until: "text", value: "Done", timeoutMs: 120_000 });
  await tool["computers.chrome.wait"]!(a, { until: "load" });
  await tool["computers.chrome.state"]!(a, {});
  assert.deepEqual(w.d.calls.map((c) => c.timeoutMs), [125_000, 35_000, 30_000]);
  assert.ok(w.d.calls.every((c) => c.timeoutMs <= 130_000));
  bindHost(null);
});

test("tab actions and the plan write their step, and a list does not", async () => {
  const w = await world();
  const a = w.agent().ctx;
  await tool["computers.chrome.tabs"]!(a, { action: "list" });
  await tool["computers.chrome.tabs"]!(a, { action: "new", url: "https://example.com" });
  await tool["computers.chrome.tabs"]!(a, { action: "use", tabId: "t1" });
  await tool["computers.chrome.tabs"]!(a, { action: "close", tabId: "t1" });
  await tool["computers.chrome.plan"]!(a, { goal: "File the intake form" });
  await tool["computers.chrome.stop"]!(a, {});
  await tool["computers.chrome.resume"]!(a, {});
  assert.deepEqual(steps(w.h).map((r) => r["caption"]), ["Opened a new tab", "Switched tab", "Closed a tab", "Plan: File the intake form", "Stopped the browser", "Resumed the browser"]);
  bindHost(null);
});

// ---- every refusal above is one the capability declares

test("every error the tools raised in this file is one its capability declares", () => {
  assert.ok(seen.length > 60, `${seen.length} refusals were checked`);
  for (const [cap, c] of seen) assert.ok(declared(cap).includes(c), `${cap} raised ${c}, which it does not declare`);
});

test("a second person on the Space uses the same computer through their own grant", async () => {
  const w = await world();
  const omar = asPerson(w.h, { kind: "person", id: OMAR });
  w.d.rebind();
  assert.equal((await tool["computers.screen.click"]!(omar.ctx, { computerId: w.id, x: 1, y: 1 })).ok, true);
  assert.equal(w.h.named("computer.started").length, 1);
  bindHost(null);
});
