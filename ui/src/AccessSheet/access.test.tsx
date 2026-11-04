// ui/AccessSheet: the states of the one Add and Share sheet, drawn and pressed. Pure words and contract inputs are in model.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dimensions } from "react-native";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../testing/dom.ts";
import type { Node } from "../testing/dom.ts";
import { AccessSheet, frozenAddSheetProps, frozenShareSheetProps } from "./index.tsx";
import type { AccessPick, AddSheetProps, ShareSheetProps } from "./index.tsx";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const ssr = (el: Parameters<typeof renderToStaticMarkup>[0]): string => clean(renderToStaticMarkup(el));
const key = (k: string) => ({ key: k, nativeEvent: { key: k }, target: { blur() {} }, stopPropagation() {}, preventDefault() {}, isDefaultPrevented: () => false });
async function keyDown(n: Node | null, k: string): Promise<void> {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props["onKeyDown"] as (e: unknown) => void)(key(k)); });
  await flush();
}
async function withDom(run: () => Promise<void>): Promise<void> {
  const restore = installDom();
  try { await run(); } finally { restore(); }
}
async function onPhone(width: number, run: () => Promise<void> | void): Promise<void> {
  const before = Dimensions.get("window");
  Dimensions.set({ window: { ...before, width, height: 844 } });
  try { await run(); } finally { Dimensions.set({ window: before }); }
}

const add = (over: Partial<AddSheetProps> = {}): AddSheetProps => ({ ...frozenAddSheetProps, ...over });
const share = (over: Partial<ShareSheetProps> = {}): ShareSheetProps => ({ ...frozenShareSheetProps, ...over });
const sharePeople = {
  suggested: [],
  people: [{ id: "usr_sara", name: "Sara Malik", sub: "Space member", kind: "person" as const }, { id: "usr_omar", name: "Omar Reyes", sub: "Space member", kind: "person" as const }],
  groups: [{ id: "grp_fin", name: "Finance", sub: "Group", kind: "group" as const }],
  agents: [{ id: "agt_docs", name: "Docs", kind: "agent" as const }],
  outside: [{ id: "out_cc", name: "Claude Code", kind: "outside" as const }],
  space: frozenShareSheetProps.directory.space,
};

/* ---------- add mode: the empty sheet ---------- */

test("add, empty: title, search, the two makers right under it, then the sections in order", () => {
  const html = ssr(<AccessSheet {...add()} />);
  assert.match(html, /Add people and agents/);
  assert.match(html, /to Upload contract/);
  assert.match(html, /placeholder="Add people or agents"/);
  assert.match(html, /role="dialog"/);
  const order = ["New agent for this chat", "Link an outside agent", "Suggested", "People", "Agents", "Your outside agents", "Here now"].map((s) => html.indexOf(s));
  assert.ok(order.every((n) => n >= 0), `all present ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "in the order the sheet draws them");
  assert.match(html, /Yours, private to you/);
  assert.match(html, /Assistant/);
  assert.match(html, /Shown to others as “Irfad \(Agent\)”/);
  assert.match(html, /Pick who to add\. You will see what they get before you confirm\./);
  assert.match(html, /aria-label="Poke Docs"/, "Poke on a sheet agent row");
  assert.match(html, /aria-label="Poke Mira"/, "Poke on a Here now row");
  assert.match(html, /aria-label="How and when it responds"/, "the gear on a Here now agent");
  assert.doesNotMatch(html, /—|§/);
});

test("add, no outside agent connected", () => {
  const html = ssr(<AccessSheet {...add({ directory: { ...frozenAddSheetProps.directory, outside: [] } })} />);
  assert.match(html, /No outside agent connected yet\./);
});

test("the main button is off until someone is picked", () => {
  const html = ssr(<AccessSheet {...add()} />);
  assert.match(html, /<[^>]*aria-disabled="true"[^>]*aria-label="Add"/);
});

/* ---------- add mode: typing, picking, roles ---------- */

test("typing narrows the lists, an address offers a guest invite, Enter adds the top match", async () => {
  await withDom(async () => {
    const root = await mount(createRoot, <AccessSheet {...add()} />);
    await typeInto(find(root, "as-search"), "om");
    assert.match(textOf(root), /Omar Reyes/);
    assert.doesNotMatch(textOf(root), /Docs/);
    await keyDown(find(root, "as-search"), "Enter");
    assert.ok(find(root, "as-chip-person:usr_omar"), "Omar is a chip");
    assert.ok(find(root, "as-pick-person:usr_omar"), "and an Adding row");
    assert.match(textOf(find(root, "as-add")), /Add Omar/);
    await typeInto(find(root, "as-search"), "dana@fox-legal.com");
    assert.match(textOf(root), /Invite dana@fox-legal.com as a guest/);
    assert.match(textOf(root), /Sees only what this chat allows/);
    await keyDown(find(root, "as-search"), "Enter");
    assert.ok(find(root, "as-pick-guest:dana@fox-legal.com"));
    assert.match(textOf(find(root, "as-pick-guest:dana@fox-legal.com")), /Guest, by email/);
    assert.match(textOf(find(root, "as-add")), /Add Omar and dana@fox-legal.com/);
  });
});

test("Backspace on an empty search removes the last chip; Enter on an empty search with picks adds them", async () => {
  await withDom(async () => {
    const calls: { picks: AccessPick[]; earlier: boolean }[] = [];
    let closed = 0;
    const root = await mount(createRoot, <AccessSheet {...add({ onAdd: (picks, o) => calls.push({ picks: [...picks], earlier: o.earlier }), onClose: () => { closed++; } })} />);
    await press(find(root, "as-row-person:usr_sara"));
    await press(find(root, "as-row-agent:agt_docs"));
    assert.ok(find(root, "as-chip-agent:agt_docs"));
    await keyDown(find(root, "as-search"), "Backspace");
    assert.equal(find(root, "as-chip-agent:agt_docs"), null, "the last chip went");
    assert.ok(find(root, "as-chip-person:usr_sara"), "the one before stays");
    await keyDown(find(root, "as-search"), "Backspace");
    assert.equal(find(root, "as-chip-person:usr_sara"), null);
    await press(find(root, "as-row-person:usr_omar"));
    await keyDown(find(root, "as-search"), "Enter");
    assert.equal(calls.length, 1, "Enter on an empty search with a pick adds");
    assert.deepEqual(calls[0]?.picks.map((p) => p.id), ["usr_omar"]);
    assert.equal(closed, 1);
  });
});

test("two picks with roles: a person can be a member or a viewer; the line says what they get; the earlier switch changes it", async () => {
  await withDom(async () => {
    const got: AccessPick[][] = [];
    const root = await mount(createRoot, <AccessSheet {...add({ onAdd: (p) => got.push([...p]) })} />);
    await press(find(root, "as-row-person:usr_sara"));
    await press(find(root, "as-row-agent:agt_docs"));
    assert.match(textOf(find(root, "as-add")), /Add Sara and Docs/);
    assert.match(textOf(find(root, "as-line-std")), /They'll see this chat's messages from now on, its files folder Portal uploads, and records in Clients\./);
    await press(find(root, "as-role-person:usr_sara"));
    await press(find(root, "menu-item-Can view"));
    assert.match(textOf(find(root, "as-pick-person:usr_sara")), /Can view/);
    await press(find(root, "as-earlier"));
    assert.match(textOf(find(root, "as-line-std")), /from the start/);
    await press(find(root, "as-add"));
    assert.equal(got.length, 1);
    assert.deepEqual(got[0]?.map((p) => [p.id, p.role]), [["usr_sara", "view"], ["agt_docs", ""]]);
  });
});

test("a viewer can add viewers only: Member is greyed and says why", async () => {
  await withDom(async () => {
    const root = await mount(createRoot, <AccessSheet {...add({ maxLevel: "view" })} />);
    await press(find(root, "as-row-person:usr_sara"));
    assert.match(textOf(find(root, "as-pick-person:usr_sara")), /Can view/);
    assert.match(textOf(find(root, "as-line-limited")), /You can view here, so you can add people as viewers only\. A person can give only what they have\./);
    await press(find(root, "as-role-person:usr_sara"));
    assert.match(textOf(find(root, "menu-item-Member (you do not have this)")), /Member \(you do not have this\)/);
  });
});

test("an outside agent says how it shows and what it reads; it cannot be the lead", async () => {
  await withDom(async () => {
    const root = await mount(createRoot, <AccessSheet {...add()} />);
    await press(find(root, "as-row-outside:out_cc"));
    assert.match(textOf(find(root, "as-pick-outside:out_cc")), /Claude Code . shows as Irfad \(Agent\)/);
    assert.match(textOf(find(root, "as-line-out-out_cc")), /Claude Code reads and posts in this chat and reads its folder and the records folder, through MCP tools scoped to exactly these, never wider\. It shows as Irfad \(Agent\), is audited, and removing it ends access at once\./);
    await press(find(root, "as-settings-outside:out_cc"));
    assert.ok(find(root, "as-how-tag") && find(root, "as-how-listen"));
    assert.equal(find(root, "as-how-lead"), null);
  });
});

/* ---------- the settings popover ---------- */

test("the settings popover: How, When with topics and hours, Style, Poke and the poke note", async () => {
  await withDom(async () => {
    const poked: string[] = [];
    const root = await mount(createRoot, <AccessSheet {...add({ onPoke: (id) => poked.push(id) })} />);
    await press(find(root, "as-row-agent:agt_docs"));
    assert.match(textOf(find(root, "as-summary-agent:agt_docs")), /Answers when tagged . Always . Keep replies short/);
    await press(find(root, "as-settings-agent:agt_docs"));
    assert.ok(find(root, "as-pop"));
    for (const id of ["as-how-lead", "as-how-tag", "as-how-listen", "as-when-always", "as-when-topics", "as-when-hours", "as-style-short", "as-style-full"]) assert.ok(find(root, id), id);
    assert.match(textOf(find(root, "as-pop")), /A poke starts one turn now\. Docs reads the last 12 messages and tool calls, answers whoever poked, and can read further back with a tool\. It reads only what the poker can read\./);
    await press(find(root, "as-when-topics"));
    const topics = find(root, "as-topics");
    assert.equal(topics?.props["placeholder"], "A few words, for example invoices, billing");
    await typeInto(topics, "invoices, billing");
    await press(find(root, "as-how-lead"));
    await press(find(root, "as-style-full"));
    assert.match(textOf(find(root, "as-summary-agent:agt_docs")), /Answers everything . Only on invoices, billing . Full detail/);
    await press(find(root, "as-when-hours"));
    assert.ok(find(root, "as-from") && find(root, "as-to"));
    await press(find(root, "as-pop-poke"));
    assert.deepEqual(poked, ["agt_docs"]);
    await press(find(root, "as-pop-done"));
    assert.equal(find(root, "as-pop"), null);
  });
});

test("the same popover opens from the gear on a Here now agent and reports the new settings", async () => {
  await withDom(async () => {
    const saved: { id: string; how: string; when: string }[] = [];
    const root = await mount(createRoot, <AccessSheet {...add({ onAgentSettings: (id, s) => saved.push({ id, how: s.how, when: s.when }) })} />);
    await press(find(root, "as-gear-agt_mira"));
    assert.ok(find(root, "as-pop"));
    await press(find(root, "as-how-listen"));
    assert.deepEqual(saved.at(-1), { id: "agt_mira", how: "listen", when: "always" });
  });
});

test("Poke on every agent row calls onPoke with the agent id", async () => {
  await withDom(async () => {
    const poked: string[] = [];
    const root = await mount(createRoot, <AccessSheet {...add({ onPoke: (id) => poked.push(id) })} />);
    await press(find(root, "as-poke-agt_docs"));
    await press(find(root, "as-here-poke-agt_mira"));
    await press(find(root, "as-row-agent:agt_docs"));
    await press(find(root, "as-poke-agt_docs"));
    assert.deepEqual(poked, ["agt_docs", "agt_mira", "agt_docs"]);
  });
});

/* ---------- the New agent view and the Link view ---------- */

test("New agent for this chat: name, one line, model from props, the note; Create and pick adds a chat agent", async () => {
  await withDom(async () => {
    const got: AccessPick[][] = [];
    const root = await mount(createRoot, <AccessSheet {...add({ onAdd: (p) => got.push([...p]) })} />);
    await press(find(root, "as-new"));
    assert.ok(find(root, "as-new-view"));
    assert.match(textOf(root), /New agent for this chat/);
    assert.match(textOf(root), /Use me for/);
    assert.match(textOf(root), /It belongs to the chat\. When the chat goes, it goes too, like a teammate\./);
    assert.equal(find(root, "as-create")?.props["aria-disabled"], true, "off until it has a name");
    await typeInto(find(root, "as-name"), "Checker");
    await typeInto(find(root, "as-brief"), "Checks every upload against the spec");
    await press(find(root, "as-model"));
    for (const m of ["Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "GPT-5 Codex"]) assert.ok(find(root, `menu-item-${m}`), m);
    await press(find(root, "menu-item-Opus 5.5"));
    await press(find(root, "as-create"));
    assert.equal(find(root, "as-new-view"), null, "back on the list");
    assert.ok(find(root, "as-pick-new:1"));
    assert.match(textOf(find(root, "as-pick-new:1")), /New . Opus 5\.5/);
    assert.match(textOf(find(root, "as-line-new")), /Checker belongs to the chat and is removed with it\./);
    await press(find(root, "as-add"));
    assert.deepEqual(got[0]?.map((p) => [p.kind, p.name, p.brief, p.model]), [["new", "Checker", "Checks every upload against the spec", "Opus 5.5"]]);
  });
});

test("Link an outside agent: three steps, the exact command, Copy, and the waiting then connected state", async () => {
  await withDom(async () => {
    const copied: number[] = [];
    const command = "claude mcp add --transport http vyre https://northwind.vyre.run/mcp";
    const root = await mount(createRoot, <AccessSheet {...add({ link: { command, onCopy: () => copied.push(1) } })} />);
    await press(find(root, "as-link"));
    assert.ok(find(root, "as-link-view"));
    const text = textOf(root);
    for (const s of ["Open the agent you use", "Run this once in its terminal", "Allow it in Vyre", "Waiting for a connection..."]) assert.ok(text.includes(s), s);
    assert.equal(textOf(find(root, "as-command")), command);
    await press(find(root, "as-copy"));
    assert.deepEqual(copied, [1]);
    assert.match(textOf(find(root, "as-copy")), /Copied/);
    assert.equal(find(root, "as-connected"), null);
  });
  const html = ssr(<AccessSheet {...add({ link: { command: "x", connected: "Claude Code" } })} />);
  assert.doesNotMatch(html, /as-connected/, "the list view, not the link view");
});

test("Link view connected", async () => {
  await withDom(async () => {
    const root = await mount(createRoot, <AccessSheet {...add({ link: { command: "x", connected: "Claude Code" } })} />);
    await press(find(root, "as-link"));
    assert.match(textOf(find(root, "as-connected")), /Claude Code connected\. Pick it from the list\./);
    assert.equal(find(root, "as-waiting"), null);
    assert.match(textOf(find(root, "as-back2")), /Back to the list/);
  });
});

/* ---------- Escape ---------- */

test("Escape leaves the popover, then a sub-view, then closes the sheet", async () => {
  await withDom(async () => {
    let closed = 0;
    const root = await mount(createRoot, <AccessSheet {...add({ onClose: () => { closed++; } })} />);
    await press(find(root, "as-new"));
    assert.ok(find(root, "as-new-view"));
    await keyDown(find(root, "as-sheet"), "Escape");
    assert.equal(find(root, "as-new-view"), null, "left the sub-view");
    assert.equal(closed, 0);
    await press(find(root, "as-row-agent:agt_docs"));
    await press(find(root, "as-settings-agent:agt_docs"));
    await keyDown(find(root, "as-sheet"), "Escape");
    assert.equal(find(root, "as-pop"), null, "left the popover first");
    assert.equal(closed, 0);
    await keyDown(find(root, "as-sheet"), "Escape");
    assert.equal(closed, 1, "then closed");
  });
});

/* ---------- phone ---------- */

test("a phone: a bottom sheet, the main button reads Add 3, role controls sit under the name", async () => {
  await onPhone(390, async () => {
    await withDom(async () => {
      const root = await mount(createRoot, <AccessSheet {...add({ density: "compact" })} />);
      for (const k of ["person:usr_sara", "person:usr_omar", "agent:agt_docs"]) await press(find(root, `as-row-${k}`));
      assert.match(textOf(find(root, "as-add")), /^\s*Add 3\s*$/);
      assert.equal(find(root, "as-sheet")?.props["data-sheet"], "phone", "a bottom sheet");
    });
  });
  const wide = ssr(<AccessSheet {...add()} />);
  assert.match(wide, /data-sheet="card"/, "a centred card on a wide window");
});

/* ---------- share mode ---------- */

test("share a note: title, subtitle, who has access, and the level choices come from the type", () => {
  const html = ssr(<AccessSheet {...share({ itemType: "note", itemName: "Lab 8 run of show", resourceType: "file", resourceId: "n1", directory: sharePeople })} />);
  assert.match(html, /Share “Lab 8 run of show”/);
  assert.match(html, /Note · 2 with access/);
  assert.match(html, /General access/);
  assert.match(html, /Owner/);
  assert.match(html, /aria-label="Level for Omar Reyes: Can edit"/);
  assert.match(html, /Anyone in the Space/);
  assert.match(html, /placeholder="Add people, groups or agents"/);
  assert.match(html, /Groups and roles/);
  assert.match(html, /Pick who to share with\./);
});

test("share, picks: levels, what they get, the Share button", async () => {
  await withDom(async () => {
    const shared: unknown[] = [];
    let closed = 0;
    const root = await mount(createRoot, <AccessSheet {...share({ itemType: "file", itemName: "Q4 invoices", resourceType: "folder", resourceId: "fld_q4", directory: sharePeople, newKey: () => "key-1", onShare: (i) => shared.push(i), onClose: () => { closed++; } })} />);
    await press(find(root, "as-row-person:usr_sara"));
    await press(find(root, "as-role-person:usr_sara"));
    for (const l of ["Can view", "Can edit", "Can manage"]) assert.ok(find(root, `menu-item-${l}`), l);
    await press(find(root, "menu-item-Can edit"));
    assert.match(textOf(find(root, "as-line-lv-edit")), /Sara Malik can view and edit “Q4 invoices”\./);
    assert.match(textOf(find(root, "as-line-tail")), /Everything inside comes with it, including new files\./);
    assert.match(textOf(find(root, "as-add")), /Share with Sara/);
    await press(find(root, "as-add"));
    assert.deepEqual(shared, [{ resource: { type: "folder", id: "fld_q4" }, subject: { kind: "person", id: "usr_sara" }, level: "edit", idempotencyKey: "key-1" }]);
    assert.equal(closed, 1);
  });
});

test("share, the Space row and an email: the Space is a group grant; a guest is invited", async () => {
  await withDom(async () => {
    const shared: { subject: unknown }[] = [];
    const guests: unknown[] = [];
    const root = await mount(createRoot, <AccessSheet {...share({ itemType: "note", directory: sharePeople, onShare: (i) => shared.push(i), onInviteGuest: (g) => guests.push(g) })} />);
    await press(find(root, "as-row-space:space"));
    await typeInto(find(root, "as-search"), "joe@weinbergerlaw.com");
    assert.match(textOf(root), /Sees only this note/);
    await keyDown(find(root, "as-search"), "Enter");
    assert.match(textOf(find(root, "as-line-guests")), /joe@weinbergerlaw.com sees only this note, never what is around it\./);
    assert.match(textOf(find(root, "as-line-space")), /Anyone in the Space can find it from search\./);
    await press(find(root, "as-add"));
    assert.deepEqual(shared.map((s) => s.subject), [{ kind: "group", id: "space" }]);
    assert.deepEqual(guests, [{ email: "joe@weinbergerlaw.com", level: "view" }]);
  });
});

test("share a Vault item: use without seeing is the first level and the line says the value stays hidden", async () => {
  await withDom(async () => {
    const root = await mount(createRoot, <AccessSheet {...share({ itemType: "vault", itemName: "GHL API key", resourceType: "vault_item", resourceId: "v1", directory: sharePeople })} />);
    await press(find(root, "as-row-person:usr_sara"));
    assert.match(textOf(find(root, "as-role-person:usr_sara")), /Can use without seeing/);
    assert.match(textOf(find(root, "as-line-lv-use")), /Sara Malik can use “GHL API key” in actions without seeing its value\./);
    assert.match(textOf(find(root, "as-line-tail")), /The value is never shown or sent in chat to anyone who can only use it\./);
  });
});

test("share a record type: its own level words", () => {
  const html = ssr(<AccessSheet {...share({ itemType: "rtype", itemName: "Clients", resourceType: "record_type", resourceId: "rt1", shares: [{ subjectKind: "person", subjectId: "p1", name: "Omar Reyes", level: "manage", via: "grant", fromFolderId: null }], directory: sharePeople })} />);
  assert.match(html, /aria-label="Level for Omar Reyes: Can manage the type"/);
  assert.match(html, /Record type · 2 with access/);
});

test("share an agent: four levels, no agents or outside agents as recipients, the pays-with-their-own-account note, the four levels with nobody picked", async () => {
  const html = ssr(<AccessSheet {...share({ itemType: "agent", itemName: "Ember", resourceType: "agent", resourceId: "agt_ember", directory: sharePeople, shares: [] })} />);
  assert.doesNotMatch(html, /Claude Code/);
  assert.doesNotMatch(html, /aria-label="Share with Docs"/);
  assert.match(html, /placeholder="Add people or groups"/);
  assert.doesNotMatch(html, /Can chat with: talk to Ember/, "no legend paragraph");
  await withDom(async () => {
    const root = await mount(createRoot, <AccessSheet {...share({ itemType: "agent", itemName: "Ember", resourceType: "agent", resourceId: "agt_ember", directory: sharePeople, shares: [] })} />);
    await press(find(root, "as-row-person:usr_omar"));
    await press(find(root, "as-role-person:usr_omar"));
    for (const l of ["Can chat with", "Can use in their work", "Can edit", "Can manage"]) assert.ok(find(root, `menu-item-${l}`), l);
    await press(find(root, "menu-item-Can use in their work"));
    assert.match(textOf(find(root, "as-line-lv-use")), /Omar Reyes can use Ember in their automations, tasks and crews, on their own account\./);
    assert.match(textOf(find(root, "as-line-pays")), /Whoever uses Ember pays with their own AI account\. Ember reaches for them only what they can reach themselves\./);
    await typeInto(find(root, "as-search"), "a@b.co");
    await press(find(root, "as-invite"));
    assert.match(textOf(find(root, "as-pick-guest:a@b.co")), /Can chat with/, "a guest gets the first level only");
  });
});

test("sharing is capped at what the giver holds: higher levels are greyed with the words", async () => {
  await withDom(async () => {
    const root = await mount(createRoot, <AccessSheet {...share({ itemType: "note", directory: sharePeople, maxLevel: "edit" })} />);
    await press(find(root, "as-row-person:usr_sara"));
    await press(find(root, "as-role-person:usr_sara"));
    assert.ok(find(root, "menu-item-Can manage (you do not have this)"));
    assert.ok(find(root, "menu-item-Can edit"));
    assert.match(textOf(find(root, "as-line-tail")), /You can give only what you have yourself\.$/);
  });
});

test("a person's own Assistant cannot be shared: a plain notice with Close and New agent", async () => {
  const html = ssr(<AccessSheet {...share({ itemType: "agent", itemKind: "assistant", itemName: "Assistant", directory: sharePeople, shares: [] })} />);
  assert.match(html, /Your Assistant can't be shared\. It holds your sign-ins, your memory and what you ask it, and only you see those\./);
  assert.match(html, /To give others an agent like it, make a new agent for the Space and share that one\./);
  assert.doesNotMatch(html, /Who has access/);
  assert.doesNotMatch(html, /placeholder=/);
  await withDom(async () => {
    let closed = 0;
    let made = 0;
    const root = await mount(createRoot, <AccessSheet {...share({ itemType: "agent", itemKind: "assistant", itemName: "Assistant", directory: sharePeople, shares: [], onClose: () => { closed++; }, onNewAgent: () => { made++; } })} />);
    await press(find(root, "as-close2"));
    await press(find(root, "as-newagent"));
    assert.deepEqual([closed, made], [1, 1]);
  });
});

test("who has access: change level, remove, inherited rows cannot be lowered or removed", async () => {
  await withDom(async () => {
    const said: unknown[] = [];
    const gone: unknown[] = [];
    const root = await mount(createRoot, <AccessSheet {...share({
      itemType: "note", resourceType: "file", resourceId: "n1", directory: sharePeople, folderName: "Clients", target: "item",
      shares: [
        { subjectKind: "person", subjectId: "p_omar", name: "Omar Reyes", level: "edit", via: "grant", fromFolderId: null },
        { subjectKind: "person", subjectId: "p_kai", name: "Kai Lund", level: "edit", via: "folder", fromFolderId: "fld_clients" },
      ],
      onShare: (i) => said.push(i), onUnshare: (i) => gone.push(i),
    })} />);
    assert.match(textOf(root), /From the folder Clients/);
    assert.doesNotMatch(textOf(root), /never lowered/, "no legend paragraph");
    assert.equal(find(root, "as-acc-remove-p_kai"), null, "inherited: no remove");
    await press(find(root, "as-acc-level-p_kai"));
    assert.equal(find(root, "menu-item-Can view"), null, "inherited: cannot be lowered");
    assert.ok(find(root, "menu-item-Can manage"));
    await press(find(root, "menu-item-Can manage"));
    await press(find(root, "as-acc-level-p_omar"));
    await press(find(root, "menu-item-Can view"));
    assert.deepEqual(said.map((s) => (s as { subject: { id: string }; level: string }).level), ["manage", "view"]);
    await press(find(root, "as-acc-remove-p_omar"));
    assert.deepEqual(gone, [{ resource: { type: "file", id: "n1" }, subject: { kind: "person", id: "p_omar" } }]);
    assert.equal(find(root, "as-acc-remove-p_omar"), null, "the row is gone");
  });
});

test("the link row and the sees box are kept", async () => {
  await withDom(async () => {
    const said: unknown[] = [];
    let copied = 0;
    const root = await mount(createRoot, <AccessSheet {...share({ itemType: "file", directory: sharePeople, allowExternal: true, onShare: (i) => said.push(i), onCopyLink: () => { copied++; }, sees: [{ name: "Kai Lund", via: "Finance", level: "View" }] })} />);
    assert.match(textOf(root), /No link/);
    assert.match(textOf(root), /Who sees this/);
    await press(find(root, "as-link-toggle"));
    assert.deepEqual((said[0] as { subject: unknown; level: string }).subject, { kind: "link", id: "public" });
    assert.equal((said[0] as { level: string }).level, "view");
  });
  const withLink = ssr(<AccessSheet {...share({ itemType: "file", directory: sharePeople, allowExternal: true, onCopyLink: () => undefined, shares: [{ subjectKind: "link", subjectId: "public", name: "Public", level: "view", via: "grant", fromFolderId: null }] })} />);
  assert.match(withLink, /Anyone with the link/);
  assert.match(withLink, /aria-label="Copy link"/);
  assert.match(withLink, /Can view\. Outside the Space\./);
});

test("records mode is kept: audience, Can export and Can share with others, exporters", async () => {
  await withDom(async () => {
    const flags: string[] = [];
    const aud: string[] = [];
    const root = await mount(createRoot, <AccessSheet {...share({
      itemType: "record", itemName: "Dana Fox", resourceType: "record", resourceId: "r1", directory: sharePeople,
      shares: [{ subjectKind: "person", subjectId: "p_omar", name: "Omar Reyes", level: "edit", via: "grant", fromFolderId: null, canExport: true }],
      records: { audience: "added", onAudience: (a) => aud.push(a), exporters: "chosen", onExporters: () => undefined, onFlag: (_r, f, on) => flags.push(`${f}:${on}`), canChange: true, subtitle: "Record in Clients" },
    })} />);
    assert.match(textOf(root), /Record in Clients/);
    assert.match(textOf(root), /Admins/);
    assert.equal(find(root, "as-export-p_omar")?.props["aria-checked"], true);
    await press(find(root, "as-reshare-p_omar"));
    await press(find(root, "as-audience-pick-me"));
    assert.deepEqual(flags, ["reshare:true"]);
    assert.deepEqual(aud, ["me"]);
    assert.match(textOf(find(root, "as-more")), /Export: Chosen people/);
    assert.match(textOf(find(root, "as-acc-level-p_omar")), /Can edit/);
  });
});

test("share, phone: a bottom sheet and a short button", async () => {
  await onPhone(390, async () => {
    await withDom(async () => {
      const root = await mount(createRoot, <AccessSheet {...share({ density: "compact", itemType: "note", directory: sharePeople })} />);
      for (const k of ["person:usr_sara", "group:grp_fin", "space:space"]) await press(find(root, `as-row-${k}`));
      assert.match(textOf(find(root, "as-add")), /^\s*Share 3\s*$/);
      assert.equal(find(root, "as-sheet")?.props["data-sheet"], "phone");
    });
  });
});

/* ---------- Dex's Share sheet (owner, 4 Nov): one clean list ---------- */

const dex = (over: Partial<ShareSheetProps> = {}): ShareSheetProps => share({
  itemType: "agent", itemName: "Dex", resourceType: "agent", resourceId: "agt_dex", ownerId: "usr_me", ownerName: "Irfad", spaceName: "Northwind", directory: sharePeople,
  shares: [
    { subjectKind: "person", subjectId: "usr_me", name: "Irfad", level: "manage", via: "folder", fromFolderId: null },
    { subjectKind: "agent", subjectId: "agt_dex", name: "Dex", level: "edit", via: "space", fromFolderId: null },
    { subjectKind: "agent", subjectId: "agt_docs", name: "Docs", level: "edit", via: "space", fromFolderId: null },
    { subjectKind: "agent", subjectId: "agt_aliza", name: "Aliza Rizvi (Agent)", level: "edit", via: "space", fromFolderId: null, privateAgent: true },
    { subjectKind: "group", subjectId: "grp_everyone", name: "Everyone", level: "use", via: "grant", fromFolderId: null },
  ],
  ...over,
});

test("Dex: an item never lists itself, the owner is one row, and no one else's private agent is named", () => {
  const html = ssr(<AccessSheet {...dex()} />);
  assert.equal((html.match(/>Irfad</g) ?? []).length + (html.match(/title="Irfad"/g) ?? []).length >= 1, true);
  assert.doesNotMatch(html, /aria-label="Level for Dex/, "no self row");
  assert.doesNotMatch(html, /Aliza Rizvi/, "no private agent by name");
  assert.doesNotMatch(html, /Level for Irfad/, "the owner is the Owner row, not a level row");
  assert.equal((html.match(/Owner/g) ?? []).length, 1);
});

test("Dex: general access is one row at the top, and the folder words stay true", () => {
  const html = ssr(<AccessSheet {...dex()} />);
  assert.match(html, /Everyone in Northwind/);
  assert.ok(html.indexOf("General access") < html.indexOf("People"), "general access above the people");
  assert.match(html, /Can use/);
  assert.doesNotMatch(html, /Not in a folder/);
  assert.doesNotMatch(html, /From the folder/, "an item with no folder says the Space");
  assert.match(html, /Other agents can hand work to it/);
  const inherited = ssr(<AccessSheet {...dex({ shares: [{ subjectKind: "person", subjectId: "usr_kai", name: "Kai Lund", level: "edit", via: "space", fromFolderId: null }] })} />);
  assert.match(inherited, /From the Space/, "inherited access says the Space when there is no folder");
  assert.doesNotMatch(inherited, /From the folder|Nobody else yet/);
  assert.doesNotMatch(html, /Nobody else yet/);
  assert.doesNotMatch(html, /never lowered|open it and use it/i, "no legend");
});

test("Dex: agents get one line, with On or Off", () => {
  const html = ssr(<AccessSheet {...dex()} />);
  assert.match(html, /Agents in this Space can call Dex/);
  assert.match(html, /On/);
  const off = ssr(<AccessSheet {...dex({ shares: [] })} />);
  assert.match(off, /Agents in this Space can call Dex/);
  assert.match(off, /Off/);
  assert.match(off, /Nobody else yet/, "truly empty");
});

test("Dex: agents added on purpose show; the line flips through onAgents", async () => {
  await withDom(async () => {
    const flips: boolean[] = [];
    const root = await mount(createRoot, <AccessSheet {...dex({
      shares: [{ subjectKind: "agent", subjectId: "agt_scout", name: "Scout", level: "use", via: "grant", fromFolderId: null }], onAgents: (on) => flips.push(on),
    })} />);
    assert.match(textOf(root), /Scout/);
    await press(find(root, "as-agents-toggle"));
    assert.deepEqual(flips, [false]);
  });
});

test("Dex: a level picker describes each option inside its menu", async () => {
  await withDom(async () => {
    const root = await mount(createRoot, <AccessSheet {...dex()} />);
    await press(find(root, "as-acc-level-space"));
    assert.match(textOf(root), /Chat with it|Give it tasks|Change how it works/);
    assert.match(textOf(root), /No access/);
  });
});

test("Dex: the count in the subtitle is the deduped list", () => {
  const html = ssr(<AccessSheet {...dex()} />);
  // owner + everyone (the general row); Dex itself, the private agent and the owner's repeat do not count
  assert.match(html, /Agent · 2 with access/);
});

test("Dex: the agents line follows the server's answer and flips through onAgents", async () => {
  await withDom(async () => {
    const flips: boolean[] = [];
    const root = await mount(createRoot, <AccessSheet {...dex({ shares: [], agentsOn: false, onAgents: (on) => flips.push(on) })} />);
    assert.match(textOf(root), /Off/);
    await press(find(root, "as-agents-toggle"));
    assert.deepEqual(flips, [true]);
  });
  assert.match(ssr(<AccessSheet {...dex({ shares: [], agentsOn: true })} />), /On/);
});

test("a person gives no more than they have: a level above maxLevel is not in a row's menu", async () => {
  await withDom(async () => {
    const said: unknown[] = [];
    const root = await mount(createRoot, <AccessSheet {...share({
      itemType: "file", directory: sharePeople, maxLevel: "edit", onShare: (i) => said.push(i),
      shares: [{ subjectKind: "person", subjectId: "p_omar", name: "Omar Reyes", level: "view", via: "grant", fromFolderId: null }],
    })} />);
    await press(find(root, "as-acc-level-p_omar"));
    assert.ok(find(root, "menu-item-Can edit") !== null);
    assert.ok(find(root, "menu-item-Can manage") === null);
  });
});
