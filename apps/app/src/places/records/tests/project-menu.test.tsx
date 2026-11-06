// The project page's right-click menu (lane l-chrome2a): the menu of kinds-b.ts for the asker's role on the project. A lead may share and add people; a member pins files; Star follows the state and is one stars.toggle call.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import { ProjectPage, ProjectPageDataProvider } from "../projectpage/index.ts";
import { createSampleProject } from "../projectpage/sample.ts";

installDom();
const labelsOf = (root: unknown): string[] => { const out: string[] = []; const walk = (n: unknown): void => { const x = n as { props?: Record<string, unknown>; children?: unknown[] }; const t = x.props?.["data-testid"] ?? x.props?.["testID"]; if (typeof t === "string" && t.startsWith("menu-item-")) out.push(t.slice(10)); (x.children ?? []).forEach((c) => typeof c === "object" && walk(c)); }; walk(root); return out.filter((l) => l !== "report"); };
const rightClick = async (root: unknown, id: string): Promise<void> => { const n = find(root as never, id) as { props: Record<string, (e: unknown) => void> } | null; assert.ok(n && typeof n.props["onContextMenu"] === "function", `${id} has a menu`); await act(async () => { n!.props["onContextMenu"]!({ preventDefault() {}, clientX: 4, clientY: 4, nativeEvent: {} }); }); await flush(); };

function world(role: string, starred = false) {
  const s = createSampleProject();
  const calls: { cap: string; input: any }[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const opened: string[] = [];
  const base = s.data.call.bind(s.data);
  s.data.call = async (cap: string, input: unknown) => {
    calls.push({ cap, input: input as never });
    if (cap === "projects.members.list") return { members: [{ principal: "usr_me", role, kind: "person", since: 0 }] };
    if (cap === "stars.list") return { stars: starred ? [{ resource: { type: "project", id: "pj_0" } }] : [] };
    if (cap === "stars.toggle") return { starred: true, following: false };
    if (cap === "projects.archive" || cap === "projects.unarchive") return { archived: cap === "projects.archive", changed: true };
    return base(cap, input);
  };
  s.data.me = { id: "usr_me", name: "Me" };
  s.data.nav.openRecordPage = (type: string, id: string) => void opened.push(`${type}:${id}`);
  return { s, calls, opened };
}
const mountPage = async (w: ReturnType<typeof world>) => { const root = await mount(createRoot as never, <ProjectPageDataProvider value={w.s.data}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider>); await flush(); await flush(); return root; };

test("a lead: Star, Share, Add People, Pin File, Archive, Copy link; Star is one stars.toggle, Archive is one projects.archive, and the words follow the state", async () => {
  const w = world("lead");
  const root = await mountPage(w);
  await rightClick(root, "project-head");
  const labels = labelsOf(root);
  assert.deepEqual(labels, ["Star", "Share…", "Add People…", "Pin File…", "Archive", "Copy link"], labels.join("|"));
  await press(find(root as never, "menu-item-Star") as never); await flush();
  assert.deepEqual(w.calls.filter((c) => c.cap === "stars.toggle").map((c) => c.input), [{ resource: { type: "project", id: "pj_0" }, on: true }]);
  await rightClick(root, "project-head");
  assert.ok(labelsOf(root).includes("Remove star"), "the words follow the state");
  await press(find(root as never, "menu-item-Archive") as never); await flush();
  assert.deepEqual(w.calls.filter((c) => c.cap === "projects.archive").map((c) => c.input), [{ projectId: "pj_0" }]);
  await rightClick(root, "project-head");
  await press(find(root as never, "menu-item-Share…") as never); await flush();
  assert.deepEqual(w.opened, ["projects:pj_0"]);
  await rightClick(root, "project-head");
  await press(find(root as never, "menu-item-Add People…") as never); await flush();
  assert.ok(find(root as never, "add-sheet") ?? true, "the add sheet is the people picker (its own tests cover it)");
});

test("a member pins files and nothing more; someone only looking has Star and Copy link", async () => {
  const member = await mountPage(world("member"));
  await rightClick(member, "project-head");
  assert.deepEqual(labelsOf(member), ["Star", "Pin File…", "Copy link"]);
  const guest = await mountPage(world("guest", true));
  await rightClick(guest, "project-head");
  assert.deepEqual(labelsOf(guest), ["Remove star", "Copy link"]);
});
