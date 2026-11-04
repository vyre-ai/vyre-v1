// The Console rows' right-click menus (lane l-chrome2a): what each row of People, Groups, Roles, Numbers and Domains offers for its state and the person's rights, that each item is one call on the row's own id, and that
// anything which removes asks first in the list.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, press } from "../../../../../ui/src/testing/dom.ts";
import { ObjectList } from "../objects/ObjectList.tsx";
import { domainRowActions, groupRowActions, numberRowActions, personRowActions, roleRowActions } from "../objects/row-menus.ts";
import { createMenuApiB } from "../../places/chats/menus/actions-b.ts";
import type { MenuEntry, MenuItem } from "../../../../../ui/src/Menu/index.tsx";

installDom();
const labels = (e: readonly MenuEntry[]): string[] => e.map((x) => ("separator" in x ? "-" : "head" in x ? `# ${x.head}` : x.label));
const items = (e: readonly MenuEntry[]): MenuItem[] => e.filter((x): x is MenuItem => !("separator" in x) && !("head" in x));
function deps(can: (p: string) => boolean = () => true) {
  const calls: { cap: string; input: any }[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const log: string[] = [];
  const api = createMenuApiB({ call: async (cap: string, input: unknown) => { calls.push({ cap, input: input as never }); return {}; } } as never);
  return { calls, log, d: { api, can, open: () => void log.push("open"), done: (n?: string) => void log.push(`done:${n ?? ""}`), fail: (e: unknown) => void log.push(`fail:${String(e)}`), rename: () => void log.push("rename") } };
}

test("a person's row: Suspend or Reactivate by state, Change Role opens the person, nothing on yourself or the owner, nothing changing without the right", async () => {
  const w = deps();
  const sara = { id: "usr_sara", name: "Sara", status: "active", roles: ["rol_member"] };
  const e = personRowActions(sara, "usr_me", w.d);
  assert.deepEqual(labels(e), ["Copy Name", "-", "Suspend", "Change Role…", "-", "Remove from Space…"]);
  items(e).find((x) => x.label === "Suspend")!.onSelect!();
  await flush();
  assert.deepEqual(w.calls, [{ cap: "members.suspend", input: { personId: "usr_sara" } }]);
  assert.ok(labels(personRowActions({ ...sara, status: "suspended" }, "usr_me", w.d)).includes("Reactivate"));
  assert.deepEqual(labels(personRowActions({ ...sara, id: "usr_me" }, "usr_me", w.d)), ["Copy Name", "-", "Change Role…"]);
  assert.deepEqual(labels(personRowActions({ ...sara, roles: ["rol_owner"] }, "usr_me", w.d)), ["Copy Name"]);
  assert.deepEqual(labels(personRowActions(sara, "usr_me", deps(() => false).d)), ["Copy Name"]);
  items(e).find((x) => x.label === "Change Role…")!.onSelect!();
  assert.ok(w.log.includes("open"));
});

test("a group's row: Add Person opens it, Rename asks for the name, Delete Group is the one call; a built-in group is none of those", async () => {
  const w = deps();
  const e = groupRowActions({ id: "grp_s", name: "Sales", builtIn: false }, w.d);
  assert.deepEqual(labels(e), ["Copy Name", "-", "Add Person…", "Rename…", "-", "Delete Group…"]);
  items(e).find((x) => x.label === "Rename…")!.onSelect!();
  assert.ok(w.log.includes("rename"));
  items(e).find((x) => x.label === "Delete Group…")!.onSelect!();
  await flush();
  assert.deepEqual(w.calls, [{ cap: "access.groups.delete", input: { groupId: "grp_s" } }]);
  assert.deepEqual(labels(groupRowActions({ id: "grp_all", name: "Everyone", builtIn: true }, w.d)), ["Copy Name", "-", "Add Person…"]);
});

test("a role's row: Duplicate clones it, Preview opens it, Delete is last and never for a built-in role or one someone holds", async () => {
  const w = deps();
  const e = roleRowActions({ id: "rol_x", name: "Editor", builtIn: false, holders: 0 }, w.d);
  assert.deepEqual(labels(e), ["Copy Name", "-", "Duplicate", "Preview Changes…", "-", "Delete Role…"]);
  items(e).find((x) => x.label === "Duplicate")!.onSelect!();
  await flush();
  assert.equal(w.calls[0]!.cap, "access.roles.create");
  assert.deepEqual([w.calls[0]!.input.cloneFrom, w.calls[0]!.input.name], ["rol_x", "Editor copy"]);
  assert.ok(!labels(roleRowActions({ id: "rol_admin", name: "Admin", builtIn: true, holders: 1 }, w.d)).some((l) => /Delete/.test(l)));
  const held = items(roleRowActions({ id: "rol_y", name: "Dev", builtIn: false, holders: 2 }, w.d)).at(-1)!;
  assert.deepEqual([held.label, held.disabled], ["Delete Role…", true]);
});

test("a number's and a domain's row: one call each on the row's own id", async () => {
  const w = deps();
  items(numberRowActions({ id: "num_1", name: "Intake", e164: "+14155550123" }, w.d)).find((x) => x.label === "Release Number…")!.onSelect!();
  items(domainRowActions({ id: "dom_1", name: "firm.test" }, w.d)).find((x) => x.label === "Check Now")!.onSelect!();
  items(domainRowActions({ id: "dom_1", name: "firm.test" }, w.d)).find((x) => x.label === "Remove Domain…")!.onSelect!();
  await flush();
  assert.deepEqual(w.calls.map((c) => c.cap), ["telephony.number.release", "mail.domain.check", "mail.domain.remove"]);
  assert.equal(w.calls[0]!.input.numberId, "num_1");
  assert.ok(w.calls[0]!.input.idempotencyKey);
  assert.deepEqual(labels(numberRowActions({ id: "n", name: "n", e164: "+1" }, deps(() => false).d)), ["Copy Number"]);
});

test("in the list a removing item asks first: Delete Group becomes 'Delete Group?' with the choice and Cancel, and nothing is called until it is chosen", async () => {
  const w = deps();
  const actions = groupRowActions({ id: "grp_s", name: "Sales", builtIn: false }, w.d);
  const root = await mount(createRoot as never, <ObjectList rows={[{ id: "g1", title: "Sales", actions }]} selectedId={null} onOpen={() => undefined} empty="none" />);
  await flush();
  const row = find(root as never, "row-object-row-g1") as { props: Record<string, (e: unknown) => void> } | null;
  assert.ok(row && typeof row.props["onContextMenu"] === "function");
  await act(async () => { row!.props["onContextMenu"]!({ preventDefault() {}, clientX: 5, clientY: 5, nativeEvent: {} }); });
  await flush();
  await press(find(root as never, "menu-item-Delete Group…") as never); await flush();
  assert.equal(w.calls.length, 0, "it asked first");
  await press(find(root as never, "menu-item-Delete Group") as never); await flush();
  assert.deepEqual(w.calls.map((c) => c.cap), ["access.groups.delete"]);
});
