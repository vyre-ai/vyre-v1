// The rc.8 composer (prototype composer.html): the agent strip only when an AI answers, the model panel that stays open while you pick, the account list of connected
// accounts by name, usage that follows the account and model and leaves out what the engine did not report, the mode chip, the # picker with groups, a preview and an
// inline token (a folder sets the folder chip), Queue and Now while it works, Stop, the tray, the From picker grouped by service, and email's Subject and Cmd+Enter.
import test from "node:test";
import assert from "node:assert/strict";
import { useState } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { installDom, mount, find, press, flush, typeInto, textOf } from "../testing/dom.ts";
import type { Node } from "../testing/dom.ts";
import {
  Composer, ModelPanel, OutgoingHeader, answering, applyAttachPick, contextFor, contextRing, deleteToken, enterAction, groupSenders, initialState, lowSuggestion, nextMode,
  popupFor, resetLabel, sendControl, sizeLabel, tokenRanges,
} from "./index.tsx";
import type { ChatMode, ComposerAgent, ComposerLists, ComposerSend, ComposerSender, Effort, PanelAccount, PanelModel, PanelUsage, PopupItem } from "./index.tsx";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const lists: ComposerLists = {
  agents: [{ t: "Intake", ref: "agt_intake", kind: "Agent", s: "Leads this chat" }, { t: "Docs", ref: "agt_docs", kind: "Agent" }],
  people: [{ t: "Sam Patel", ref: "usr_sam", kind: "Person", s: "In this chat" }],
};
const agents: ComposerAgent[] = [
  { id: "agt_intake", name: "Intake", provider: "claude_code", modelTitle: "Sonnet 5.5", effort: "high", context: { used: 170_000, window: 200_000 } },
  { id: "agt_docs", name: "Docs", provider: "codex", modelTitle: "GPT-5", effort: "low" },
];
const key = (k: string, extra: Record<string, unknown> = {}) => ({ key: k, ...extra, nativeEvent: { key: k, ...extra }, target: {}, stopPropagation() {}, preventDefault() {}, isDefaultPrevented: () => false });
const keyDown = async (n: Node | null, k: string, extra: Record<string, unknown> = {}): Promise<void> => {
  const { act } = await import("react");
  await act(async () => { (n!.props.onKeyDown as (e: unknown) => void)(key(k, extra)); });
};
const focus = async (n: Node | null): Promise<void> => {
  const { act } = await import("react");
  await act(async () => { (n!.props.onFocus as (e: unknown) => void)({ nativeEvent: {}, target: {} }); });
};
async function withDom(run: () => Promise<void>): Promise<void> {
  const restore = installDom();
  try { await run(); } finally { restore(); }
}

/* ---------- the strip ---------- */

test("the agent strip shows only when an AI will answer: the lead; an @mentioned agent in a people-only chat; nobody when people only", () => {
  const lead = clean(renderToStaticMarkup(<Composer whoWillAnswer="" lead="Intake" lists={lists} agents={agents} />));
  assert.match(lead, /data-testid="composer-strip"/);
  assert.match(lead, /Intake will answer on Sonnet 5\.5, high effort/);
  assert.match(lead, /aria-label="Effort 3 of 4"/, "effort bars");
  const people = clean(renderToStaticMarkup(<Composer whoWillAnswer="" lists={lists} agents={agents} />));
  assert.doesNotMatch(people, /composer-strip/, "people only: no strip");
  const mentioned = clean(renderToStaticMarkup(<Composer whoWillAnswer="" lists={lists} agents={agents} value="@Docs can you check" />));
  assert.match(mentioned, /Docs will answer on GPT-5/, "an @mentioned agent brings the strip");
  const toPerson = clean(renderToStaticMarkup(<Composer whoWillAnswer="" lead="Intake" lists={lists} agents={agents} value="@Sam can you check" />));
  assert.doesNotMatch(toPerson, /composer-strip/, "addressed to a person: no AI answers");
  const outside = clean(renderToStaticMarkup(<Composer whoWillAnswer="" lead="Intake" lists={lists} agents={agents} sendsOutside />));
  assert.doesNotMatch(outside, /composer-strip/, "a message that leaves Vyre has no agent strip");
  assert.deepEqual(answering(["Intake"], agents).map((a) => a.id), ["agt_intake"]);
  assert.deepEqual(answering(["Nobody"], agents), [{ id: "Nobody", name: "Nobody" }], "an agent the place knows nothing about still shows by name");
});

test("the account name shows on the pill only when it is given (two accounts of one provider), and the ring only past 60 percent, amber past 80", () => {
  const two = clean(renderToStaticMarkup(<Composer whoWillAnswer="" lead="Intake" lists={lists} agents={[{ ...agents[0]!, accountName: "MLA work" }]} />));
  assert.match(two, /Sonnet 5\.5 · MLA work/);
  assert.equal(contextRing({ used: 60, window: 100 }), null);
  assert.deepEqual(contextRing({ used: 70, window: 100 }), { pct: 0.7, warn: false });
  assert.deepEqual(contextRing({ used: 85, window: 100 }), { pct: 0.85, warn: true });
  assert.equal(contextRing(null), null);
  assert.match(two, /data-testid="composer-ring"/);
  assert.match(two, /data-warn="1"/, "170k of 200k is amber");
  const low = clean(renderToStaticMarkup(<Composer whoWillAnswer="" lead="Intake" lists={lists} agents={[{ ...agents[0]!, context: { used: 40_000, window: 200_000 } }]} />));
  assert.doesNotMatch(low, /composer-ring/);
});

test("the mode chip shows only when the mode is not Auto, the runs chip only when given, and Shift+Tab cycles Auto, Ask first, Plan", async () => {
  assert.equal(nextMode("auto"), "ask");
  assert.equal(nextMode("ask"), "plan");
  assert.equal(nextMode("plan"), "auto");
  const out = clean(renderToStaticMarkup(<Composer whoWillAnswer="" lead="Intake" lists={lists} agents={agents} mode="auto" onMode={() => undefined} />));
  assert.doesNotMatch(out, /composer-mode/, "Auto says nothing");
  assert.doesNotMatch(out, /composer-runs/);
  const asked = clean(renderToStaticMarkup(<Composer whoWillAnswer="" lead="Intake" lists={lists} agents={agents} mode="ask" onMode={() => undefined} runsChip="Northwind" />));
  assert.match(asked, /data-testid="composer-mode"/);
  assert.match(asked, />On Northwind</);
  await withDom(async () => {
    const modes: ChatMode[] = [];
    function Host(): ReactElement { const [m, setM] = useState<ChatMode>("ask"); return <Composer whoWillAnswer="" lead="Intake" lists={lists} agents={agents} mode={m} onMode={(x) => { modes.push(x); setM(x); }} />; }
    const root = await mount(createRoot, <Host />);
    await keyDown(find(root, "composer-field"), "Tab", { shiftKey: true });
    await keyDown(find(root, "composer-field"), "Tab", { shiftKey: true });
    await keyDown(find(root, "composer-field"), "Tab", { shiftKey: true });
    assert.deepEqual(modes, ["plan", "auto", "ask"]);
  });
});

/* ---------- the model panel ---------- */

const ACCTS: PanelAccount[] = [
  { ref: "#cl_personal", name: "Personal", provider: "claude_code", session: 0.88 },
  { ref: "#cl_work", name: "MLA work", provider: "claude_code", session: 0.22 },
  { ref: "#gpt", name: "ChatGPT Plus", provider: "codex", session: null },
];
const MODELS: Record<string, PanelModel[]> = {
  claude_code: [{ id: "opus", title: "Opus 5.5", window: 200_000 }, { id: "sonnet", title: "Sonnet 5.5", window: 1_000_000 }],
  codex: [{ id: "gpt-5", title: "GPT-5", window: 400_000 }],
};

function PanelHost({ log, usageOf }: { log: string[]; usageOf: (ref: string) => PanelUsage | null }): ReactElement {
  const [ref, setRef] = useState("#cl_personal");
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState<Effort>("medium");
  const [mode, setMode] = useState<ChatMode>("ask");
  const prov = ACCTS.find((a) => a.ref === ref)!.provider;
  return (
    <Composer whoWillAnswer="" lead="Intake" lists={lists} agents={agents} mode={mode} onMode={setMode}
      renderPanel={(agent, close) => (
        <ModelPanel agent={agent} scope="chat" onScope={() => undefined} accounts={ACCTS} accountRef={ref} onAccount={(r) => { log.push(`account:${r}`); setRef(r); }}
          models={MODELS[prov]!} model={model} onModel={(m) => { log.push(`model:${m}`); setModel(m); }} effort={effort} onEffort={(e) => { log.push(`effort:${e}`); setEffort(e); }}
          usage={usageOf(ref)} mode={mode} onMode={(m) => { log.push(`mode:${m}`); setMode(m); }} onClose={() => { log.push("close"); close(); }} onAddProvider={() => log.push("add")} now={0} />
      )} />
  );
}

test("the model panel opens from the strip and stays open while you pick account, model, effort (keys 1 to 4) and mode; Escape closes it", async () => {
  await withDom(async () => {
    const log: string[] = [];
    const root = await mount(createRoot, <PanelHost log={log} usageOf={() => null} />);
    assert.equal(find(root, "model-panel"), null);
    await press(find(root, "composer-strip"));
    assert.ok(find(root, "model-panel"), "open");
    await press(find(root, "model-model"));
    await press(find(root, "row-model-sonnet"));
    await press(find(root, "model-effort-max"));
    await keyDown(find(root, "model-panel"), "1");
    await press(find(root, "model-mode-plan"));
    assert.ok(find(root, "model-panel"), "still open after four choices");
    assert.deepEqual(log, ["model:sonnet", "effort:max", "effort:low", "mode:plan"]);
    assert.match(textOf(find(root, "model-mode-note")), /Writes a plan first/);
    await keyDown(find(root, "model-panel"), "Escape");
    assert.equal(find(root, "model-panel"), null, "Escape closes it");
  });
});

test("the Provider submenu lists only the connected accounts, by the names given, plus Connect another; the Model list follows", async () => {
  await withDom(async () => {
    const log: string[] = [];
    const root = await mount(createRoot, <PanelHost log={log} usageOf={() => null} />);
    await press(find(root, "composer-strip"));
    assert.equal(find(root, "model-accounts"), null);
    await press(find(root, "model-account"));
    const list = textOf(find(root, "model-accounts"));
    for (const n of ["Personal", "MLA work", "ChatGPT Plus", "Connect another"]) assert.ok(list.includes(n), n);
    assert.ok(!list.includes("Grok"), "a provider that is not connected is not listed");
    await press(find(root, "row-model-account-#gpt"));
    assert.deepEqual(log, ["account:#gpt"]);
    assert.ok(find(root, "row-model-gpt-5"), "the models follow the account's provider");
    assert.equal(find(root, "row-model-opus"), null);
    assert.ok(find(root, "model-panel"), "picking an account keeps the panel open");
    assert.equal(find(root, "model-effort-max"), null, "ChatGPT has no Max: effort follows the provider");
    await press(find(root, "model-account"));
    await press(find(root, "model-add-provider"));
    assert.deepEqual(log.at(-1), "add");
  });
});

test("usage follows the selected account and model, and a meter the engine did not report is left out", async () => {
  const usage: Record<string, PanelUsage | null> = {
    "#cl_personal": { context: { used: 84_000, window: 200_000 }, session: { pct: 0.88, resetsAt: 3_600_000 }, week: { pct: 0.41, resetsAt: 5 * 86_400_000 } },
    "#cl_work": { context: { used: 84_000, window: 200_000 }, session: { pct: 0.22 }, week: null },
    "#gpt": { context: { used: 10_000, window: 400_000 }, session: null, week: null },
  };
  await withDom(async () => {
    const log: string[] = [];
    const root = await mount(createRoot, <PanelHost log={log} usageOf={(r) => usage[r] ?? null} />);
    await press(find(root, "composer-strip"));
    assert.match(textOf(find(root, "meter-context")), /84k.*200k/);
    assert.match(textOf(find(root, "meter-session")), /Session.*resets/);
    assert.match(textOf(find(root, "meter-week")), /Week.*resets/);
    assert.ok(find(root, "model-low"), "running low on Personal");
    assert.match(textOf(find(root, "model-low")), /Use MLA work · 22%/, "suggests the least used other account");
    await press(find(root, "model-model"));
    await press(find(root, "row-model-sonnet"));
    assert.match(textOf(find(root, "meter-context")), /84k.*1M/, "the window follows the model");
    await press(find(root, "model-low-switch"));
    assert.equal(log.at(-1), "account:#cl_work", "one tap switches");
    assert.equal(find(root, "meter-week"), null, "no week number: no week meter");
    await press(find(root, "model-account"));
    await press(find(root, "row-model-account-#gpt"));
    assert.equal(find(root, "meter-session"), null, "Codex reports no session: hidden, not faked");
    assert.ok(find(root, "meter-context"));
  });
  assert.deepEqual(contextFor({ context: { used: 1, window: 10 }, session: null, week: null }, { id: "x", title: "X", window: 99 }), { used: 1, window: 99 });
  assert.equal(contextFor({ context: null, session: null, week: null }, undefined), null);
  assert.equal(lowSuggestion(ACCTS, "#cl_work", 0.5), null, "not low: no suggestion");
  assert.equal(resetLabel(undefined), "");
});

/* ---------- # picker ---------- */

const hashLists: ComposerLists = {
  ...lists,
  records: [{ t: "Northwind renewal", s: "Deal", kind: "Record", ref: "rec_1", data: { type: "deal" } }],
  files: [{ t: "Q4 pricing.pdf", s: "Sales", kind: "File", ref: "fil_1", data: { size: "2400000" } }],
  folders: [{ t: "Clients", s: "Clients", kind: "Folder", ref: "fld_1" }],
  chats: [{ t: "Pricing questions", kind: "Chat", ref: "thr_1" }],
  automations: [{ t: "Weekly digest", kind: "Automation", ref: "aut_1" }],
};

test("# opens one grouped search with section heads, a preview of the item you are on, and a pick writes an inline token sent with its id", async () => {
  await withDom(async () => {
    const sent: ComposerSend[] = [];
    const asked: string[] = [];
    const root = await mount(createRoot, <Composer whoWillAnswer="" lead="Intake" lists={hashLists} agents={agents} onSubmit={(p) => sent.push(p)}
      preview={async (item) => { asked.push(item.ref ?? ""); return { fields: [["Stage", "Negotiation"], ["Close", "12 Nov"]] }; }} />);
    const field = find(root, "composer-field");
    await focus(field);
    await typeInto(field, "see #");
    const pop = textOf(find(root, "composer-popup"));
    for (const g of ["Records", "Files", "Folders", "Chats", "Automations"]) assert.ok(pop.includes(g), g);
    assert.ok(!pop.includes("Projects"), "an empty group has no head");
    await flush();
    assert.deepEqual(asked, ["rec_1"], "the first item is previewed");
    assert.match(textOf(find(root, "composer-preview")), /Northwind renewal.*Stage.*Negotiation/);
    await keyDown(find(root, "composer-field"), "ArrowDown");
    await flush();
    assert.deepEqual(asked, ["rec_1", "fil_1"], "the preview follows the keys");
    await keyDown(find(root, "composer-field"), "ArrowUp");
    await keyDown(find(root, "composer-field"), "Enter");
    assert.equal(find(root, "composer-field")!.props.value, "see #Northwind renewal ");
    await press(find(root, "composer-send"));
    assert.deepEqual(sent[0]!.refs, [{ kind: "Record", id: "rec_1", title: "Northwind renewal", token: "#" }]);
  });
  const ranges = tokenRanges("see #Northwind renewal and @Intake", [{ kind: "Record", id: "rec_1", title: "Northwind renewal", token: "#" }], ["Intake"]);
  assert.deepEqual(ranges.map((r) => r.kind), ["link", "mention"]);
  assert.deepEqual(deleteToken("see #Northwind renewal ", 23, ranges), { text: "see ", cursor: 4 }, "Backspace after a token takes all of it");
});

test("# picking a folder sets the folder chip; the scope narrows the search to one group", async () => {
  await withDom(async () => {
    const folders: (string | null)[] = [];
    const root = await mount(createRoot, <Composer whoWillAnswer="" lead="Intake" lists={hashLists} onFolder={(f) => folders.push(f)} />);
    const field = find(root, "composer-field");
    await focus(field);
    await typeInto(field, "#Cli");
    await keyDown(find(root, "composer-field"), "Enter");
    assert.deepEqual(folders, ["Clients"]);
    assert.ok(find(root, "composer-chip-folder"), "the folder chip");
    assert.equal(find(root, "composer-field")!.props.value, "");
  });
  const files = popupFor({ ch: "#", start: 0, end: 1, query: "" }, hashLists, true, "Files");
  assert.deepEqual(files.map((e) => ("head" in e && e.head !== undefined ? e.head : (e as PopupItem).label)), ["Files", "Q4 pricing.pdf"]);
});

test("@ and / menus: agents and people with their place in the chat; commands and skills under their own heads", async () => {
  await withDom(async () => {
    const root = await mount(createRoot, <Composer whoWillAnswer="" lead="Intake" lists={{ ...lists, commands: [{ t: "plan", s: "Plan mode on or off", kind: "Command", body: "plan" }, { t: "summarise", s: "Summarise this chat", kind: "Plugin", body: "summarise" }] }} />);
    const field = find(root, "composer-field");
    await focus(field);
    await typeInto(field, "@");
    const at = textOf(find(root, "composer-popup"));
    assert.ok(at.includes("Agents") && at.includes("People") && at.includes("Leads this chat") && at.includes("In this chat"));
    await typeInto(field, "/");
    const slash = textOf(find(root, "composer-popup"));
    assert.ok(slash.includes("Commands") && slash.includes("/plan") && slash.includes("Skills") && slash.includes("/summarise"));
  });
});

/* ---------- send ---------- */

test("while it works: Stop with nothing typed; Queue and Now once you type, sending queue or now; Option+Enter sends now", async () => {
  assert.equal(sendControl(false, false), "send");
  assert.equal(sendControl(true, false), "stop");
  assert.equal(sendControl(true, true), "split");
  assert.equal(enterAction({ altKey: true }, true, true), "interrupt");
  assert.equal(enterAction({}, true, true), "send");
  await withDom(async () => {
    const log: string[] = [];
    const root = await mount(createRoot, <Composer whoWillAnswer="" lead="Intake" lists={lists} working onStop={() => log.push("stop")} onSubmit={(p) => log.push(`${p.mode}:${p.text}`)} onInterrupt={(p) => log.push(`${p.mode}:${p.text}`)} />);
    assert.equal(find(root, "composer-send")!.props["aria-label"], "Stop");
    await press(find(root, "composer-send"));
    const field = find(root, "composer-field");
    await typeInto(field, "use the new form");
    assert.ok(find(root, "composer-split"));
    await press(find(root, "composer-send"));
    await typeInto(find(root, "composer-field"), "stop and read this");
    await press(find(root, "composer-interrupt"));
    await typeInto(find(root, "composer-field"), "and this");
    await keyDown(find(root, "composer-field"), "Enter", { altKey: true });
    assert.deepEqual(log, ["stop", "queue:use the new form", "interrupt:stop and read this", "interrupt:and this"]);
  });
});

/* ---------- tray ---------- */

test("the tray shows each file with its size and removes it; From Files puts a kept file in the tray by its id", async () => {
  assert.equal(sizeLabel(2_400_000), "2.4 MB");
  assert.equal(sizeLabel(800), "1 KB");
  const out = clean(renderToStaticMarkup(<Composer whoWillAnswer="" attachments={[{ name: "brief.pdf", size: 2_400_000 }]} />));
  assert.match(out, /brief\.pdf/);
  assert.match(out, /2\.4 MB/);
  await withDom(async () => {
    const sent: ComposerSend[] = [];
    const root = await mount(createRoot, <Composer whoWillAnswer="" lists={hashLists} suggest={async () => hashLists} onSubmit={(p) => sent.push(p)} />);
    await press(find(root, "composer-attach"));
    assert.ok(textOf(find(root, "composer-plus")).includes("Upload files"));
    await press(find(root, "row-plus-files"));
    await focus(find(root, "composer-field"));
    assert.match(textOf(find(root, "composer-popup")), /Attach/);
    await keyDown(find(root, "composer-field"), "Enter");
    assert.ok(find(root, "composer-file-0"), "the file is in the tray");
    assert.match(textOf(find(root, "composer-file-0")), /Q4 pricing\.pdf.*2\.4 MB/);
    await press(find(root, "composer-file-0-remove"));
    assert.equal(find(root, "composer-file-0"), null, "removed");
  });
  const t = { ch: "#" as const, start: 0, end: 1, query: "" };
  const next = applyAttachPick(initialState("#"), t, { group: "Files", label: "a.pdf", kind: "File", ref: "fil_9" });
  assert.deepEqual(next.files, [{ name: "a.pdf", fileId: "fil_9" }]);
  assert.equal(next.text, "");
});

/* ---------- outside: email and text ---------- */

const SENDERS: ComposerSender[] = [
  { id: "mbx_1", channel: "email", name: "Irfad Imtiaz", address: "irfad@example.test", via: "Gmail", provider: "gmail", default: true },
  { id: "mbx_2", channel: "email", name: "Updates", address: "hello@updates.example.test", via: "Mailgun", provider: "mailgun" },
  { id: "mbx_3", channel: "email", name: "Team", address: "team@example.test", via: "Gmail", provider: "gmail", usable: false, why: "Signed out" },
  { id: "num_1", channel: "text", name: "Main line", address: "+1 415 555 0142", via: "Twilio", provider: "twilio" },
];

test("the From picker groups every sender by service with its logo and address, greys one that cannot send, and a pick names the sender", async () => {
  assert.deepEqual(groupSenders(SENDERS, "email").map((g) => [g.via, g.items.map((x) => x.id)]), [["Gmail", ["mbx_1", "mbx_3"]], ["Mailgun", ["mbx_2"]]]);
  assert.deepEqual(groupSenders(SENDERS, "text").map((g) => g.via), ["Twilio"]);
  await withDom(async () => {
    const picked: string[] = [];
    const connect: string[] = [];
    function Host(): ReactElement { const [id, setId] = useState("mbx_1"); return <OutgoingHeader channel="email" channels={["email", "text"]} onChannel={() => undefined} to={null} senders={SENDERS} senderId={id} onSender={(x) => { picked.push(x); setId(x); }} onConnect={(c) => connect.push(c)} subject="" onSubject={() => undefined} />; }
    const root = await mount(createRoot, <Host />);
    assert.match(textOf(find(root, "from-name")), /Irfad Imtiaz/);
    await press(find(root, "from-pick"));
    const menu = textOf(find(root, "from-menu"));
    assert.ok(menu.includes("Gmail") && menu.includes("Mailgun") && menu.includes("hello@updates.example.test") && menu.includes("Signed out") && menu.includes("Connect a mailbox or sending domain"));
    assert.ok(find(root, "logo-gmail") && find(root, "logo-mailgun"), "each service's logo");
    assert.equal(find(root, "row-from-mbx_3")!.props.onClick, undefined, "a sender that cannot send is not choosable");
    await press(find(root, "row-from-mbx_2"));
    assert.deepEqual(picked, ["mbx_2"]);
    assert.equal(find(root, "from-menu"), null, "a pick closes the list");
    assert.match(textOf(find(root, "from-name")), /Updates/);
    await press(find(root, "from-pick"));
    await press(find(root, "row-from-connect"));
    assert.deepEqual(connect, ["email"]);
  });
});

test("Subject only for email; Cmd+Enter sends an email and a plain Enter writes a line", () => {
  const mail = clean(renderToStaticMarkup(<OutgoingHeader channel="email" channels={["email", "text"]} onChannel={() => undefined} to={null} senders={SENDERS} senderId="mbx_1" onSender={() => undefined} subject="Re: Proposal" onSubject={() => undefined} />));
  assert.match(mail, /data-testid="contact-subject"/);
  assert.match(mail, /Re: Proposal/);
  const text = clean(renderToStaticMarkup(<OutgoingHeader channel="text" channels={["email", "text"]} onChannel={() => undefined} to={null} senders={SENDERS} senderId="num_1" onSender={() => undefined} />));
  assert.doesNotMatch(text, /contact-subject/);
  assert.match(text, /aria-label="Text from"/);
  assert.equal(enterAction({}, false, false), "newline");
  assert.equal(enterAction({ metaKey: true }, false, false), "send");
  assert.equal(enterAction({ ctrlKey: true }, false, false), "send");
});
