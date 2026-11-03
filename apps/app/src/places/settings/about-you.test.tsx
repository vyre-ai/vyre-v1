// Settings > Memory and privacy > About you: the two parts with what each is for, where each fact came from, a suggestion waiting for a yes, moving between the parts, editing in place with
// Enter, Forget with Undo, and Erase completely only after the confirm in the row.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { SettingsDataProvider } from "./data.tsx";
import { SavedBar, SavedProvider } from "./saved.tsx";
import { AboutYou, MemoryPage, sourceText } from "./AboutYou.tsx";
import type { ProfileFact } from "./AboutYou.tsx";
import { createSampleSettings, northwind } from "./sample.ts";

installDom();

async function page() {
  const s = createSampleSettings(northwind);
  const opened: string[] = [];
  s.data.nav.openLink = (l: string) => void opened.push(l);
  const root = await mount(createRoot, <SavedProvider><SettingsDataProvider value={s.data}><AboutYou /><SavedBar /></SettingsDataProvider></SavedProvider>);
  await flush();
  return { s, root, opened };
}
const partText = (root: Node, place: "public" | "private"): string => textOf(find(root, `about-${place}`));
const key = async (n: Node | null, k: string): Promise<void> => { await act(async () => { (n!.props.onKeyDown as ((e: unknown) => void) | undefined)?.({ key: k, nativeEvent: { key: k }, preventDefault() {}, stopPropagation() {}, isDefaultPrevented: () => false, isPropagationStopped: () => false }); }); };
async function menuItem(root: Node, factId: string, label: string): Promise<void> {
  await press(find(root, `about-more-${factId}`));
  await flush();
  await press(find(root, `menu-item-${label}`));
  await flush();
}

test("two parts, each saying who can use it; the basics from Profile are public; each fact says who learned it", async () => {
  const { root } = await page();
  assert.match(partText(root, "public"), /Public/);
  assert.match(partText(root, "public"), /Teammates' chats can use this\./);
  assert.match(partText(root, "private"), /Only your own chats\./);
  assert.match(partText(root, "public"), /Time zone: Asia\/Karachi/);
  assert.match(partText(root, "public"), /Prefers short client emails/);
  assert.match(partText(root, "private"), /Picks up the kids/);
  assert.doesNotMatch(partText(root, "public"), /Picks up the kids/);
  assert.doesNotMatch(textOf(root), /—/, "no em dashes");
  const f = { factId: "f", text: "t", place: "private", agentId: "agt_intake", sourceKind: "chat", sourceRef: "thr", learnedAt: Date.UTC(2026, 10, 1) } as ProfileFact;
  assert.equal(sourceText(f, () => "Intake"), "Learned by Intake, 1 Nov");
  assert.equal(sourceText({ ...f, sourceKind: "manual" }, () => "Intake"), "You added this, 1 Nov");
});

test("an agent's suggestion waits with Add to public and Keep private; Add to public moves it, with Undo", async () => {
  const { s, root } = await page();
  assert.match(partText(root, "private"), /An agent asks: add to your public profile\?/);
  await press(find(root, "about-accept-fct_sug"));
  await flush();
  assert.match(partText(root, "public"), /Out of office every second Friday/);
  assert.ok(s.calls.some((c) => c.cap === "memory.profile.move" && JSON.stringify(c.input) === JSON.stringify({ factId: "fct_sug", to: "public" })));
  assert.match(textOf(root), /Added to your public profile\./);
});

test("moving between the parts from the row menu", async () => {
  const { root } = await page();
  await menuItem(root, "fct_pub1", "Move to private");
  assert.match(partText(root, "private"), /Prefers short client emails/);
  await menuItem(root, "fct_pub1", "Move to public");
  assert.match(partText(root, "public"), /Prefers short client emails/);
});

test("a press on a fact opens the chat line it came from", async () => {
  const { root, opened } = await page();
  await press(find(root, "row-about.fct_priv1"));
  assert.deepEqual(opened, ["vyre://thread/thr_sample?m=msg_2"]);
});

test("Edit turns the row into a field: Enter saves, Escape cancels", async () => {
  const { s, root } = await page();
  await menuItem(root, "fct_priv2", "Edit");
  const field = find(root, "about-edit-fct_priv2");
  assert.ok(field);
  await typeInto(field, "Saving for a house.");
  await key(find(root, "about-edit-fct_priv2"), "Enter");
  await flush();
  assert.ok(s.calls.some((c) => c.cap === "memory.fact.correct"));
  assert.match(partText(root, "private"), /Saving for a house\./);
  const saves = s.calls.filter((c) => c.cap === "memory.fact.correct").length;
  await menuItem(root, "fct_priv2", "Edit");
  await typeInto(find(root, "about-edit-fct_priv2"), "Something else");
  await key(find(root, "about-edit-fct_priv2"), "Escape");
  await flush();
  assert.equal(find(root, "about-edit-fct_priv2"), null);
  assert.equal(s.calls.filter((c) => c.cap === "memory.fact.correct").length, saves);
  assert.match(partText(root, "private"), /Saving for a house\./);
});

test("Forget takes it off with an Undo that brings it back", async () => {
  const { root } = await page();
  await menuItem(root, "fct_priv1", "Forget");
  assert.doesNotMatch(partText(root, "private"), /Picks up the kids/);
  assert.match(textOf(root), /Forgotten\. History keeps it\./);
  await press(find(root, "undo"));
  await flush();
  assert.match(partText(root, "private"), /Picks up the kids/);
});

test("Erase completely asks first, in the row: Cancel keeps it, Erase removes it for good", async () => {
  const { s, root } = await page();
  await menuItem(root, "fct_priv2", "Erase completely");
  assert.match(textOf(find(root, "about-erase-confirm-fct_priv2")), /This can't be undone\./);
  await press(find(root, "about-erase-cancel-fct_priv2"));
  assert.equal(find(root, "about-erase-confirm-fct_priv2"), null);
  assert.ok(!s.calls.some((c) => c.cap === "memory.erase"));
  await menuItem(root, "fct_priv2", "Erase completely");
  await press(find(root, "about-erase-fct_priv2"));
  await flush();
  assert.ok(s.calls.some((c) => c.cap === "memory.erase" && (c.input as { factIds: string[] }).factIds[0] === "fct_priv2"));
  assert.doesNotMatch(partText(root, "private"), /Saving for a house/);
});

test("adding a fact by hand to either part, with Enter", async () => {
  const { root } = await page();
  await typeInto(find(root, "about-add-public"), "Writes in British English.");
  await key(find(root, "about-add-public"), "Enter");
  await flush();
  assert.match(partText(root, "public"), /Writes in British English\./);
});

test("Who pays for memory: nothing to pick for your own memory, the plain line and today's use", async () => {
  const s = createSampleSettings(northwind);
  const root = await mount(createRoot, <SavedProvider><SettingsDataProvider value={s.data}><MemoryPage /></SettingsDataProvider></SavedProvider>);
  await flush();
  const text = textOf(root);
  assert.match(text, /Your memory/);
  assert.match(text, /Learning uses the AI account you chat with, on its cheapest model, up to your daily limit\./);
  assert.match(textOf(find(root, "memory-learning-today")), /14 of 200 today/);
  assert.equal(find(root, "ctl-memory-key-person"), null);
  assert.ok(s.calls.some((c) => c.cap === "memory.learning.today"));
});
