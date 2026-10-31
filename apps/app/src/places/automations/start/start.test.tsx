// The Automations start page: centred, three ways in, popular templates from the real catalogue. Each choice does one thing, and Ask Vyre opens in the tab.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import type { AutomationsData } from "../canvas/data.tsx";
import { createSampleAutomations, harbor, northwind } from "../sidebar/sample.ts";
import { AutomationsStart, AutomationsStartView, START_CHOICES, START_STYLE, popularTemplates } from "./AutomationsStart.tsx";
import type { StartChoice } from "./AutomationsStart.tsx";
import type { TemplateItem } from "../operations/read.ts";
import { ShellRuntimeProvider } from "../../../shell/providers/runtime.tsx";
import { sampleRuntime } from "../../../shell/providers/misc-test-runtime.tsx";
import AutomationsPlace from "../../../shell/providers/automations.tsx";

installDom();

const CATALOG = ["lead-follow-up", "invoice-reminders", "weekly-digest", "meeting-notes", "new-client-welcome", "review-request", "stale-lead-nudge", "backup-check"].map((key, i) => ({
  key, title: `Template ${i + 1}`, summary: `Does thing ${i + 1}.`, starts: "Every day", setUp: [], steps: [{ id: "a", key: i % 2 ? "send_email" : "records.find", title: "First" }],
}));
const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style && typeof style === "object" ? (style as Record<string, unknown>) : {});
const tileKeys = (root: Node): string[] => CATALOG.map((t) => t.key).filter((k) => find(root, `start-template-${k}`) !== null);

function wired(space = { ...harbor, specs: [], groups: [] }) {
  const s = createSampleAutomations(space);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const data: AutomationsData = {
    ...s.data,
    call: async (cap, input) => {
      calls.push({ cap, input });
      if (cap === "automations.templates.list") return { templates: CATALOG };
      if (cap === "automations.create") return { automation: { id: "aut_new" } };
      if (cap === "automations.templates.use") return { automation: { id: "aut_from_template" } };
      return s.data.call(cap, input);
    },
    nav: { ...s.data.nav, openAutomation: (id) => { opened.push(id); } },
  };
  return { data, calls, opened };
}

test("with no automations the page is a centred 'Automate something' with three choices and the first six catalogue templates", async () => {
  const { data } = wired();
  const root = await mount(createRoot, <AutomationsDataProvider value={data}><AutomationsStart onTemplates={() => undefined} onAsk={() => undefined} /></AutomationsDataProvider>);
  await flush();
  assert.equal(textOf(find(root, "automations-start-title")), "Automate something");
  for (const c of START_CHOICES) assert.ok(find(root, `start-${c.key}`), c.title);
  assert.deepEqual(START_CHOICES.map((c) => c.title), ["Start from a template", "Blank automation", "Ask Vyre to build it"]);
  assert.deepEqual(tileKeys(root), CATALOG.slice(0, 6).map((t) => t.key), "six tiles, in the catalogue's order");
  assert.ok(textOf(find(root, "start-template-lead-follow-up")).includes("Does thing 1."), "a tile carries a name and one line");
  const page = find(root, "automations-start")!;
  // react-native-web turns the content style into atomic class names; the content box centres both ways and fills the body
  const body = page.children?.find((c): c is Node => typeof c === "object");
  const cls = String(body?.props["className"] ?? "");
  assert.ok(/r-justifyContent-\w+/.test(cls) && /r-alignItems-\w+/.test(cls) && /r-flexGrow-\w+/.test(cls), "the content is centred in the body, both ways");
  assert.deepEqual([flat(START_STYLE.center)["justifyContent"], flat(START_STYLE.center)["alignItems"], flat(START_STYLE.center)["flexGrow"]], ["center", "center", 1]);
  assert.ok(!/—|§/.test(textOf(page)), "no em dash and no section sign");
});

test("popularTemplates takes at most six from the catalogue and none when it has not loaded", () => {
  assert.equal(popularTemplates(CATALOG as TemplateItem[]).length, 6);
  assert.equal(popularTemplates(CATALOG.slice(0, 2) as TemplateItem[]).length, 2);
  assert.deepEqual(popularTemplates(null), []);
});

test("each choice calls its own action", async () => {
  const { data, calls, opened } = wired();
  const hits: string[] = [];
  const root = await mount(createRoot, <AutomationsDataProvider value={data}><AutomationsStart onTemplates={() => hits.push("templates")} onAsk={() => hits.push("ask")} /></AutomationsDataProvider>);
  await flush();
  await press(find(root, "start-template"));
  await press(find(root, "start-ask"));
  assert.deepEqual(hits, ["templates", "ask"]);
  assert.equal(calls.filter((c) => c.cap === "automations.create").length, 0, "the other two choices make nothing");
  await press(find(root, "start-blank"));
  await flush();
  assert.deepEqual(calls.filter((c) => c.cap === "automations.create").map((c) => c.input), [{ name: "New automation" }]);
  assert.deepEqual(opened, ["aut_new"], "the blank automation opens");
});

test("a template tile makes the draft from that template and opens it", async () => {
  const { data, calls, opened } = wired();
  const root = await mount(createRoot, <AutomationsDataProvider value={data}><AutomationsStart onTemplates={() => undefined} onAsk={() => undefined} /></AutomationsDataProvider>);
  await flush();
  await press(find(root, "start-template-meeting-notes"));
  await flush();
  assert.deepEqual(calls.filter((c) => c.cap === "automations.templates.use").map((c) => c.input), [{ templateKey: "meeting-notes" }]);
  assert.deepEqual(opened, ["aut_from_template"]);
});

test("when the person has automations the heading is 'Pick an automation', the three choices stay and the tiles go", async () => {
  const { data } = wired(northwind);
  const root = await mount(createRoot, <AutomationsDataProvider value={data}><AutomationsStart onTemplates={() => undefined} onAsk={() => undefined} /></AutomationsDataProvider>);
  await flush();
  assert.equal(textOf(find(root, "automations-start-title")), "Pick an automation");
  for (const c of START_CHOICES) assert.ok(find(root, `start-${c.key}`));
  assert.deepEqual(tileKeys(root), []);
  const picks: StartChoice[] = [];
  const view = await mount(createRoot, <AutomationsStartView hasAutomations templates={CATALOG as TemplateItem[]} onChoose={(c) => picks.push(c)} onUseTemplate={() => undefined} />);
  await press(find(view, "start-ask"));
  assert.deepEqual(picks, ["ask"]);
});

test("Ask Vyre opens the assistant in a pane of the tab and does not open Chats", async () => {
  const { data, opened } = wired();
  const rt = sampleRuntime({ screens: data.screens, call: data.call, opened: [] });
  // the sample runtime builds a new principals snapshot on every read, which a mounted place treats as a change forever
  const people = { status: "ready", data: rt.principals.getSnapshot().status === "ready" ? (rt.principals.getSnapshot() as { data: unknown[] }).data : [] };
  (rt as { principals: unknown }).principals = { subscribe: () => () => undefined, getSnapshot: () => people };
  const asked: unknown[] = [];
  const real = rt.open;
  (rt as { open: typeof rt.open }).open = ((t: unknown) => { asked.push(t); return real(t as never); }) as typeof rt.open;
  const root = await mount(createRoot, <ShellRuntimeProvider value={rt}><AutomationsPlace place="automations" /></ShellRuntimeProvider>);
  await flush();
  assert.equal(find(root, "automations-ask-pane"), null, "closed to begin with");
  await press(find(root, "start-ask"));
  await flush();
  assert.ok(find(root, "automations-ask-pane"), "the pane opens beside the body");
  assert.ok(textOf(find(root, "automations-ask-hint")).length > 0);
  assert.deepEqual(asked, [], "nothing navigated to Chats");
  assert.deepEqual(opened, []);
});
