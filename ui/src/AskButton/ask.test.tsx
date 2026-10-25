// ui/AskButton: one Ask control with an agent selector. The agent that shows follows the item, the suggestion, the place and the assistant;
// the picker lists every agent; the viewer's access decides whether Do it is offered; picks are remembered and a blocked localStorage never throws.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ASSISTANT_NOTE,
  AskButton,
  AskPicker,
  RECENT_KEY,
  SUGGESTED_NOTE,
  aboutLine,
  agentIndices,
  clampPanel,
  findAgent,
  hasDefault,
  isAskShortcut,
  isNarrow,
  itemKey,
  layeredStorage,
  levelOf,
  mainLabel,
  memoryStorage,
  modesFor,
  movePicker,
  offersChoice,
  pickerEntries,
  placeKey,
  pushRecent,
  readRecents,
  rememberPick,
  resolveAgent,
  webStorage,
} from "./index.tsx";
import type { AskAgent, AskContext } from "./index.tsx";

const ASSISTANT: AskAgent = { id: "asst", name: "Assistant", assistant: true };
const BILLING: AskAgent = { id: "bill", name: "Billing", role: "Invoices and payment follow-up" };
const INTAKE: AskAgent = { id: "intake", name: "Intake", role: "Books first calls" };
const DOCS: AskAgent = { id: "docs", name: "Docs", role: "Reviews and drafts documents" };
const AGENTS: readonly AskAgent[] = [ASSISTANT, BILLING, INTAKE, DOCS];

const CTX: AskContext = { kind: "record", id: "r1", title: "Northwind agreement", access: "edit" };

function names(entries: ReturnType<typeof pickerEntries>): string[] {
  return entries.map((e) => (e.kind === "head" ? `# ${e.label}` : e.label));
}

test("the agent that shows: this item's pick, else the suggestion, else the place's last pick, else the assistant", () => {
  const storage = memoryStorage();
  const base = { agents: AGENTS, place: "records", context: CTX, storage };
  assert.equal(resolveAgent(base)?.id, "asst", "nothing known: the Space assistant");
  storage.set(placeKey("records"), "docs");
  assert.equal(resolveAgent(base)?.id, "docs", "the last pick in this place");
  assert.equal(resolveAgent({ ...base, suggested: "bill" })?.id, "bill", "a suggestion beats the place's last pick");
  const key = itemKey("records", CTX);
  assert.equal(key, "ask:records:record:r1");
  storage.set(key ?? "", "intake");
  assert.equal(resolveAgent({ ...base, suggested: "bill" })?.id, "intake", "a pick for this same item beats the suggestion");
  assert.equal(resolveAgent({ ...base, agents: [BILLING, INTAKE], context: null, storage: memoryStorage() })?.id, "bill", "with no assistant the first agent");
  assert.equal(resolveAgent({ ...base, agents: [], storage: memoryStorage() }), null, "no agents: nothing to show");
});

test("an unknown stored or suggested id is ignored, never shown", () => {
  const storage = memoryStorage();
  storage.set(placeKey("records"), "gone");
  storage.set("ask:records:record:r1", "also-gone");
  assert.equal(resolveAgent({ agents: AGENTS, place: "records", context: CTX, suggested: "nobody", storage })?.id, "asst");
  assert.equal(findAgent(AGENTS, ""), null);
  assert.equal(findAgent(AGENTS, undefined), null);
  assert.equal(findAgent(AGENTS, "docs")?.name, "Docs");
});

test("pressing Ask goes straight to a thread only when an agent is tied to the item or was picked for it", () => {
  const storage = memoryStorage();
  const base = { agents: AGENTS, place: "records", context: CTX, storage };
  assert.equal(hasDefault(base), false, "no suggestion, no pick: open the picker first");
  assert.equal(hasDefault({ ...base, suggested: "bill" }), true);
  storage.set(placeKey("records"), "docs");
  assert.equal(hasDefault(base), false, "the place's last pick alone is shown but still asks which agent");
  rememberPick(storage, "records", CTX, DOCS);
  assert.equal(hasDefault(base), true, "after a pick for this item");
});

test("a pick is remembered for the place, for the item and in the recents (newest first, no repeats, at most four)", () => {
  const storage = memoryStorage();
  rememberPick(storage, "task", CTX, BILLING);
  assert.equal(storage.get(placeKey("task")), "bill");
  assert.equal(storage.get("ask:task:record:r1"), "bill");
  assert.deepEqual(readRecents(storage), ["bill"]);
  pushRecent(storage, "docs");
  pushRecent(storage, "intake");
  pushRecent(storage, "bill");
  assert.deepEqual(readRecents(storage), ["bill", "intake", "docs"]);
  for (const id of ["a", "b", "c", "d", "e"]) pushRecent(storage, id);
  assert.deepEqual(readRecents(storage), ["e", "d", "c", "b"]);
  storage.set(RECENT_KEY, "{not json");
  assert.deepEqual(readRecents(storage), [], "a damaged recents list reads as empty");
  storage.set(RECENT_KEY, JSON.stringify([1, "x", null]));
  assert.deepEqual(readRecents(storage), ["x"]);
  rememberPick(storage, "task", null, DOCS);
  assert.equal(storage.get(placeKey("task")), "docs", "an item with no context is remembered for the place only");
});

test("the picker lists every agent in the prototype's order: Suggested, Recent, Assistant, Agents", () => {
  const entries = pickerEntries({ agents: AGENTS, current: BILLING, suggested: BILLING, recents: ["docs", "bill", "intake"] });
  assert.deepEqual(names(entries), ["# Suggested", "Billing", "# Recent", "Docs", "Intake", "# Assistant", "Assistant"]);
  const agents = entries.filter((e) => e.kind === "agent");
  assert.equal(agents.length, AGENTS.length, "all four agents are reachable");
  assert.equal(entries.find((e) => e.kind === "agent" && e.label === "Billing")?.current, true, "the shown agent carries the check");
  assert.equal(entries.find((e) => e.label === "Docs")?.current, false);
  assert.equal(entries.find((e) => e.label === "Billing")?.note, "Invoices and payment follow-up", "the role is the quiet line");
  assert.equal(entries.find((e) => e.kind === "agent" && e.label === "Assistant")?.note, ASSISTANT_NOTE);
});

test("with no suggestion and no history the picker is the assistant then the rest", () => {
  const entries = pickerEntries({ agents: AGENTS, current: ASSISTANT, suggested: null, recents: [] });
  assert.deepEqual(names(entries), ["# Assistant", "Assistant", "# Agents", "Billing", "Intake", "Docs"]);
});

test("a suggested agent without a role says why it is listed; the suggested assistant is not listed twice", () => {
  const bare: AskAgent = { id: "bare", name: "Bare" };
  const first = pickerEntries({ agents: [ASSISTANT, bare], current: bare, suggested: bare, recents: [] });
  assert.equal(first.find((e) => e.label === "Bare")?.note, SUGGESTED_NOTE);
  const asst = pickerEntries({ agents: AGENTS, current: ASSISTANT, suggested: ASSISTANT, recents: [] });
  assert.equal(asst.filter((e) => e.label === "Assistant").length, 1);
  assert.equal(asst.filter((e) => e.kind === "agent").length, AGENTS.length);
});

test("recents skip the shown and the suggested agent, repeats and unknown ids, and cap at three", () => {
  const many: AskAgent[] = [ASSISTANT, ...["A", "B", "C", "D", "E", "F"].map((n) => ({ id: n.toLowerCase(), name: n }))];
  const entries = pickerEntries({ agents: many, current: many[1] ?? null, suggested: many[2] ?? null, recents: ["a", "b", "ghost", "c", "d", "d", "e", "f"] });
  const list = names(entries);
  const recent = list.slice(list.indexOf("# Recent") + 1, list.indexOf("# Assistant"));
  assert.deepEqual(recent, ["C", "D", "E"], "a (shown) and b (suggested) are not repeated; ghost and the second d are skipped; f is past the cap");
  assert.ok(list.includes("F"), "an agent cut by the cap is still listed under Agents");
});

test("typing filters by name or role, drops the section titles and keeps rows reachable", () => {
  const byName = pickerEntries({ agents: AGENTS, current: ASSISTANT, suggested: BILLING, recents: [], query: "int" });
  assert.deepEqual(names(byName), ["Intake"]);
  const byRole = pickerEntries({ agents: AGENTS, current: ASSISTANT, suggested: null, recents: [], query: " INVOICES " });
  assert.deepEqual(names(byRole), ["Billing"]);
  const none = pickerEntries({ agents: AGENTS, current: ASSISTANT, suggested: null, recents: [], query: "zzz" });
  assert.deepEqual(none, []);
  assert.equal(movePicker(none, -1, "ArrowDown"), -1, "nothing to land on");
});

test("arrows wrap over the agent rows and skip the section titles; Home and End jump", () => {
  const entries = pickerEntries({ agents: AGENTS, current: ASSISTANT, suggested: BILLING, recents: [] });
  const rows = agentIndices(entries);
  assert.equal(rows.length, 4);
  assert.equal(movePicker(entries, -1, "Home"), rows[0]);
  assert.equal(movePicker(entries, -1, "ArrowDown"), rows[0]);
  assert.equal(movePicker(entries, -1, "ArrowUp"), rows[rows.length - 1]);
  assert.equal(movePicker(entries, rows[0] ?? -1, "ArrowDown"), rows[1]);
  assert.equal(movePicker(entries, rows[rows.length - 1] ?? -1, "ArrowDown"), rows[0], "wraps at the bottom");
  assert.equal(movePicker(entries, rows[0] ?? -1, "ArrowUp"), rows[rows.length - 1], "wraps at the top");
  assert.equal(movePicker(entries, rows[1] ?? -1, "End"), rows[rows.length - 1]);
});

test("Do it needs at least Use: a viewer with View can only chat, and chat is never lost", () => {
  assert.deepEqual(modesFor(undefined, "edit"), ["chat"]);
  assert.deepEqual(modesFor([], "manage"), ["chat"]);
  assert.deepEqual(modesFor(["do", "chat"], "edit"), ["do", "chat"]);
  assert.deepEqual(modesFor(["do", "chat"], "use"), ["do", "chat"]);
  assert.deepEqual(modesFor(["do", "chat"], "view"), ["chat"]);
  assert.deepEqual(modesFor(["do"], "view"), ["chat"]);
  assert.equal(offersChoice(["do", "chat"]), true);
  assert.equal(offersChoice(["chat"]), false);
  assert.equal(offersChoice(["do"]), false);
  assert.equal(levelOf("use"), "use");
  assert.equal(levelOf(true), "edit");
  assert.equal(levelOf(undefined), "view", "unknown is the safe side");
  assert.equal(levelOf("owner"), "view");
});

test("the thread chip and the button name say what the ask is about", () => {
  assert.equal(aboutLine(CTX), "About Northwind agreement");
  assert.equal(aboutLine({ ...CTX, title: "" }), "About record");
  assert.equal(aboutLine({ ...CTX, title: "", kind: "" }), "About this");
  assert.equal(aboutLine(null), "");
  assert.equal(mainLabel(BILLING, CTX), "Ask Billing about Northwind agreement");
  assert.equal(mainLabel(BILLING, null), "Ask Billing");
});

test("Cmd-J and Ctrl-J, with no other modifier, are the shortcut", () => {
  assert.equal(isAskShortcut({ key: "j", metaKey: true }), true);
  assert.equal(isAskShortcut({ key: "J", ctrlKey: true }), true);
  assert.equal(isAskShortcut({ key: "j" }), false);
  assert.equal(isAskShortcut({ key: "j", metaKey: true, shiftKey: true }), false);
  assert.equal(isAskShortcut({ key: "j", metaKey: true, altKey: true }), false);
  assert.equal(isAskShortcut({ key: "k", metaKey: true }), false);
});

test("narrow and clamp helpers", () => {
  assert.equal(isNarrow(0), false, "an unmeasured parent is not narrow");
  assert.equal(isNarrow(200), true);
  assert.equal(isNarrow(230), false);
  assert.deepEqual(clampPanel(900, 700, 280, 320, 1000, 800), { left: 714, top: 474 });
  assert.deepEqual(clampPanel(-20, -20, 280, 320, 1000, 800), { left: 6, top: 6 });
});

test("a blocked or throwing localStorage never throws and picks still stick for the session", () => {
  const host = globalThis as { localStorage?: unknown };
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    assert.equal(webStorage(), null, "the accessor throwing reads as no storage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } },
    });
    const web = webStorage();
    assert.ok(web !== null);
    assert.equal(web.get("x"), null);
    web.set("x", "1");
    const layered = layeredStorage(web);
    layered.set("ask:t", "docs");
    assert.equal(layered.get("ask:t"), "docs", "memory remembers what the browser refused");
    assert.equal(layeredStorage(null).get("none"), null);
  } finally {
    if (had) Object.defineProperty(globalThis, "localStorage", had);
    else delete host.localStorage;
  }
});

test("the control shows the suggested agent's face and name in its labels, with a chevron to change the agent", () => {
  const html = renderToStaticMarkup(
    <AskButton place="records" context={CTX} agents={AGENTS} suggested="bill" storage={memoryStorage()} onAsk={() => undefined} />,
  );
  assert.match(html, /data-testid="ask-main"/);
  assert.match(html, /aria-label="Ask Billing about Northwind agreement"/);
  assert.match(html, /data-testid="ask-face-bill"/);
  assert.match(html, />Ask</);
  assert.match(html, /aria-label="Change agent"/);
  assert.match(html, /data-testid="ask-chevron"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.doesNotMatch(html, /data-testid="ask-picker"/, "the picker is closed until it is opened");
  assert.ok(html.indexOf("ask-main") < html.indexOf("ask-chevron"), "the face and Ask come before the chevron");
});

test("with nothing tied to the item the control shows the Space assistant, and the mark is not a letter tile", () => {
  const html = renderToStaticMarkup(
    <AskButton place="files" context={CTX} agents={AGENTS} storage={memoryStorage()} onAsk={() => undefined} />,
  );
  assert.match(html, /aria-label="Ask Assistant about Northwind agreement"/);
  assert.match(html, /data-testid="ask-face-asst"/);
  const face = html.slice(html.indexOf('data-testid="ask-face-asst"'), html.indexOf('data-testid="ask-chevron"'));
  assert.match(face, /<svg/, "the assistant wears the Vyre mark, drawn as svg");
});

test("the last pick in the place is what shows next time", () => {
  const storage = memoryStorage();
  rememberPick(storage, "forms", { ...CTX, id: "other" }, DOCS);
  const html = renderToStaticMarkup(<AskButton place="forms" context={CTX} agents={AGENTS} storage={storage} onAsk={() => undefined} />);
  assert.match(html, /aria-label="Ask Docs about Northwind agreement"/);
});

test("compact hides the word Ask and keeps the name for assistive tech", () => {
  const html = renderToStaticMarkup(
    <AskButton place="email" context={CTX} agents={AGENTS} suggested="intake" storage={memoryStorage()} compact onAsk={() => undefined} />,
  );
  assert.doesNotMatch(html, />Ask</);
  assert.match(html, /aria-label="Ask Intake about Northwind agreement"/);
});

test("a custom face is used when given, and no agents renders nothing", () => {
  const custom = renderToStaticMarkup(
    <AskButton place="sites" context={CTX} agents={AGENTS} suggested="docs" storage={memoryStorage()} renderFace={(a) => <i data-mine={a.id}>x</i>} onAsk={() => undefined} />,
  );
  assert.match(custom, /data-mine="docs"/);
  assert.doesNotMatch(custom, /data-testid="ask-face-/);
  assert.equal(renderToStaticMarkup(<AskButton place="sites" context={CTX} agents={[]} storage={memoryStorage()} onAsk={() => undefined} />), "");
});

test("the open picker is a Find field and shared Rows with the face in the leading slot and the check in the trailing slot", () => {
  const entries = pickerEntries({ agents: AGENTS, current: BILLING, suggested: BILLING, recents: [] });
  const html = renderToStaticMarkup(
    <AskPicker
      entries={entries}
      query=""
      onQuery={() => undefined}
      active={1}
      onActive={() => undefined}
      onChoose={() => undefined}
      onClose={() => undefined}
      anchor={{ x: 100, y: 40, w: 90, h: 30 }}
      renderFace={(a) => <i data-face={a.id}>f</i>}
    />,
  );
  assert.match(html, /aria-label="Choose the agent"/);
  assert.match(html, /placeholder="Find an agent"/);
  for (const a of AGENTS) {
    assert.match(html, new RegExp(`data-testid="row-ask-agent-${a.id}"`), `${a.name} is listed`);
    assert.match(html, new RegExp(`data-face="${a.id}"`));
  }
  assert.match(html, /data-testid="row-ask-agent-bill-trailing"/, "the shown agent carries the check");
  assert.doesNotMatch(html, /data-testid="row-ask-agent-docs-trailing"/);
  assert.match(html, /background-color:var\(--hover\)/, "the lit row uses the quiet hover wash");
  assert.doesNotMatch(html, /background-color:var\(--accent\)/, "no filled accent box on a lit row");
  for (const head of ["Suggested", "Assistant", "Agents"]) assert.match(html, new RegExp(`>${head}<`));
});

test("an empty search says so instead of showing a blank panel", () => {
  const html = renderToStaticMarkup(
    <AskPicker entries={[]} query="zzz" onQuery={() => undefined} active={-1} onActive={() => undefined} onChoose={() => undefined} onClose={() => undefined} anchor={{ x: 0, y: 0, w: 10, h: 10 }} renderFace={() => null} />,
  );
  assert.match(html, /No agent matches\./);
});
