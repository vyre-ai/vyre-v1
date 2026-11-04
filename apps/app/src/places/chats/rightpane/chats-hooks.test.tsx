// Chats right pane > Hooks (lane l-hooks, the approved prototype p-crew): the tab appears where the chat has hooks, groups them by where they come from, and each control (Pause, Resume, Edit with its three
// kinds, Save, Cancel, Remove with Undo) writes through one capability. A Space hook is removed by an admin only. Rendered from the sample Space through the live screen query.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane } from "./ChatRightPane.tsx";
import { hookPause, hookRemove, hookSave } from "./actions.ts";
import type { PaneDeps } from "./actions.ts";
import { countLine, draftOf, grouped, restoreInput, setInput, whatOf } from "./hooks-model.ts";
import type { Hook } from "./hooks-model.ts";
import { tabsOf } from "./model.ts";
import type { TabKey } from "./model.ts";
import { createSample } from "./sample.ts";
import type { Sample } from "./sample.ts";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (s: Sample, tab: TabKey = "hooks"): string => clean(renderToStaticMarkup(<ChatRightPane data={s.data} open onToggle={() => undefined} tab={tab} window={ALL} paneWidth={640} />));
const deps = (s: Sample): { d: PaneDeps; notes: Array<{ text: string; undo?: () => Promise<void> | void }> } => {
  const notes: Array<{ text: string; undo?: () => Promise<void> | void }> = [];
  return { notes, d: { call: s.data.call, note: (text, undo) => notes.push({ text, ...(undo ? { undo } : {}) }) } };
};
const hooksOf = (s: Sample): Hook[] => (s.data.screens.query("chats.right-pane", "hooks", { threadId: s.data.threadId }).getSnapshot() as { data: { hooks: Hook[] } }).data.hooks;

test("the Hooks tab comes last, and only where the chat has hooks", () => {
  assert.deepEqual(tabsOf(false, false, true).map((t) => t.title), ["Computer", "Threads", "Files", "Knows", "Routines", "Hooks"]);
  assert.ok(!html(createSample(), "threads").includes(">Hooks<"), "no hooks, no tab");
  assert.ok(html(createSample("northwind", { hooks: true }), "threads").includes(">Hooks<"));
});

test("the hooks are grouped: this chat, this run and its helpers, the agent everywhere, the Space; each says when, what, and who made it", () => {
  const out = html(createSample("northwind", { hooks: true }));
  const order = ["label-l-chat", "label-l-run", "label-l-agent", "label-l-space"].map((n) => { const i = out.indexOf(`data-testid="${n}"`); assert.ok(i >= 0, n); return i; });
  for (const name of ["This chat", "This run and its helpers", "Intake everywhere"]) assert.ok(out.includes(name), name);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const needle of ["Before anything leaves Vyre", "Ask a quick check", "Check the address is in Contacts", "Run a script", "format-changed.sh", "4 in this chat, 0 paused"]) assert.ok(out.includes(needle), needle);
  assert.ok(out.includes("Intake can add its own hooks") || out.includes("can add its own hooks"), "the foot says who may add hooks");
  assert.deepEqual(grouped(hooksOf(createSample("northwind", { hooks: true })), "Intake").map((g) => g.key), ["chat", "run", "agent", "space"]);
  assert.equal(countLine([]), "0 in this chat, 0 paused");
});

test("an empty chat says so", () => {
  assert.ok(html(createSample(), "hooks").includes("No hooks here."));
});

test("Pause turns a hook off and Resume back on, each through hooks.pause, and the card says Paused", async () => {
  const s = createSample("northwind", { hooks: true });
  const { d, notes } = deps(s);
  assert.ok(html(s).includes('data-testid="hook-pause-hok_chat"'));
  assert.equal(await hookPause(d, "hok_chat", s.data.threadId, true), true);
  assert.equal(notes.at(-1)?.text, "Hook paused");
  assert.ok(html(s).includes("Paused") && html(s).includes(">Resume<"));
  await hookPause(d, "hok_chat", s.data.threadId, false);
  assert.equal(notes.at(-1)?.text, "Hook running again");
  assert.ok(!html(s).includes("· Paused"));
  s.failNext("hooks.pause");
  assert.equal(await hookPause(d, "hok_chat", s.data.threadId, true), false);
  assert.match(notes.at(-1)!.text, /^Could not pause that hook/);
});

test("Edit offers the three kinds, Save writes the new words through hooks.set, and an empty field saves nothing", async () => {
  const s = createSample("northwind", { hooks: true });
  const { d, notes } = deps(s);
  const h = hooksOf(s).find((x) => x.id === "hok_chat")!;
  assert.deepEqual(draftOf(h), { event: "outward.before", kind: "check", what: "Check the address is in Contacts" });
  assert.equal(setInput(h, { ...draftOf(h), what: "   " }, s.data.threadId), null);
  const input = setInput(h, { event: "tool.before", kind: "command", what: "check-address.sh" }, s.data.threadId)!;
  assert.deepEqual([input["id"], input["kind"], input["command"], input["event"]], ["hok_chat", "command", "check-address.sh", "tool.before"]);
  assert.equal(await hookSave(d, input), true);
  assert.equal(notes.at(-1)?.text, "Hook saved");
  assert.equal(whatOf(hooksOf(s).find((x) => x.id === "hok_chat")!), "check-address.sh");
  const action = setInput(h, { event: "turn.end", kind: "action", what: "chat.post" }, s.data.threadId)!;
  assert.equal(action["cap"], "chat.post");
  assert.ok(html(s).includes('data-testid="hook-edit-hok_chat"'));
});

test("Remove takes the hook away and Undo makes the same hook again", async () => {
  const s = createSample("northwind", { hooks: true });
  const { d, notes } = deps(s);
  const h = hooksOf(s).find((x) => x.id === "hok_agent")!;
  assert.equal(await hookRemove(d, h.id, s.data.threadId, restoreInput(h, s.data.threadId)), true);
  assert.equal(hooksOf(s).some((x) => x.id === "hok_agent"), false);
  assert.equal(notes.at(-1)?.text, "Hook removed");
  await notes.at(-1)!.undo!();
  assert.ok(hooksOf(s).some((x) => whatOf(x) === "format-changed.sh"), "the same words are back");
  s.failNext("hooks.remove");
  assert.equal(await hookRemove(d, "hok_chat", s.data.threadId, {}), false);
  assert.match(notes.at(-1)!.text, /^Could not remove that hook/);
});

test("a Space hook offers no Remove to someone who is not an admin, and Remove to an admin", () => {
  const member = html(createSample("northwind", { hooks: true }));
  assert.ok(member.includes('data-testid="hook-locked-hok_space"') && member.includes("Only an admin can remove this"));
  assert.ok(!member.includes('data-testid="hook-remove-hok_space"'));
  assert.ok(member.includes('data-testid="hook-remove-hok_chat"'), "their own are theirs to remove");
  const admin = html(createSample("northwind", { hooks: true, admin: true }));
  assert.ok(admin.includes('data-testid="hook-remove-hok_space"') && !admin.includes("hook-locked-hok_space"));
});
