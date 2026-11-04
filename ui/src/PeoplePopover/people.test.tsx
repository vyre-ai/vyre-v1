// ui/PeoplePopover: the rows, the roles, the footer action per place, the right-click menu and its permissions, the keyboard.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../testing/dom.ts";
import { PeoplePopover, footerOf, memberMenu, walk } from "./index.tsx";
import type { MemberAction, MemberRow, PeopleWhere } from "./index.tsx";

const rows: MemberRow[] = [
  { id: "usr_me", name: "Irfad Imtiaz", kind: "person", role: "Lead" },
  { id: "usr_sara", name: "Sara Malik", kind: "person", role: "Member" },
  { id: "agt_ember", name: "Ember", kind: "agent", role: "Can use" },
  { id: "agt_docs", name: "Docs", kind: "agent", role: "Can edit" },
];
const all = { message: true, changeRole: true, remove: true };

function props(over: Partial<Parameters<typeof PeoplePopover>[0]> = {}) {
  const log: string[] = [];
  return {
    log,
    p: {
      where: "chat" as PeopleWhere, rows, meId: "usr_me", perms: all, anchor: { x: 900, y: 60 },
      onOpen: (r: MemberRow) => log.push(`open:${r.id}`), onAction: (a: MemberAction, r: MemberRow) => log.push(`${a}:${r.id}`), onFooter: (id: string) => log.push(`footer:${id}`), onClose: () => log.push("close"),
      ...over,
    },
  };
}

test("the footer action depends on the place: Manage on the Overview in a project, Add people and agents in a chat", () => {
  assert.deepEqual(footerOf("project"), { label: "Manage on the Overview", id: "overview" });
  assert.deepEqual(footerOf("chat"), { label: "Add people and agents", id: "add" });
});

test("the popover is titled People and agents, one row per member with the role on the right, then the footer", async () => {
  const restore = installDom();
  try {
    const { p } = props();
    const root = await mount(createRoot, <PeoplePopover {...p} />);
    assert.equal(textOf(find(root, "people-title")).trim(), "People and agents");
    for (const r of rows) {
      assert.ok(find(root, `people-row-${r.id}`) !== null, r.name);
      assert.equal(textOf(find(root, `people-role-${r.id}`)).trim(), r.role);
    }
    assert.match(textOf(find(root, "people-row-usr_me")), /You/, "yourself reads You");
    assert.equal(textOf(find(root, "people-footer")).trim(), "Add people and agents");
    const project = await mount(createRoot, <PeoplePopover {...props({ where: "project" }).p} />);
    assert.equal(textOf(find(project, "people-footer")).trim(), "Manage on the Overview");
  } finally { restore(); }
});

test("a row opens the person or the agent; the footer runs its action; each place gets its own", async () => {
  const restore = installDom();
  try {
    const chat = props();
    const a = await mount(createRoot, <PeoplePopover {...chat.p} />);
    await press(find(a, "people-row-usr_sara"));
    await press(find(a, "people-row-agt_ember"));
    await press(find(a, "people-footer"));
    assert.deepEqual(chat.log, ["open:usr_sara", "open:agt_ember", "footer:add"]);
    const proj = props({ where: "project" });
    const b = await mount(createRoot, <PeoplePopover {...proj.p} />);
    await press(find(b, "people-footer"));
    assert.deepEqual(proj.log, ["footer:overview"]);
  } finally { restore(); }
});

test("the right-click menu: Message for another person, Change role and Remove only when permitted, never Remove on yourself, Copy Link always", () => {
  const ids = (r: MemberRow, perms = all) => memberMenu(r, perms, "usr_me").map((i) => i.id);
  assert.deepEqual(ids(rows[1]!), ["message", "role", "remove", "link"]);
  assert.deepEqual(ids(rows[0]!), ["role", "link"], "yourself: no Message, no Remove");
  assert.deepEqual(ids(rows[2]!), ["role", "remove", "link"], "an agent is not messaged");
  assert.deepEqual(ids(rows[1]!, { message: true, changeRole: false, remove: false }), ["message", "link"], "a viewer may not change or remove");
  assert.deepEqual(ids(rows[1]!, { message: false, changeRole: false, remove: false }), ["link"]);
  assert.equal(memberMenu(rows[1]!, all, "usr_me").find((i) => i.id === "remove")?.danger, true);
  assert.deepEqual(memberMenu(rows[2]!, { ...all, agentControls: true }, "usr_me").map((i) => i.id), ["poke", "settings", "role", "remove", "link"], "a chat's agent row also pokes and has its settings");
  assert.deepEqual(memberMenu(rows[1]!, { ...all, agentControls: true }, "usr_me").map((i) => i.id), ["message", "role", "remove", "link"], "a person row has no agent controls");
});

test("a right-click opens the menu and each item reports its action", async () => {
  const restore = installDom();
  try {
    const { p, log } = props();
    const root = await mount(createRoot, <PeoplePopover {...p} />);
    const row = find(root, "people-row-usr_sara");
    const open = row?.props["onContextMenu"] as ((e: unknown) => void) | undefined;
    assert.equal(typeof open, "function");
    const { act } = await import("react");
    await act(async () => { open?.({ preventDefault() {}, nativeEvent: { pageX: 10, pageY: 10 }, pageX: 10, pageY: 10, clientX: 10, clientY: 10 }); });
    for (const label of ["Message", "Change role", "Remove", "Copy Link"]) assert.ok(find(root, `menu-item-${label}`) !== null, label);
    await press(find(root, "menu-item-Remove"));
    assert.deepEqual(log, ["remove:usr_sara"]);
  } finally { restore(); }
});

test("arrow keys walk the rows and the footer, stopping at each end", () => {
  assert.equal(walk(-1, "ArrowDown", 5), 0);
  assert.equal(walk(0, "ArrowDown", 5), 1);
  assert.equal(walk(4, "ArrowDown", 5), 4, "stops at the footer");
  assert.equal(walk(0, "ArrowUp", 5), 0);
  assert.equal(walk(-1, "ArrowUp", 5), 0);
  assert.equal(walk(3, "ArrowUp", 5), 2);
  assert.equal(walk(2, "Home", 5), 0);
  assert.equal(walk(2, "End", 5), 4);
  assert.equal(walk(2, "x", 5), 2);
  assert.equal(walk(0, "ArrowDown", 0), -1);
});

test("Enter opens the row the arrows reached, Escape closes", async () => {
  const restore = installDom();
  const g = globalThis as unknown as { document: { addEventListener: (n: string, f: (e: unknown) => void) => void; removeEventListener: (n: string, f: (e: unknown) => void) => void } };
  const listeners: Array<(e: { key: string; preventDefault(): void }) => void> = [];
  const before = { add: g.document.addEventListener, rem: g.document.removeEventListener };
  g.document.addEventListener = (n, f) => { if (n === "keydown") listeners.push(f as never); };
  g.document.removeEventListener = (n, f) => { const i = listeners.indexOf(f as never); if (n === "keydown" && i >= 0) listeners.splice(i, 1); };
  try {
    const { p, log } = props();
    await mount(createRoot, <PeoplePopover {...p} />);
    const { act } = await import("react");
    const key = async (k: string): Promise<void> => { await act(async () => { for (const l of [...listeners]) l({ key: k, preventDefault() {} }); }); };
    assert.ok(listeners.length > 0, "the popover listens for keys");
    await key("ArrowDown"); await key("ArrowDown");
    await key("Enter");
    assert.deepEqual(log, ["open:usr_sara"]);
    await key("End"); await key("Enter");
    assert.deepEqual(log, ["open:usr_sara", "footer:add"]);
    await key("Escape");
    assert.equal(log[log.length - 1], "close");
  } finally { g.document.addEventListener = before.add; g.document.removeEventListener = before.rem; restore(); }
});
