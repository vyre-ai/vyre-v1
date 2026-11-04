// The one Add people and agents host (lane l-addsheet, increment UI-2). Every entry point opens the same ui/AccessSheet through the same hook: the composer's +, the conversation header, the
// people menu, a channel, a reply thread (the right pane), a project's members and teammates, and the new-chat landing. The picks become capability calls through the sheet's own addCalls.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { Node } from "../../../onboarding/test-dom.ts";
import { createRoot } from "test-renderer";
import { mount, press, find, flush, textOf } from "../../../onboarding/test-dom.ts";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import { ChatRightPane } from "../rightpane/ChatRightPane.tsx";
import { createSample as createPane } from "../rightpane/sample.ts";
import { ProjectPage, ProjectPageDataProvider } from "../../records/projectpage/index.ts";
import { createSampleProject } from "../../records/projectpage/sample.ts";
import { useAddSheet } from "./index.ts";
import type { AddSheetApi } from "./index.ts";
import { SHEET, withDom, pickAndAdd } from "./addsheet.support.tsx";

// a right-click on a row, the way the app gets one (kept in the test file: only tests fire a native context menu)
async function rightClick(root: Node, id: string): Promise<void> {
  const open = find(root, id)?.props["onContextMenu"] as ((e: unknown) => void) | undefined;
  assert.equal(typeof open, "function", id);
  await act(async () => { open?.({ preventDefault() {}, nativeEvent: { pageX: 20, pageY: 20 }, pageX: 20, pageY: 20, clientX: 20, clientY: 20 }); });
  await flush();
}

test("the composer's + has Add people and agents under This chat, and it opens the sheet", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "composer-attach"));
    assert.match(textOf(find(root, "composer-plus")), /This chat/);
    await press(find(root, "row-plus-people"));
    await flush();
    assert.ok(find(root, SHEET), "the sheet is open");
    assert.match(textOf(find(root, SHEET)), /Add people and agents\s+to Rivera intake/);
  });
});

test("the header + opens the same sheet (the old Add as listening menu is gone)", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    assert.ok(find(root, SHEET));
    assert.equal(find(root, "menu-item-Docs"), null, "no list of agents to add as listening");
    assert.match(textOf(find(root, SHEET)), /to Rivera intake/);
  });
});

/** A right-click on a people-popover row, the way a person opens its menu. */

test("the people popover is People and agents: one row per member with the role on the right, and the footer Add people and agents opens the same sheet", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "participants-button"));
    const pop = find(root, "people-popover");
    assert.ok(pop);
    assert.match(textOf(pop), /^\s*People and agents/);
    assert.match(textOf(pop), /Add people and agents\s*$/, "the footer");
    assert.match(textOf(find(root, "people-row-usr_irfad")), /^\s*You\s+Member\s*$/);
    assert.ok(find(root, "people-row-agt_intake") && find(root, "people-row-agt_docs"));
    // an agent's Poke and settings are in its right-click menu; a person's are not
    await rightClick(root, "people-row-usr_irfad");
    assert.equal(find(root, "menu-item-Poke"), null);
    await press(find(root, "people-footer"));
    await flush();
    assert.equal(find(root, "people-popover"), null);
    assert.ok(find(root, SHEET));
  });
});

test("a channel opens the same sheet on the channel", async () => {
  await withDom(async () => {
    const s = createSample("channel");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    assert.match(textOf(find(root, SHEET)), /to #intake/);
    // people join the channel itself
    await pickAndAdd(root, ["person:usr_omar"]);
    assert.deepEqual(s.calls.filter((c) => c.cap === "channels.members.add").map((c) => c.input), [{ channelId: "ch_intake", personIds: ["usr_omar"], level: "use" }]);
  });
});

test("the right pane's Threads and Crew tabs each have the Add people and agents row, and it opens the same sheet", async () => {
  await withDom(async () => {
    for (const tab of ["threads", "crew"] as const) {
      const s = createPane("northwind", { crew: true });
      const root = await mount(createRoot, <ChatRightPane data={s.data} open onToggle={() => undefined} tab={tab} window={{ start: 0, end: 500 }} paneWidth={640} />);
      await press(find(root, "row-pane-add-people"));
      await flush();
      assert.ok(find(root, SHEET), tab);
      assert.match(textOf(find(root, SHEET)), /Add people and agents\s+to Rivera intake/);
    }
  });
});

test("a project's members count opens the people popover (Manage on the Overview); its Teammates tab opens the Add sheet; the old inline form is gone", async () => {
  await withDom(async () => {
    const s = createSampleProject();
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider>);
    await flush();
    await press(find(root, "project-members"));
    await flush();
    assert.ok(find(root, "people-popover"));
    assert.equal(textOf(find(root, "people-footer")).trim(), "Manage on the Overview");
    await press(find(root, "people-footer"));
    await flush();
    assert.equal(find(root, "people-popover"), null, "the footer closes it and shows the Overview");
    await press(find(root, "tab-teammates"));
    await flush();
    assert.equal(find(root, "teammate-name"), null, "no inline form");
    await press(find(root, "teammate-add"));
    await flush();
    assert.ok(find(root, SHEET));
    assert.match(textOf(find(root, SHEET)), /to Rivera engagement/);
  });
});

test("the new-chat landing's With row uses the same sheet and hands the picks back instead of calling anything", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    let api: AddSheetApi | null = null;
    const got: string[] = [];
    function Host(): JSX.Element | null {
      api = useAddSheet({ call: s.data.call, me: s.data.me, nameOf: s.data.nameOf, newKey: s.data.newKey, toast: s.data.toast });
      return api.element;
    }
    const root = await mount(createRoot, <Host />);
    (api as AddSheetApi | null)?.pick({ name: "this new chat", onPicks: (p) => got.push(...p.map((x) => `${x.kind}:${x.id}`)) });
    await flush();
    assert.ok(find(root, SHEET));
    assert.match(textOf(find(root, SHEET)), /to this new chat/);
    const before = s.calls.length;
    await pickAndAdd(root, ["agent:agt_docs", "person:usr_maya"]);
    assert.deepEqual(got, ["agent:agt_docs", "person:usr_maya"]);
    assert.equal(s.calls.slice(before).filter((c) => c.cap.startsWith("threads.")).length, 0, "no call yet: the chat does not exist");
  });
});

/* ---------- what the picks call ---------- */

