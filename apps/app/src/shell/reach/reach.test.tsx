// reach (lane l-chrome2a, owner 4 Nov): never send anyone to a place they cannot open. A member pressing a machine gets the peek and the Console never opens; an admin gets the Console;
// the hover and the press agree for every kind; Cmd-K never lists a page the viewer cannot open.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { mount, find, press, flush, installDom, textOf } from "../../../../../ui/src/testing/dom.ts";
import { PAGES } from "../../console/shell/nav.ts";
import { TELL_SENT, act, hint, isLink, listable, reach, tellAdmins } from "./reach.ts";
import type { Item, Viewer } from "./reach.ts";
import { ReachLink } from "./ReachLink.tsx";
import { reachable } from "../cmdk/gate.ts";
import { machineItem } from "./viewer.ts";
import { settingsData } from "../providers/settings.tsx";
import { createSampleSettings } from "../../places/settings/sample.ts";
import { sampleRuntime } from "../providers/misc-test-runtime.tsx";
import type { Hit } from "../cmdk/model.ts";

const hoverOf = (n: Node): string | null => {
  if (typeof n.props?.title === "string") return n.props.title;
  for (const c of n.children ?? []) { if (typeof c === "object") { const f = hoverOf(c); if (f !== null) return f; } }
  return null;
};
const admin: Viewer = { id: "usr_ada", spaceId: "spc_1", consolePages: new Set(PAGES.map((p) => p.id)) };
const maya: Viewer = { id: "usr_maya", spaceId: "spc_1", consolePages: new Set() };
const machine = (over: Partial<Extract<Item, { kind: "machine" }>> = {}): Item => ({ kind: "machine", id: "srv_1", name: "Studio Mac", online: true, machineKind: "linked", owner: "usr_maya", ownerName: "Maya", agents: ["Scout", "Intake"], ...over });

test("an admin goes to Console, Computers, with the machine selected", () => {
  const r = reach(machine({ owner: "usr_other" }), admin);
  assert.equal(r.to, "open");
  if (r.to !== "open") return;
  assert.equal(r.target.place, "console");
  assert.deepEqual(r.target.args, { page: "machines", machineId: "srv_1" });
  assert.equal(hint(r), "Opens Console › Computers");
});

test("the owner of a computer goes to Settings, This device", () => {
  const r = reach(machine(), maya);
  assert.deepEqual(r.to === "open" ? [r.target.place, r.target.screen, r.target.args] : null, ["settings", "settings.page", { page: "computer" }]);
});

test("anyone else gets a peek: name, Online or Offline, the agents there, whose it is; offline offers Tell an admin", () => {
  const other: Viewer = { id: "usr_sam", spaceId: "spc_1", consolePages: new Set() };
  const r = reach(machine({ online: false, needs: "Offline" }), other);
  assert.equal(r.to, "peek");
  if (r.to !== "peek") return;
  assert.deepEqual([r.peek.title, ...r.peek.lines], ["Studio Mac", "Offline", "Runs Scout, Intake", "Maya's computer"]);
  assert.equal(r.peek.tell?.label, "Tell an admin");
  const shared = reach(machine({ machineKind: "space", owner: undefined, name: "Space server" }), other);
  assert.deepEqual(shared.to === "peek" ? shared.peek.lines.at(-1) : null, "Shared server");
  assert.equal(shared.to === "peek" ? shared.peek.tell : "x", undefined, "nothing wrong: nothing to tell");
});

test("Tell an admin files one request and says one quiet line", async () => {
  const calls: Array<[string, unknown]> = [];
  const said = await tellAdmins(async (cap, input) => { calls.push([cap, input]); return {}; }, maya, "Studio Mac: Offline");
  assert.equal(said, TELL_SENT);
  assert.equal(TELL_SENT, "Sent to the Space's admins");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![0], "access.request");
  assert.deepEqual((calls[0]![1] as { resource: unknown }).resource, { type: "space", id: "spc_1" });
});

test("hover and press agree for every kind: a hover only when the press does something, the same thing", () => {
  const items: Item[] = [
    machine(), machine({ owner: "usr_x" }), { kind: "console", page: "backups" }, { kind: "console", page: "machines" },
    { kind: "item", type: "chat", id: "t1", title: "Renewal", private: true, members: ["usr_ada"] },
    { kind: "item", type: "task", id: "k1", title: "Send retainer", owner: "usr_ada", summary: "Held by Ada" },
    { kind: "item", type: "vault", id: "v1", title: "CRM key", level: "none" },
    { kind: "item", type: "record", id: "r1", title: "Rivera", level: "view" },
    { kind: "item", type: "run", id: "run1", title: "Weekly digest run", level: "none", summary: "Ran Tuesday" },
  ];
  for (const viewer of [admin, maya]) for (const item of items) {
    const r = reach(item, viewer);
    const did: string[] = [];
    const result = act(r, { open: () => did.push("open"), peek: () => did.push("peek") });
    assert.equal(result, did[0] ?? null, JSON.stringify(item));
    assert.equal(hint(r) !== null, result !== null, "a hover exists exactly when a press does something");
    assert.equal(isLink(r), result !== null, "link styling exists exactly when a press does something");
    if (result === "open") assert.ok(hint(r)!.startsWith("Opens "));
    if (result === "peek") assert.equal(hint(r), "Shows a summary");
  }
});

test("Console pages, private chats, vault items, other people's tasks and agent computers are never links to a place the viewer cannot open", () => {
  assert.equal(reach({ kind: "console", page: "backups" }, maya).to, "none");
  assert.equal(reach({ kind: "console", page: "backups" }, admin).to, "open");
  assert.equal(reach({ kind: "item", type: "chat", id: "t", title: "Private", private: true, members: ["usr_ada"] }, maya).to, "none");
  assert.equal(reach({ kind: "item", type: "vault", id: "v", title: "Key", level: "none" }, maya).to, "none");
  assert.equal(reach({ kind: "item", type: "task", id: "k", title: "Task", owner: "usr_ada", members: ["usr_ada"], summary: "Held by Ada" }, maya).to, "peek");
  assert.equal(reach({ kind: "item", type: "computer", id: "c", title: "Scout's computer", level: "none" }, maya).to, "none");
  assert.equal(reach({ kind: "item", type: "run", id: "r", title: "Run", level: "view" }, maya).to, "open");
  assert.equal(reach({ kind: "item", type: "file", id: "f", title: "Deed", place: "files", level: "view" }, { ...maya, places: new Set(["chats"]) }).to, "none", "a place the rail does not show");
});

test("Cmd-K never lists a page the viewer cannot open", () => {
  assert.equal(listable({ kind: "setting", consolePage: "backups" }, maya), false);
  assert.equal(listable({ kind: "setting", consolePage: "backups" }, admin), true);
  assert.equal(listable({ kind: "automation", place: "automations" }, { ...maya, places: new Set(["chats"]) }), false);
  assert.equal(listable({ kind: "record" }, maya), true, "a thing the server answered for them stays");
});

test("a machine row becomes a reach item: its agents, its owner's name, and what needs an admin", () => {
  const row = { serverId: "srv_1", name: "Mac", kind: "linked" as const, owner: "usr_maya", mine: false, state: "down" as const, online: false, private: false, runs: { turns: 0, agentComputers: 0, sites: 0, automations: 0 }, can: [], room: { n: 0, why: "offline" }, limits: { maxTurns: 1, maxAgentComputers: 1 }, drain: false, pins: ["agt_scout"] };
  const out = { machines: [row], waiting: [], alerts: [{ alertId: "a1", serverId: "srv_1", kind: "disk" as const, title: "Disk almost full", detail: "" }], admin: false, now: 0 };
  const item = machineItem(out, "srv_1", (id) => ({ usr_maya: "Maya", agt_scout: "Scout" })[id] ?? id, "Intake");
  assert.deepEqual(item && item.kind === "machine" ? [item.agents, item.ownerName, item.needs] : null, [["Intake", "Scout"], "Maya", "Disk almost full"]);
  assert.equal(machineItem(out, "srv_9", (id) => id), null, "a machine the list does not show gets no link");
});

test("Settings offers Connect your company only to a person who can open that Console page", () => {
  const s = createSampleSettings();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  assert.equal(settingsData(rt, undefined, undefined, true, false).openCompany, undefined);
  assert.equal(typeof settingsData(rt, undefined, undefined, true, true).openCompany, "function");
  assert.equal(settingsData(rt, undefined, undefined, false).openConsole, undefined);
});

test("the search lists only results whose place the viewer can open", () => {
  const hit = (kind: Hit["kind"], id: string): Hit => ({ kind, id, title: id, link: `vyre://${kind}/${id}`, score: 1 });
  const hits = [hit("chat", "c1"), hit("automation", "a1"), hit("file", "f1"), hit("memory", "m1")];
  const viewer: Viewer = { id: "usr_maya", places: new Set(["chats", "files"]) };
  assert.deepEqual(reachable(hits, viewer, {}).map((h) => h.id), ["c1", "f1", "m1"], "automations are not on this rail; memory lives in Chats now");
  assert.equal(reachable(hits, null, {}).length, 4, "no viewer known: nothing is held back");
});

test("pressing Runs on as a member shows the peek and the Console never opens; an admin opens the Console", async () => {
  const restore = installDom();
  try {
    for (const [viewer, expect] of [[maya, "peek"], [admin, "open"]] as const) {
      const opened: string[] = [];
      const deps = { viewer: { ...viewer, id: "usr_sam" }, open: (t: { place: string }) => { opened.push(t.place); }, call: async () => ({}) };
      const r = reach(machine({ online: false, needs: "Offline", owner: "usr_other" }), deps.viewer);
      const root = await mount(createRoot, <ReachLink r={r} label="Studio Mac" deps={deps} testID="runs-on" />);
      assert.equal(hoverOf(root), hint(r), "the hover is the one the press acts on");
      await press(find(root, "runs-on"));
      await flush();
      if (expect === "peek") {
        assert.deepEqual(opened, [], "Console never opens");
        assert.ok(find(root, "runs-on-peek"), "the peek shows");
        assert.ok(textOf(find(root, "runs-on-peek")).includes("Offline"), "it says Offline");
        await press(find(root, "runs-on-tell"));
        await flush();
        assert.ok(find(root, "runs-on-sent"));
        assert.equal(textOf(find(root, "runs-on-sent")), TELL_SENT);
      } else assert.deepEqual(opened, ["console"]);
    }
  } finally { restore(); }
});

test("a label with nowhere to go is plain text, not a link", async () => {
  const restore = installDom();
  try {
    const deps = { viewer: maya, open: () => undefined, call: async () => ({}) };
    const root = await mount(createRoot, <ReachLink r={reach({ kind: "console", page: "backups" }, maya)} label="Backups" deps={deps} testID="plain" />);
    assert.equal(find(root, "plain")!.props.role, undefined);
    assert.equal(find(root, "plain")!.props.onClick, undefined, "nothing to press");
    assert.equal(textOf(find(root, "plain")), "Backups");
    assert.equal(hoverOf(root), null, "no hover either");
  } finally { restore(); }
});
