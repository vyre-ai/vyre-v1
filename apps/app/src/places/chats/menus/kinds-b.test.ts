// The menus of Vault items, automations, goals, projects, tabs and the Console rows: what each offers for each state and permission, in what order, with which key, and that every item calls what it says.
import test from "node:test";
import assert from "node:assert/strict";
import { automationMenu, consoleComputerMenu, consoleDomainMenu, consoleGroupMenu, consoleNumberMenu, consolePersonMenu, consoleRoleMenu, goalMenu, projectMenu, tabMenu, vaultItemMenu } from "./kinds-b.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";

const rows = (e: readonly MenuEntry[]): MenuItem[] => e.filter((x): x is MenuItem => !("separator" in x) && !("head" in x));
const labels = (e: readonly MenuEntry[]): string[] => e.map((x) => ("separator" in x ? "-" : "head" in x ? `# ${x.head}` : x.label));
const calls: string[] = [];
const rec = (n: string) => (...a: unknown[]): void => { calls.push(a.length ? `${n}:${a.join(",")}` : n); };
/** A `do` object whose every method records its own name. */
const recorder = <T extends object>(names: readonly string[]): T => Object.fromEntries(names.map((n) => [n, rec(n)])) as T;
const dangerLast = (e: readonly MenuEntry[]): void => {
  const r = rows(e);
  const danger = r.filter((x) => x.danger);
  assert.ok(danger.length <= 1, "one danger item");
  if (danger.length === 1) { assert.equal(r.at(-1), danger[0], "danger is last"); assert.ok("separator" in e[e.length - 2]!, "and alone, after a separator"); }
};

// ---- vault item
const vaultDo = recorder<Parameters<typeof vaultItemMenu>[1]>(["open", "edit", "reveal", "copyHandle", "copyName", "share", "markRotated", "usage", "trash"]);
const vaultFacts = (o: Partial<Parameters<typeof vaultItemMenu>[0]> = {}): Parameters<typeof vaultItemMenu>[0] => ({ name: "Stripe key", kind: "key", level: "manage", rotates: true, moveTo: [{ id: "vfl_ops", name: "Ops" }], ...o });
test("vault item: a manager sees the whole menu, danger last; the words follow the level", () => {
  const e = vaultItemMenu(vaultFacts(), { ...vaultDo, move: rec("move") });
  assert.deepEqual(labels(e), ["Edit…", "Reveal Values…", "-", "Copy Handle", "Copy Name", "-", "Share…", "# Move to Folder", "Ops", "-", "Mark as Rotated", "Usage…", "-", "Move to Trash…"]);
  dangerLast(e);
  assert.equal(rows(e).at(-1)!.hint, "⌘⌫");
  const use = labels(vaultItemMenu(vaultFacts({ level: "use", moveTo: [] }), { ...vaultDo, move: rec("move") }));
  assert.deepEqual(use, ["Open", "-", "Copy Handle", "Copy Name"], "use-only: the handle to fill with, never the values");
  assert.deepEqual(labels(vaultItemMenu(vaultFacts({ level: "view", moveTo: [] }), { ...vaultDo, move: rec("move") })), ["Open", "Reveal Values…", "-", "Copy Handle", "Copy Name"], "a viewer may reveal");
  const edit = labels(vaultItemMenu(vaultFacts({ level: "edit" }), { ...vaultDo, move: rec("move") }));
  assert.ok(edit.includes("Edit…") && edit.includes("Mark as Rotated") && !edit.includes("Share…") && !edit.some((x) => /Trash|Move to Folder/.test(x)));
  const card = labels(vaultItemMenu(vaultFacts({ kind: "card", rotates: false }), { ...vaultDo, move: rec("move") }));
  assert.ok(!card.includes("Mark as Rotated") && !card.includes("Usage…"), "rotation and usage are for keys and logins");
  assert.ok(!labels(vaultItemMenu(vaultFacts({ rotates: false }), { ...vaultDo, move: rec("move") })).includes("Mark as Rotated"));
});
test("vault item: every item does what it says", () => {
  calls.length = 0;
  for (const x of rows(vaultItemMenu(vaultFacts(), { ...vaultDo, move: rec("move") }))) x.onSelect?.();
  assert.deepEqual(calls, ["edit", "reveal", "copyHandle", "copyName", "share", "move:vfl_ops", "markRotated", "usage", "trash"]);
});

// ---- automation
const autoDo = recorder<Parameters<typeof automationMenu>[1]>(["open", "run", "test", "makePersonalCopy", "runs", "copyLink", "remove"]);
const autoFacts = (o: Partial<Parameters<typeof automationMenu>[0]> = {}): Parameters<typeof automationMenu>[0] => ({ name: "Lab 7 nurture", enabled: true, space: true, canEdit: true, canRun: true, canDelete: true, failedRuns: 0, group: "Labs", groups: [{ id: "agp_a", name: "Sales" }], ...o });
test("automation: an editor sees the whole menu; the words follow on or off; a member sees Open and the runs", () => {
  const d = { ...autoDo, setEnabled: rec("enabled"), move: rec("move") };
  const e = automationMenu(autoFacts(), d);
  assert.deepEqual(labels(e), ["Open", "Run Now", "Turn Off", "Test…", "Runs", "-", "Make a Personal Copy", "# Move to Group", "Sales", "Out of Its Group", "-", "Copy Link", "-", "Move to Trash…"]);
  dangerLast(e);
  assert.ok(labels(automationMenu(autoFacts({ enabled: false }), d)).includes("Turn On"));
  assert.ok(labels(automationMenu(autoFacts({ failedRuns: 3 }), d)).includes("Runs (3 failed)"));
  const member = labels(automationMenu(autoFacts({ canEdit: false, canRun: false, canDelete: false }), d));
  assert.deepEqual(member, ["Open", "Runs", "-", "Make a Personal Copy", "-", "Copy Link"]);
  assert.ok(!labels(automationMenu(autoFacts({ space: false, group: null, groups: [] }), d)).some((x) => /Personal Copy|Group/.test(x)), "a personal automation has no copy and no group to leave");
});
test("automation: every item does what it says", () => {
  calls.length = 0;
  for (const x of rows(automationMenu(autoFacts(), { ...autoDo, setEnabled: rec("enabled"), move: rec("move") }))) x.onSelect?.();
  assert.deepEqual(calls, ["open", "run", "enabled:false", "test", "runs", "makePersonalCopy", "move:agp_a", "move:", "copyLink", "remove"]);
});

// ---- goal
const goalDo = recorder<Parameters<typeof goalMenu>[1]>(["open", "pause", "resume", "markStuck", "report", "stop", "copyLink"]);
test("goal: Pause or Resume by state, stuck and report only while it runs, Stop last; a member only opens and copies", () => {
  assert.deepEqual(labels(goalMenu({ title: "300 registrations", status: "running", manage: true }, goalDo)), ["Open", "-", "Pause", "Mark Stuck…", "Report Progress…", "-", "Copy Link", "-", "Stop Goal…"]);
  assert.deepEqual(labels(goalMenu({ title: "g", status: "paused", manage: true }, goalDo)), ["Open", "-", "Resume", "Report Progress…", "-", "Copy Link", "-", "Stop Goal…"]);
  assert.deepEqual(labels(goalMenu({ title: "g", status: "stuck", manage: true }, goalDo)), ["Open", "-", "Pause", "Report Progress…", "-", "Copy Link", "-", "Stop Goal…"]);
  assert.deepEqual(labels(goalMenu({ title: "g", status: "done", manage: true }, goalDo)), ["Open", "-", "Copy Link"]);
  assert.deepEqual(labels(goalMenu({ title: "g", status: "running", manage: false }, goalDo)), ["Open", "-", "Copy Link"]);
  dangerLast(goalMenu({ title: "g", status: "running", manage: true }, goalDo));
  calls.length = 0;
  for (const x of rows(goalMenu({ title: "g", status: "running", manage: true }, goalDo))) x.onSelect?.();
  assert.deepEqual(calls, ["open", "pause", "markStuck", "report", "copyLink", "stop"]);
});

// ---- project
const projDo = recorder<Parameters<typeof projectMenu>[1]>(["open", "share", "addPeople", "pinFile", "copyLink"]);
test("project: star by state, Share and Add People for a manager, Pin File for an editor; no Archive", () => {
  const d = { ...projDo, star: rec("star") };
  assert.deepEqual(labels(projectMenu({ title: "Portal", starred: false, manage: true, edit: true }, d)), ["Open", "Star", "-", "Share…", "Add People…", "Pin File…", "-", "Copy Link"]);
  assert.deepEqual(labels(projectMenu({ title: "Portal", starred: true, manage: false, edit: false }, d)), ["Open", "Remove Star", "-", "Copy Link"]);
  assert.ok(!labels(projectMenu({ title: "Portal", starred: false, manage: true, edit: true }, d)).some((x) => /Archive/.test(x)), "nothing behind Archive yet");
  calls.length = 0;
  for (const x of rows(projectMenu({ title: "Portal", starred: false, manage: true, edit: true }, d))) x.onSelect?.();
  assert.deepEqual(calls, ["open", "star:true", "share", "addPeople", "pinFile", "copyLink"]);
});

// ---- tab
const tabDo = recorder<Parameters<typeof tabMenu>[1]>(["close", "closeOthers", "closeRight", "duplicate", "copyLink", "toWindow", "reopen"]);
const tabFacts = (o: Partial<Parameters<typeof tabMenu>[0]> = {}): Parameters<typeof tabMenu>[0] => ({ title: "Rivera", pinned: false, count: 4, toTheRight: 2, item: true, canReopen: true, desktop: true, ...o });
test("tab: the words follow pinned; Close Others and Right only when there are others; Reopen only when one was closed; the window only on desktop", () => {
  const d = { ...tabDo, pin: rec("pin") };
  const e = tabMenu(tabFacts(), d);
  assert.deepEqual(labels(e), ["Close", "Close Other Tabs", "Close Tabs to the Right", "-", "Duplicate", "Copy Link", "Pin Tab", "Move to New Window", "-", "Reopen Closed Tab"]);
  assert.equal(rows(e)[0]!.hint, "⌘W");
  assert.equal(rows(e).at(-1)!.hint, "⇧⌘T");
  assert.ok(labels(tabMenu(tabFacts({ pinned: true }), d)).includes("Unpin Tab"));
  assert.deepEqual(labels(tabMenu(tabFacts({ count: 1, toTheRight: 0, item: false, canReopen: false, desktop: false }), d)), ["Close", "-", "Pin Tab"]);
  assert.ok(!labels(tabMenu(tabFacts({ desktop: false }), d)).includes("Move to New Window"));
  calls.length = 0;
  for (const x of rows(e)) x.onSelect?.();
  assert.deepEqual(calls, ["close", "closeOthers", "closeRight", "duplicate", "copyLink", "pin:true", "toWindow", "reopen"]);
});

// ---- Console rows
test("console person: Suspend or Reactivate by state, no actions on yourself or the owner, Remove last", () => {
  const d = { ...recorder<Parameters<typeof consolePersonMenu>[1]>(["open", "copyName", "suspend", "reactivate", "changeRole", "remove"]) };
  const base = { name: "Sara", manage: true, suspended: false, self: false, owner: false };
  const e = consolePersonMenu(base, d);
  assert.deepEqual(labels(e), ["Open", "Copy Name", "-", "Suspend", "Change Role…", "-", "Remove from Space…"]);
  dangerLast(e);
  assert.ok(labels(consolePersonMenu({ ...base, suspended: true }, d)).includes("Reactivate"));
  assert.deepEqual(labels(consolePersonMenu({ ...base, self: true }, d)), ["Open", "Copy Name", "-", "Change Role…"], "you cannot suspend or remove yourself");
  assert.deepEqual(labels(consolePersonMenu({ ...base, owner: true }, d)), ["Open", "Copy Name", "-"].slice(0, 2), "the owner's role and presence are not changed here");
  assert.deepEqual(labels(consolePersonMenu({ ...base, manage: false }, d)), ["Open", "Copy Name"]);
  calls.length = 0;
  for (const x of rows(e)) x.onSelect?.();
  assert.deepEqual(calls, ["open", "copyName", "suspend", "changeRole", "remove"]);
});
test("console group, role, computer, number and domain: Manage shows the changing items, Remove or Delete is last", () => {
  const g = recorder<Parameters<typeof consoleGroupMenu>[1]>(["open", "copyName", "addPerson", "rename", "remove"]);
  assert.deepEqual(labels(consoleGroupMenu({ name: "Sales", manage: true }, g)), ["Open", "Copy Name", "-", "Add Person…", "Rename…", "-", "Delete Group…"]);
  assert.deepEqual(labels(consoleGroupMenu({ name: "Sales", manage: false }, g)), ["Open", "Copy Name"]);
  dangerLast(consoleGroupMenu({ name: "Sales", manage: true }, g));
  const r = recorder<Parameters<typeof consoleRoleMenu>[1]>(["open", "copyName", "duplicate", "preview", "remove"]);
  assert.deepEqual(labels(consoleRoleMenu({ name: "Editor", manage: true, builtIn: false, holders: 0 }, r)), ["Open", "Copy Name", "-", "Duplicate", "Preview Changes…", "-", "Delete Role…"]);
  assert.ok(!labels(consoleRoleMenu({ name: "Admin", manage: true, builtIn: true, holders: 3 }, r)).some((x) => /Delete/.test(x)), "a built-in role is never deleted");
  const held = rows(consoleRoleMenu({ name: "Editor", manage: true, builtIn: false, holders: 2 }, r)).at(-1)!;
  assert.equal(held.disabled, true);
  assert.match(held.reason ?? "", /2 people hold this role/);
  const c = recorder<Parameters<typeof consoleComputerMenu>[1]>(["open", "copyName", "wake", "sleep", "limits", "takeOver", "remove"]);
  assert.deepEqual(labels(consoleComputerMenu({ name: "Mira's computer", manage: true, asleep: false, takeOver: true }, c)), ["Open", "Copy Name", "-", "Sleep", "Limits…", "Take Over", "-", "Remove Computer…"]);
  assert.deepEqual(labels(consoleComputerMenu({ name: "x", manage: true, asleep: true, takeOver: true }, c)), ["Open", "Copy Name", "-", "Wake", "Limits…", "-", "Remove Computer…"], "an asleep computer is woken, not taken over");
  const n = recorder<Parameters<typeof consoleNumberMenu>[1]>(["open", "copyNumber", "assign", "release"]);
  assert.deepEqual(labels(consoleNumberMenu({ name: "+1 415", manage: true }, n)), ["Open", "Copy Number", "-", "Assign…", "-", "Release Number…"]);
  const m = recorder<Parameters<typeof consoleDomainMenu>[1]>(["open", "copyName", "check", "remove"]);
  assert.deepEqual(labels(consoleDomainMenu({ name: "firm.test", manage: true }, m)), ["Open", "Copy Name", "-", "Check Now", "-", "Remove Domain…"]);
  assert.deepEqual(labels(consoleDomainMenu({ name: "firm.test", manage: false }, m)), ["Open", "Copy Name"]);
  for (const e of [consoleComputerMenu({ name: "x", manage: true, asleep: false, takeOver: false }, c), consoleNumberMenu({ name: "n", manage: true }, n), consoleDomainMenu({ name: "d", manage: true }, m)]) dangerLast(e);
});
