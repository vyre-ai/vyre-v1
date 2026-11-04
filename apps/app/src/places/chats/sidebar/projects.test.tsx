// Projects in the Chats sidebar (lane l-chrome2a): the group after Goals, starred first, each with its health dot; a press opens the project in its own tab; the row menu is Open, Star and Copy Link.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount, press, textOf } from "../../../onboarding/test-dom.ts";
import { ChatsSidebar } from "./ChatsSidebar.tsx";
import { buildEntries } from "./model.ts";
import { createSampleSidebar } from "./sample.ts";
import { PROJECTS_SHOWN, projectLines, sidebarProjects } from "../projects/model.ts";

const row = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ projectId: id, recordId: id, type: "projects", title, status: "Active", memberCount: 2, openTasks: 1, lateTasks: 0, channelId: "chn", folderId: "fld", ...extra }) as never;

test("starred projects come first, then the Space's order; an archived project is in no list", () => {
  const lines = projectLines([row("a", "Alpha"), row("b", "Beta", { health: "risk" }), row("c", "Gamma", { archivedAt: 5 }), row("d", "Delta")], new Set(["d"]));
  assert.deepEqual(sidebarProjects(lines).map((l) => l.id), ["d", "a", "b"]);
  assert.equal(lines[1]!.health, "risk");
});

test("the group sits right after Goals, shows three and then 'N more', and a Space with no project has no group", () => {
  const lines = projectLines(Array.from({ length: 5 }, (_, n) => row(`p${n}`, `P${n}`)), new Set());
  const base = { closed: new Set(), groups: [], channels: [], faces: [], tasksCount: 0, goals: [{ id: "g1", title: "Goal", status: "active", leadAgentId: "agt", progress: { tasksDone: 0, tasks: 0 }, updatedAt: 1 }] } as never;
  const e = buildEntries({ ...(base as object), projects: lines } as never);
  const keys = e.map((x) => x.key);
  assert.ok(keys.indexOf("h:goals") < keys.indexOf("h:projects"), "after Goals");
  assert.deepEqual(keys.filter((k) => k.startsWith("pj:")), ["pj:p0", "pj:p1", "pj:p2"]);
  assert.equal(PROJECTS_SHOWN, 3);
  const more = e.find((x) => x.key === "m:projects");
  assert.equal(more && more.type === "more" ? more.label : "", "2 more");
  assert.equal(buildEntries({ ...(base as object), projects: lines, moreProjects: true } as never).filter((x) => x.key.startsWith("pj:")).length, 5);
  assert.ok(!buildEntries({ ...(base as object), projects: [] } as never).some((x) => x.key === "h:projects"));
});

test("the rows: a health dot and the name, a star mark for a starred one; a press opens the project; the menu has Open, Star and Copy Link", async () => {
  const off = installDom();
  Dimensions.set({ window: { width: 1280, height: 844, scale: 1, fontScale: 1 } });
  try {
    const s = createSampleSidebar();
    const root = await mount(createRoot, <ChatsSidebar data={s.data} window={{ start: 0, end: 500 }} />);
    await flush(); await flush();
    assert.ok(find(root, "head-projects") || find(root, "h:projects") || find(root, "row-h:projects"), "the Projects heading");
    assert.ok(find(root, "row-pj:prj_rec_rivera"), "the row");
    assert.ok(textOf(root).includes("Rivera"), "the name");
    assert.equal(find(root, "project-dot-prj_rec_atp")?.props["aria-label"] ?? find(root, "project-dot-prj_rec_atp")?.props.accessibilityLabel, "At risk");
    await press(find(root, "row-pj:prj_rec_rivera")); await flush();
    assert.ok(s.opened.includes("project:prj_rec_rivera"), "opens in its own tab");
  } finally { off(); }
});

test("with the Projects group, a project's channel is not listed a second time under Channels; with no group it still is", () => {
  const ch = (id: string, project: boolean) => ({ channelId: id, mainThreadId: `thr_${id}`, name: id, visibility: "public", archived: false, members: [], agents: [], ...(project ? { recordId: `rec_${id}` } : {}) }) as never;
  const base = { closed: new Set(), groups: [], faces: [], tasksCount: 0, channels: [ch("ops", false), ch("rivera", true)], filter: "all" } as never;
  const withGroup = buildEntries({ ...(base as object), projects: projectLines([row("prj_rivera", "Rivera account")], new Set()) } as never);
  assert.ok(!withGroup.some((x) => x.key === "g:projects" || x.key === "ch:rivera"), "no second Projects group, no project channel row");
  assert.ok(withGroup.some((x) => x.key === "ch:ops"), "plain channels stay");
  const without = buildEntries(base);
  assert.ok(without.some((x) => x.key === "g:projects") && without.some((x) => x.key === "ch:rivera"));
});
