// Console > Agents > Skills and plugins > Installed for the Space: each control is mounted for real and proved by the capability it calls.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import { InstalledForSpace, forWords, loseWords } from "../pages/InstalledForSpace.tsx";

const NAMES: Record<string, string> = { usr_dana: "Dana", usr_maya: "Maya", agt_scout: "Scout" };
const nameOf = (id: string): string => NAMES[id] ?? id;
const NEEDS = { domains: [], vaultKeys: [], files: [] };
const mk = (over: Record<string, unknown>) => ({ installId: "ins_1", kind: "skill", name: "sql-reader", repo: "acme/sql-reader", commit: "a41f9c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", url: "u", by: "usr_dana", at: 1, installed: { for: "space" }, ...over });
const PLAN = (over: Record<string, unknown> = {}) => ({ planId: "ins_9", state: "planned", kind: "skill", name: "sql-reader", summary: "Reads tables.", repo: "acme/sql-reader", commit: "7d03be8bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", url: "u", needs: NEEDS, skills: [], problems: [],
  who: [{ key: "me", label: "Just you", allowed: true }, { key: "space", label: "Everyone in the Space", allowed: true }],
  card: { name: "sql-reader", kind: "skill", summary: "Reads tables.", commit: "7d03be8bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", needs: NEEDS },
  diff: { from: "a41f9c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", to: "7d03be8bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", added: [], removed: [], changed: [{ path: "SKILL.md", plus: ["new"], minus: ["old"] }] }, ...over });

async function world(installs: unknown[], opts: { changed?: boolean; plan?: Record<string, unknown>; failApply?: boolean } = {}) {
  const restore = installDom();
  const calls: Array<{ cap: string; input: Record<string, any> }> = [];
  let list = [...installs] as Array<{ installId: string }>;
  const call = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, any> });
    if (cap === "install.list") return { installs: list };
    if (cap === "install.check_update") return opts.changed === false ? { changed: false } : { changed: true, plan: PLAN(opts.plan) };
    if (cap === "install.from_link") return { plan: PLAN({ diff: undefined, ...(opts.plan ?? {}) }) };
    if (cap === "install.apply") { if (opts.failApply) throw new Error("The card did not match."); return { installed: {} }; }
    if (cap === "install.remove") { list = list.filter((x) => x.installId !== input["installId"]); return { removed: true }; }
    throw new Error(`unscripted ${cap}`);
  };
  const root = await mount(createRoot as never, <InstalledForSpace call={call} nameOf={nameOf} />);
  await flush(); await flush();
  return { root, calls, restore };
}
const caps = (calls: Array<{ cap: string }>, cap: string) => calls.filter((c) => c.cap === cap);

test("the words: who it is for and who loses it", () => {
  assert.equal(forWords(mk({}) as never, nameOf), "Everyone in the Space");
  assert.equal(forWords(mk({ installed: { for: "agent", agentId: "agt_scout" } }) as never, nameOf), "Only Scout");
  assert.equal(forWords(mk({ installed: { for: "me" } }) as never, nameOf), "Dana");
  assert.match(loseWords(mk({}) as never, nameOf), /Everyone in the Space will lose it/);
  assert.match(loseWords(mk({ installed: { for: "agent", agentId: "agt_scout" } }) as never, nameOf), /^Scout will lose it/);
  assert.match(loseWords(mk({ installed: { for: "me" } }) as never, nameOf), /^Dana and their agents will lose it/);
});

test("a row says kind, source and commit, who it is for, who installed it, and Update available; it reads install.list for the whole Space", async () => {
  const w = await world([mk({})]);
  try {
    const t = textOf(find(w.root, "row-install-row-ins_1"));
    assert.match(t, /sql-reader/); assert.match(t, /Skill · acme\/sql-reader at a41f9c2 · For Everyone in the Space · Installed by Dana · Update available/);
    assert.deepEqual(caps(w.calls, "install.list").map((c) => c.input), [{ all: true }]);
    assert.deepEqual(caps(w.calls, "install.check_update").map((c) => c.input), [{ installId: "ins_1" }]);
    assert.ok(!/Company only|principal|grant|scope|capability/i.test(textOf(w.root)));
  } finally { w.restore(); }
});

test("Update shows the diff first, then Update calls install.apply with the plan and its card", async () => {
  const w = await world([mk({})]);
  try {
    await press(find(w.root, "install-update-ins_1")); await flush();
    assert.match(textOf(find(w.root, "install-update-sheet")), /sql-reader a41f9c2 to 7d03be8[\s\S]*- old[\s\S]*\+ new/);
    assert.equal(caps(w.calls, "install.apply").length, 0, "looking changes nothing");
    await press(find(w.root, "install-update-go")); await flush();
    const a = caps(w.calls, "install.apply");
    assert.equal(a.length, 1);
    assert.equal(a[0]!.input["planId"], "ins_9"); assert.equal(a[0]!.input["for"], "space"); assert.equal(a[0]!.input["card"].commit, "7d03be8bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  } finally { w.restore(); }
});

test("a failed update and an update that reaches somewhere new both say Needs you", async () => {
  const bad = await world([mk({})], { failApply: true });
  try {
    await press(find(bad.root, "install-update-ins_1")); await press(find(bad.root, "install-update-go")); await flush();
    assert.match(textOf(find(bad.root, "row-install-row-ins_1")), /Needs you: Update failed\. The card did not match\./);
  } finally { bad.restore(); }
  const reach = await world([mk({})], { plan: { needs: { domains: ["api.example.com"], vaultKeys: [], files: [] } } });
  try { assert.match(textOf(find(reach.root, "row-install-row-ins_1")), /Needs you: The update wants to reach api\.example\.com/); assert.match(textOf(reach.root), /1 needs you/); } finally { reach.restore(); }
});

test("Remove asks first, names who loses it, and Remove calls install.remove", async () => {
  const w = await world([mk({})], { changed: false });
  try {
    await press(find(w.root, "install-remove-ins_1"));
    assert.match(textOf(find(w.root, "install-remove-who")), /Everyone in the Space will lose it/);
    assert.equal(caps(w.calls, "install.remove").length, 0, "the first press only asks");
    await press(find(w.root, "install-remove-go")); await flush();
    assert.deepEqual(caps(w.calls, "install.remove").map((c) => c.input["installId"]), ["ins_1"]);
    assert.match(textOf(find(w.root, "installed-empty")), /Nothing installed yet\. Install a skill, plugin or tool server from a link\./);
  } finally { w.restore(); }
});

test("empty: the sentence and Install; Read it calls install.from_link, the preview shows before Install calls install.apply", async () => {
  const w = await world([]);
  try {
    assert.match(textOf(find(w.root, "installed-empty")), /Nothing installed yet\. Install a skill, plugin or tool server from a link\./);
    await press(find(w.root, "installed-add-empty"));
    await typeInto(find(w.root, "install-add-link"), "https://github.com/acme/sql-reader");
    await press(find(w.root, "install-add-read")); await flush();
    assert.deepEqual(caps(w.calls, "install.from_link").map((c) => c.input), [{ url: "https://github.com/acme/sql-reader" }]);
    assert.equal(caps(w.calls, "install.apply").length, 0, "reading installs nothing");
    assert.match(textOf(find(w.root, "install-preview-title")), /sql-reader \(Skill\)/);
    assert.match(textOf(find(w.root, "install-preview-source")), /Pinned to: 7d03be8/);
    await press(find(w.root, "install-for-me"));
    await press(find(w.root, "install-add-go")); await flush();
    const a = caps(w.calls, "install.apply");
    assert.equal(a.length, 1);
    assert.equal(a[0]!.input["planId"], "ins_9"); assert.equal(a[0]!.input["for"], "me");
  } finally { w.restore(); }
});
