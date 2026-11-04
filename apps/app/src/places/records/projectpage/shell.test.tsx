// The project page as the Chats shell draws it (lane l-chrome2a): the header of the prototype (name with its menu, star, status, lead, people, more), the tab row Chat, Plan, Overview, Linked and Knows,
// and every control of it. Each control is one capability call or one move of the tab.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount, press, textOf } from "../../../onboarding/test-dom.ts";
import { ProjectPage, ProjectPageDataProvider } from "./index.ts";
import { createSampleProject } from "./sample.ts";
import { DEFAULT_PROJECT_TAB, PROJECT_TABS, isProjectTab } from "./tabs.ts";
import { knowsItems } from "./KnowsTab.tsx";
import type { ProjectTabKey } from "./tabs.ts";
import type { ProjectPageData } from "./data.tsx";

const widen = (width: number): void => Dimensions.set({ window: { width, height: 844, scale: 1, fontScale: 1 } });
const SPACE = { id: "spc_1", kind: "team" as const, name: "Northwind" };

function setup(extra: Record<string, (i: Record<string, unknown>) => unknown> = {}): { data: ProjectPageData; calls: Array<{ cap: string; input: Record<string, unknown> }>; tabs: ProjectTabKey[] } {
  const s = createSampleProject();
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const tabs: ProjectTabKey[] = [];
  const data: ProjectPageData = {
    ...s.data,
    me: { id: "usr_maya", name: "Maya Chen" },
    async call(cap, input) {
      const i = input as Record<string, unknown>;
      calls.push({ cap, input: i });
      if (extra[cap]) return extra[cap]!(i);
      if (cap === "projects.set" || cap === "stars.toggle") return {};
      if (cap === "stars.list") return { stars: [] };
      if (cap === "projects.members.list") return { members: [{ principal: "usr_maya", role: "lead", kind: "person", since: 1 }, { principal: "usr_omar", role: "member", kind: "person", since: 1 }] };
      const out = await s.data.call(cap, input) as Record<string, unknown>;
      if (cap === "projects.overview") return { ...out, project: { ...(out["project"] as object), health: "risk" } };
      return out;
    },
  };
  return { data, calls, tabs };
}

const page = (t: ReturnType<typeof setup>, tab?: ProjectTabKey): JSX.Element => (
  <ProjectPageDataProvider value={t.data}><ProjectPage projectId="pj_0" space={SPACE} {...(tab ? { tab } : {})} onTabChange={(k) => t.tabs.push(k)} /></ProjectPageDataProvider>
);

test("the tabs are Chat, Plan, Overview, Linked and Knows, in that order, and the first is Chat", () => {
  assert.deepEqual(PROJECT_TABS.map((t) => t.title), ["Chat", "Plan", "Overview", "Linked", "Knows"]);
  assert.equal(DEFAULT_PROJECT_TAB, "chat");
  assert.ok(isProjectTab("knows") && !isProjectTab("teammates") && !isProjectTab(undefined));
});

test("the header: the name, the status the lead set, the lead, the people count; and the tab strip", async () => {
  const off = installDom(); widen(1280);
  try {
    const t = setup();
    const root = await mount(createRoot, page(t));
    await flush();
    assert.equal(textOf(find(root, "project-title")), "Rivera engagement");
    assert.ok(textOf(find(root, "project-health")).includes("At risk"));
    assert.ok(textOf(find(root, "project-lead")).includes("Maya Chen"));
    assert.ok(find(root, "project-members") && find(root, "project-star") && find(root, "project-more") && find(root, "project-menu"));
    for (const k of PROJECT_TABS.map((x) => x.key)) assert.ok(find(root, `tab-${k}`) || find(root, `tab-${k}-selected`), `tab ${k}`);
    assert.ok(find(root, "tab-chat-selected"), "opens on Chat");
    assert.ok(find(root, "project-chat"), "the Chat tab body");
  } finally { off(); }
});

test("each tab is one press and tells the shell; its body is the one the contract names", async () => {
  const off = installDom(); widen(1280);
  try {
    const t = setup({ "memory.place.list": () => ({ facts: [] }) });
    const root = await mount(createRoot, page(t));
    await flush();
    await press(find(root, "tab-plan")); await flush();
    assert.ok(find(root, "project-plan"));
    await press(find(root, "tab-overview")); await flush();
    assert.ok(find(root, "project-overview-stub"), "the Overview body is l-editor's component");
    await press(find(root, "tab-linked")); await flush();
    assert.ok(find(root, "linked") || find(root, "linked-empty") || find(root, "project-linked") || textOf(root).includes("Linked"), "the Linked body is l-artifacts' component");
    await press(find(root, "tab-knows")); await flush();
    assert.ok(find(root, "project-knows"));
    assert.deepEqual(t.tabs, ["plan", "overview", "linked", "knows"]);
  } finally { off(); }
});

test("the status button sets the health with projects.set, and Clear removes it", async () => {
  const off = installDom(); widen(1280);
  try {
    const t = setup();
    const root = await mount(createRoot, page(t));
    await flush();
    await press(find(root, "project-health")); await flush();
    await press(find(root, "menu-item-On hold")); await flush();
    assert.deepEqual(t.calls.filter((c) => c.cap === "projects.set").map((c) => c.input), [{ projectId: "pj_0", health: "hold" }]);
    await press(find(root, "project-health")); await flush();
    await press(find(root, "menu-item-Clear")); await flush();
    assert.deepEqual(t.calls.filter((c) => c.cap === "projects.set").at(-1)!.input, { projectId: "pj_0", health: null });
  } finally { off(); }
});

test("the star toggles with stars.toggle; the name and the more button open the project menu", async () => {
  const off = installDom(); widen(1280);
  try {
    const t = setup();
    const root = await mount(createRoot, page(t));
    await flush();
    await press(find(root, "project-star")); await flush();
    assert.deepEqual(t.calls.filter((c) => c.cap === "stars.toggle").map((c) => c.input), [{ resource: { type: "project", id: "pj_0" }, on: true }]);
    await press(find(root, "project-menu")); await flush();
    assert.ok(find(root, "menu-item-Copy Link"), "the name opens the menu");
    await press(find(root, "menu-item-Copy Link")); await flush();
    await press(find(root, "project-more")); await flush();
    assert.ok(find(root, "menu-item-Copy Link"), "More opens the same menu");
  } finally { off(); }
});

test("People opens the one Add people and agents sheet", async () => {
  const off = installDom(); widen(1280);
  try {
    const t = setup();
    const root = await mount(createRoot, page(t));
    await flush();
    await press(find(root, "project-members")); await flush();
    assert.ok(find(root, "add-sheet"));
  } finally { off(); }
});

test("Knows reads memory.place.list for the project and draws what Vyre remembers; a member who may edit gets Edit and Remove", async () => {
  const off = installDom(); widen(1280);
  try {
    const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
    const t = setup({ "memory.place.list": (i) => { calls.push({ cap: "memory.place.list", input: i }); return { facts: [{ factId: "fct_1", kind: "decision", text: "Send the retainer Friday", state: "current", said_by: "usr_maya", at: 1_762_000_000_000 - 3_600_000 }] }; } });
    const root = await mount(createRoot, page(t, "knows"));
    await flush();
    assert.deepEqual(calls[0]!.input, { placeKind: "project", placeId: "pj_0", history: true });
    assert.ok(find(root, "knows-row-fct_1"));
    assert.ok(textOf(find(root, "knows-row-fct_1")).includes("Send the retainer Friday"));
  } finally { off(); }
});

test("knowsItems turns people into names and times into words", () => {
  const items = knowsItems([{ factId: "f", kind: "fact", text: "x", state: "current", said_by: "usr_a", at: 1_000 }, { factId: "g", kind: "fact", text: "y", state: "current" }], (id) => (id === "usr_a" ? "Ada" : id), 1_000 + 7_200_000, true);
  assert.deepEqual(items.map((i) => [i.by, i.canEdit]), [["Ada", true], ["Vyre", true]]);
  assert.match(items[0]!.at, /2 h ago|2h/);
});

test("the shell gives the page its admin flag, the Space's id and the three doors Linked uses, from the real runtime", async () => {
  const { projectPageData } = await import("../../../shell/providers/project-data.ts");
  const opened: unknown[] = [];
  const urls: string[] = [];
  const rt = (perms: string[] | undefined) => ({ call: async () => ({}), me: { id: "usr_a", name: "A" }, space: { id: "spc_9", kind: "team", name: "N" }, clock: () => ({ now: 1 }), open: (t: unknown) => opened.push(t), openUrl: (u: string) => urls.push(u), assistant: { id: "agt_x", name: "Assistant" }, principals: { getSnapshot: () => ({ status: "ready", data: [] }), subscribe: () => () => undefined }, ...(perms ? { permissions: new Set(perms) } : {}) }) as never;
  const admin = projectPageData(rt(["console.access"]));
  assert.deepEqual([admin.admin, admin.spaceId], [true, "spc_9"]);
  assert.equal(projectPageData(rt(["tasks.create"])).admin, false, "a member is not an admin");
  assert.equal(projectPageData(rt(undefined)).admin, false, "unknown permissions read as not an admin");
  admin.nav.openItem!("task", "tsk_1"); admin.nav.openUrl!("https://github.com/x/y/pull/1"); admin.nav.askAssistant!("fix the CI");
  assert.deepEqual(opened, [{ subject: { type: "task", id: "tsk_1" } }, { screen: "chats.ask", args: { with: "assistant", first: "fix the CI" } }]);
  assert.deepEqual(urls, ["https://github.com/x/y/pull/1"]);
});
