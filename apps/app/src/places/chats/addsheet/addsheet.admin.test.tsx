// A Space admin with no Manage on a project changes its roles (issue 877): the project's people popover offers Change role and Remove, and the Add people sheet may give any role. A member who is not an admin gets neither.
// @reads /apps/app/src/places/chats/addsheet/addsheet.support.tsx
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { Node } from "../../../onboarding/test-dom.ts";
import { createRoot } from "test-renderer";
import { mount, press, find, flush } from "../../../onboarding/test-dom.ts";
import { ProjectPage, ProjectPageDataProvider } from "../../records/projectpage/index.ts";
import { createSampleProject } from "../../records/projectpage/sample.ts";
import { loadAdd } from "./useAddSheet.tsx";
import { withDom } from "./addsheet.support.tsx";

async function rightClick(root: Node, id: string): Promise<void> {
  const open = find(root, id)?.props["onContextMenu"] as ((e: unknown) => void) | undefined;
  assert.equal(typeof open, "function", id);
  await act(async () => { open?.({ preventDefault() {}, nativeEvent: { pageX: 20, pageY: 20 }, pageX: 20, pageY: 20, clientX: 20, clientY: 20 }); });
  await flush();
}

/** Omar is a plain Member of the sample project (not its Lead); `admin` says whether the Space calls him an admin. */
async function menuOf(admin: boolean): Promise<{ role: boolean; remove: boolean; addPeople: boolean }> {
  return withDom(async () => {
    const s = createSampleProject();
    const data = { ...s.data, me: { id: "usr_omar", name: "Omar Haddad" }, admin };
    const root = await mount(createRoot, <ProjectPageDataProvider value={data}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider>);
    await flush(); await flush(); await flush();
    await press(find(root, "project-more"));
    await flush();
    const addPeople = find(root, "menu-item-Add People…") !== null;
    await press(find(root, "project-more"));
    await press(find(root, "project-members"));
    await flush();
    await rightClick(root, "people-row-agt_docs");
    return { role: find(root, "menu-item-Change role") !== null, remove: find(root, "menu-item-Remove") !== null, addPeople };
  });
}

test("the project's people popover offers Add People, Change role and Remove to a Space admin who is only a Member, and not to a Member who is no admin", async () => {
  assert.deepEqual(await menuOf(true), { role: true, remove: true, addPeople: true });
  assert.deepEqual(await menuOf(false), { role: false, remove: false, addPeople: false });
});

test("the Add people sheet on a project may give any role to a Space admin whose own access check says view only; a non-admin keeps the check", async () => {
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "access.check") return { decision: { effect: (input as { action: { level: string } }).action.level === "view" ? "allow" : "deny", reason: "x", steps: [], decisionId: "d" } };
    if (cap === "projects.overview") return { project: { title: "Rivera", folderId: "fld_1" }, linked: [] };
    if (cap === "projects.members.list") return { members: [] };
    return null;
  };
  const deps = { call, me: { id: "usr_omar", name: "Omar" }, nameOf: (id: string) => id, newKey: () => "k", toast: () => undefined };
  assert.equal((await loadAdd({ ...deps, admin: true }, { projectId: "pj_0" }))?.maxLevel, "manage");
  assert.equal((await loadAdd(deps, { projectId: "pj_0" }))?.maxLevel, "view");
});
