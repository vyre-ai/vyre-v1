// The Ask pane drawn (owner rule, rc.17): every door opens the one pane beside the place it was pressed in, with the thing as its chip, and the route never moves to Chats. The pane keeps
// the place mounted, its width is remembered per place, Escape closes it, the chip's x makes it about the place, New starts fresh and Open in Chats is the one way to Chats.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import { find, flush, installDom, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { act } from "react";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { paneWidths } from "../../../../../ui/src/SidePane/index.tsx";
import { AskPaneHost } from "./host.tsx";
import { askPaneOf, askPaneKey, closeAskPane, openAskPane, resetAskPanes } from "./pane.ts";
import { screenFromHash, setScreenContext } from "./screen.ts";
import { openAsk } from "../providers/ask.ts";
import { sampleRuntime } from "../providers/misc-test-runtime.tsx";
import { ShellRuntimeProvider } from "../providers/runtime.tsx";
import type { ShellRuntime } from "../providers/runtime.tsx";
import { settingsData } from "../providers/settings.tsx";
import { vaultData } from "../providers/vault.tsx";
import { createSampleSettings } from "../../places/settings/sample.ts";
import { askAboutRecord } from "../providers/record-detail.tsx";
import { RecordPage, RecordPageDataProvider } from "../../places/records/recordpage/index.ts";
import { createSamplePage } from "../../places/records/recordpage/sample.ts";
import { ThreadsPage } from "../../places/chats/mounts/ThreadsPage.tsx";
import { SettingsDataProvider } from "../../places/settings/data.tsx";
import { SettingsPlace } from "../../places/settings/SettingsPlace.tsx";

const LOADING = { status: "loading" } as const;
const quiet = { query: () => ({ subscribe: () => () => undefined, getSnapshot: () => LOADING }) };

/** A runtime whose chat capabilities answer an Ask, and which records every place it is asked to open. */
function runtime(extra: (cap: string, input: Record<string, unknown>) => unknown = (cap) => { throw new Error(`${cap} is not part of this test`); }): { rt: ShellRuntime; opened: string[]; calls: { cap: string; input: Record<string, unknown> }[] } {
  const opened: string[] = [];
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  let n = 0;
  const rt = sampleRuntime({
    screens: quiet as never,
    opened,
    call: async (cap, raw) => {
      const input = raw as Record<string, unknown>;
      calls.push({ cap, input });
      if (cap === "chat.asks_of") return { threads: [], total: 0 };
      if (cap === "chat.start") return { thread: { threadId: `thr_${++n}` } };
      if (cap === "chat.open_as_chat") return { thread: { threadId: input["threadId"] } };
      if (cap === "agents.list") return { agents: [{ agentId: "agt_assistant", name: "Assistant", kind: "assistant", ownerId: "usr_irfad" }, { agentId: "agt_billing", name: "Billing", kind: "agent" }] };
      return extra(cap, input);
    },
  });
  // a principals snapshot that is the same object every read, as the shell's is
  const people = rt.principals.getSnapshot();
  (rt as { principals: unknown }).principals = { subscribe: () => () => undefined, getSnapshot: () => people };
  return { rt, opened, calls };
}

let mounts = 0;
/** A place with a door: it counts its mounts, so opening the pane beside it is seen not to remount it. */
function Place({ rt, thing }: { rt: ShellRuntime; thing: { kind: string; id: string; title: string } }): ReactElement {
  const once = useRef(false);
  useEffect(() => { if (!once.current) { once.current = true; mounts++; } }, []);
  return <View testID="the-place"><Pressable testID="door" onPress={() => openAsk(rt, "assistant", thing)}><Text>Ask</Text></Pressable></View>;
}

const host = (rt: ShellRuntime, place: string, body: ReactElement): ReactElement => <ShellRuntimeProvider value={rt}><AskPaneHost place={place} rt={rt}>{body}</AskPaneHost></ShellRuntimeProvider>;
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await flush(); };

/** Mounted roots are unmounted before the DOM stubs go, so nothing they started keeps the test process alive. */
const roots: { unmount(): void }[] = [];
async function mount(make: typeof createRoot, el: ReactElement): Promise<Node> {
  const r = make();
  roots.push(r);
  await act(async () => { r.render(el); });
  await flush();
  return r.container as unknown as Node;
}
async function unmountAll(): Promise<void> {
  while (roots.length > 0) { const r = roots.pop()!; await act(async () => { r.unmount(); }); }
}

test("the Vault and Settings doors open the pane in their own place about their thing, and nothing navigates to Chats", () => {
  resetAskPanes();
  const { rt, opened } = runtime();
  const settings = createSampleSettings();
  const doors: [string, () => void, { kind: string; id: string } | null][] = [
    ["vault", () => vaultData(rt).nav.ask?.("assistant", "chat", { kind: "vault_item", id: "vit_resend", title: "Resend" }), { kind: "vault_item", id: "vit_resend" }],
    ["vault", () => vaultData(rt).nav.addToAutomations?.({ id: "vit_resend", name: "Resend", handle: "#Resend" }), { kind: "vault_item", id: "vit_resend" }],
    ["settings", () => settingsData({ ...rt, screens: settings.data.screens, call: settings.data.call }).ask?.({ key: "appearance", title: "Appearance" }), { kind: "settings_page", id: "appearance" }],
  ];
  for (const [place, press, thing] of doors) {
    closeAskPane(place);
    setScreenContext(screenFromHash(place, ""));
    press();
    const s = askPaneOf(place);
    assert.ok(s, `${place}: the pane opened in ${place}`);
    assert.equal(s!.thing?.kind ?? null, thing?.kind ?? null, place);
    assert.equal(s!.thing?.id ?? null, thing?.id ?? null, place);
  }
  assert.deepEqual(opened, [], "no door opened another place");
  // a Vault item's Add to Automations carries its opening into the pane
  assert.match(askPaneOf("vault")!.first ?? "", /^Add Resend to Automations\./);
});

test("Settings: the page's Ask button opens the pane beside the page, about that page", async () => {
  const restore = installDom();
  try {
    resetAskPanes();
    const { rt, opened } = runtime();
    const s = createSampleSettings();
    const live = { ...rt, screens: s.data.screens, call: async (cap: string, input: unknown) => (cap.startsWith("chat.") || cap === "agents.list" ? rt.call(cap, input) : s.data.call(cap, input)) } as ShellRuntime;
    setScreenContext(screenFromHash("settings", "page=appearance"));
    const root = await mount(createRoot, host(live, "settings", <SettingsDataProvider value={settingsData(live)}><SettingsPlace initialPage="appearance" /></SettingsDataProvider>));
    await press(find(root, "settings-ask"));
    await settle();
    assert.ok(find(root, "ask-pane"), "the pane is drawn");
    assert.ok(find(root, "page-appearance"), "the page stays where it was");
    assert.equal(textOf(find(root, "ask-pane-chip")).trim(), "Appearance");
    assert.deepEqual(opened, []);
  } finally { await unmountAll(); restore(); }
});

test("the pane opens beside the place without remounting it; New, the chip's x, Escape and Open in Chats", async () => {
  const restore = installDom();
  try {
    resetAskPanes();
    mounts = 0;
    const { rt, opened, calls } = runtime();
    setScreenContext(screenFromHash("files", "subject=file:fil_lease"));
    const root = await mount(createRoot, host(rt, "files", <Place rt={rt} thing={{ kind: "file", id: "fil_lease", title: "Lease.pdf" }} />));
    assert.equal(find(root, "ask-pane"), null, "closed to begin with");
    await press(find(root, "door"));
    await settle();
    assert.ok(find(root, "ask-pane"), "the pane opens");
    assert.ok(find(root, "the-place"), "the place is still drawn beside it");
    assert.equal(mounts, 1, "and was not mounted again");
    assert.equal(textOf(find(root, "ask-pane-chip")).trim(), "Lease.pdf");
    assert.equal(textOf(find(root, "ask-pane-agent-name")), "Assistant", "the Assistant answers by default");
    const started = calls.filter((c) => c.cap === "chat.start");
    assert.equal(started.length, 1);
    assert.equal(started[0]!.input["kind"], "ask");
    assert.equal(started[0]!.input["scopeType"], "file");
    assert.equal(started[0]!.input["scopeId"], "fil_lease");
    // asking again about the same file continues the same thread: no second start
    await press(find(root, "door"));
    await settle();
    assert.equal(calls.filter((c) => c.cap === "chat.start").length, 1);
    // New: a fresh thread about the same file
    await press(find(root, "ask-pane-new"));
    await settle();
    assert.equal(calls.filter((c) => c.cap === "chat.start").length, 2);
    assert.equal(askPaneOf("files")!.fresh, 1);
    // the chip's x: about Files, not the file
    await press(find(root, "ask-pane-chip-remove"));
    await settle();
    assert.equal(find(root, "ask-pane-chip"), null);
    assert.equal(calls.filter((c) => c.cap === "chat.start").at(-1)!.input["scopeType"], "files");
    // Escape inside the pane closes it, and the place is as it was
    const pane = find(root, "ask-pane")!;
    let prevented = false;
    (pane.props["onKeyDown"] as (e: unknown) => void)({ key: "Escape", preventDefault: () => { prevented = true; } });
    await settle();
    assert.ok(prevented);
    assert.equal(find(root, "ask-pane"), null, "Escape closed it");
    assert.ok(find(root, "the-place"));
    assert.deepEqual(opened, [], "nothing so far left the place");
    // Open in Chats: listed, then opened as a full chat; the pane closes
    await press(find(root, "door"));
    await settle();
    await press(find(root, "ask-pane-open-chats"));
    await settle();
    assert.ok(calls.some((c) => c.cap === "chat.open_as_chat"));
    assert.equal(opened.length, 1);
    assert.match(opened[0]!, /"type":"thread"/);
    assert.equal(find(root, "ask-pane"), null);
  } finally { await unmountAll(); restore(); }
});

test("the agent dropdown lists the person's agents, Assistant first, and another agent has its own thread", async () => {
  const restore = installDom();
  try {
    resetAskPanes();
    const { rt, calls } = runtime();
    setScreenContext(screenFromHash("vault", ""));
    const root = await mount(createRoot, host(rt, "vault", <View />));
    openAskPane({ thing: { kind: "vault_item", id: "vit_resend", title: "Resend" } }, "vault");
    await settle();
    await press(find(root, "ask-pane-agent"));
    await settle();
    const menu = textOf(root);
    assert.ok(menu.indexOf("Assistant") >= 0 && menu.indexOf("Billing") > menu.indexOf("Assistant"));
    const { switchAskAgent } = await import("./pane.ts");
    switchAskAgent("vault", "agt_billing");
    await settle();
    assert.equal(textOf(find(root, "ask-pane-agent-name")), "Billing");
    assert.deepEqual(calls.filter((c) => c.cap === "chat.start").map((c) => (c.input["agentIds"] as string[])[0]), ["agt_assistant", "agt_billing"]);
  } finally { await unmountAll(); restore(); }
});

test("the pane's width is remembered per place", async () => {
  const restore = installDom();
  try {
    Dimensions.set({ window: { width: 1400, height: 900, scale: 1, fontScale: 1 } });
    resetAskPanes();
    paneWidths.reset(askPaneKey("records"));
    paneWidths.reset(askPaneKey("files"));
    const { rt } = runtime();
    const root = await mount(createRoot, host(rt, "records", <View />));
    openAskPane({ thing: null }, "records");
    await settle();
    const edge = (): Node => find(root, "side-pane-resize")!;
    assert.equal(edge().props["aria-valuenow"], 380, "the first width");
    (edge().props["onKeyDown"] as (e: unknown) => void)({ key: "ArrowLeft", preventDefault: () => undefined });
    await settle();
    assert.equal(paneWidths.get(askPaneKey("records")), 404, "remembered for Records");
    assert.equal(paneWidths.get(askPaneKey("files")), null, "not for Files");
    closeAskPane("records");
    await settle();
    openAskPane({ thing: null }, "records");
    await settle();
    assert.equal(edge().props["aria-valuenow"], 404, "opened again at the width the person left");
  } finally { await unmountAll(); restore(); }
});

test("a record page's Ask opens the pane beside the record, about it, and the page stays", async () => {
  const restore = installDom();
  try {
    resetAskPanes();
    const { rt, opened } = runtime();
    const page = createSamplePage();
    setScreenContext(screenFromHash("records", "subject=record:cl_0"));
    const data = { ...page.data, nav: { ...page.data.nav, ask: askAboutRecord } };
    const root = await mount(createRoot, host(rt, "records", <RecordPageDataProvider value={data}><RecordPage type="clients" recordId="cl_0" start={{ all: true, pane: false }} /></RecordPageDataProvider>));
    await settle();
    await press(find(root, "record-ask"));
    await settle();
    assert.ok(find(root, "ask-pane"));
    assert.ok(find(root, "record-page"), "the record page is still there");
    const s = askPaneOf("records")!;
    assert.equal(s.thing?.kind, "record");
    assert.equal(s.thing?.id, "cl_0");
    assert.equal(textOf(find(root, "ask-pane-chip")).trim(), s.thing?.title);
    assert.deepEqual(opened, []);
    assert.deepEqual(page.opened, []);
  } finally { await unmountAll(); restore(); }
});

test("Chats keeps every Ask under Ask history on the Threads page, so one can be opened there as a full chat", async () => {
  const restore = installDom();
  try {
    const { rt } = runtime((cap, input) => {
      if (cap === "threads.list") return (input["kind"] as string[])[0] === "ask"
        ? { threads: [{ threadId: "thr_a1", kind: "ask", title: "Ask about Lease.pdf", agents: [{ agentId: "agt_assistant", mode: "lead" }] }], total: 1 }
        : { threads: [], total: 0 };
      throw new Error(cap);
    });
    const chosen: string[] = [];
    const root = await mount(createRoot, <ThreadsPage rt={rt} nameOf={(id) => (id === "agt_assistant" ? "Assistant" : id)} openChat={(id) => chosen.push(id)} />);
    await settle();
    assert.ok(find(root, "ask-history"));
    assert.match(textOf(find(root, "ask-history")), /Ask about Lease\.pdf/);
    await press(find(root, "row-ask-thr_a1"));
    assert.deepEqual(chosen, ["thr_a1"]);
  } finally { await unmountAll(); restore(); }
});
