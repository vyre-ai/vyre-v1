// Settings > Memory and privacy > Lessons from your corrections: the switch, every lesson with how it was caught, which agent, when, how often it was used and who may read it, Edit in place, Forget with
// Undo, and nothing listed while the switch is off.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { SettingsDataProvider } from "./data.tsx";
import { LessonsSection, lessonSub } from "./Lessons.tsx";
import type { LessonRowOut } from "./Lessons.tsx";
import { SavedBar, SavedProvider } from "./saved.tsx";
import { createSampleSettings, northwind } from "./sample.ts";

installDom();

const T = Date.UTC(2026, 10, 3);
const seed = (): LessonRowOut[] => [
  { factId: "fct_l1", text: "Notes to Sara: three lines, the number first", agentId: "agt_intake", sourceKind: "chat", sourceRef: "thr_1", sourceLink: "/chats/thr_1#msg_3", learnedAt: T, lesson: { how: "edit", used: 1, scope: "you" } },
  { factId: "fct_l2", text: "Never send anything to a client before you have seen it", agentId: "agt_docs", sourceKind: "chat", sourceRef: "thr_2", learnedAt: T - 6 * 86_400_000, lesson: { how: "refuse", used: 5, scope: "space" } },
];

async function page() {
  const s = createSampleSettings(northwind);
  let lessons = seed();
  let on = true;
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const base = s.data.call.bind(s.data);
  s.data.call = (async (cap: string, input: Record<string, unknown>) => {
    calls.push({ cap, input });
    switch (cap) {
      case "settings.get": return { row: { value: on } };
      case "settings.set": on = input["value"] === true; return { row: { value: on }, previous: !on };
      case "memory.facts.list": return { facts: lessons };
      case "memory.forget": lessons = lessons.filter((l) => !(input["factIds"] as string[]).includes(l.factId)); return {};
      case "memory.restore": lessons = seed(); return {};
      case "memory.fact.correct": lessons = lessons.map((l) => (l.factId === input["factId"] ? { ...l, text: String(input["text"]) } : l)); return { fact: { factId: String(input["factId"]) } };
      default: return base(cap, input as never);
    }
  }) as never;
  const root = await mount(createRoot, <SavedProvider><SettingsDataProvider value={s.data}><LessonsSection /><SavedBar /></SettingsDataProvider></SavedProvider>);
  await flush();
  return { s, root, calls };
}
const key = async (n: Node | null, k: string): Promise<void> => { await act(async () => { (n!.props.onKeyDown as ((e: unknown) => void) | undefined)?.({ key: k, nativeEvent: { key: k }, preventDefault() {}, stopPropagation() {}, isDefaultPrevented: () => false }); }); };

test("each lesson says how it was caught, which agent learned it, when, how often it was used and who may read it", async () => {
  const { root } = await page();
  const t = textOf(root);
  assert.match(t, /Lessons from your corrections/);
  assert.match(t, /Notes to Sara: three lines, the number first/);
  assert.match(t, /You edited a draft · /);
  assert.match(t, /used 1 time · Only you/);
  assert.match(t, /You said no · .* · 28 Oct · used 5 times · Shared with the Space/);
  assert.doesNotMatch(t, /—|§/);
  assert.equal(lessonSub({ ...seed()[0]!, lesson: undefined }, () => "Mira").startsWith("From a correction · Mira"), true);
});

test("the switch turns learning off and hides the list; Undo turns it back on", async () => {
  const { root, calls } = await page();
  await press(find(root, "lessons-switch"));
  await flush();
  assert.deepEqual(calls.filter((c) => c.cap === "settings.set").map((c) => c.input), [{ key: "memory.lessons", value: false }]);
  assert.match(textOf(root), /Off\. Agents do not keep lessons from what you change\./);
  assert.doesNotMatch(textOf(root), /Notes to Sara/);
  assert.match(textOf(root), /Agents stop keeping lessons\./);
  await press(find(root, "undo"));
  await flush();
  assert.match(textOf(root), /Notes to Sara/);
});

test("Edit in place saves with Enter and keeps the old wording in history; Forget takes it away with Undo", async () => {
  const { root, calls } = await page();
  await press(find(root, "lesson-more-fct_l1"));
  await flush();
  await press(find(root, "menu-item-Edit"));
  await flush();
  await typeInto(find(root, "lesson-edit-fct_l1"), "Notes to Sara: two lines");
  await key(find(root, "lesson-edit-fct_l1"), "Enter");
  await flush();
  assert.ok(calls.some((c) => c.cap === "memory.fact.correct" && c.input["text"] === "Notes to Sara: two lines"));
  assert.match(textOf(root), /Notes to Sara: two lines/);
  await press(find(root, "lesson-more-fct_l2"));
  await flush();
  await press(find(root, "menu-item-Forget"));
  await flush();
  assert.doesNotMatch(textOf(root), /Never send anything to a client/);
  assert.match(textOf(root), /Forgotten\. The agent stops using it\./);
});
