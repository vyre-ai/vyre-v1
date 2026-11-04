// The one Add people and agents host (lane l-addsheet, increment UI-2). Every entry point opens the same ui/AccessSheet through the same hook: the composer's +, the conversation header, the
// people menu, a channel, a reply thread (the right pane), a project's members and teammates, and the new-chat landing. The picks become capability calls through the sheet's own addCalls.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { mount, press, find, flush, typeInto, textOf } from "../../../onboarding/test-dom.ts";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import { ChatRightPane } from "../rightpane/ChatRightPane.tsx";
import { createSample as createPane } from "../rightpane/sample.ts";
import { ProjectPage, ProjectPageDataProvider } from "../../records/projectpage/index.ts";
import { createSampleProject } from "../../records/projectpage/sample.ts";
import { useAddSheet } from "./index.ts";
import type { AddSheetApi } from "./index.ts";
import { SHEET, withDom, testIds, pickAndAdd, rightClick } from "./addsheet.support.tsx";

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

test("a guest invite goes through threads.invite_guest with the chosen level", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await typeInto(find(root, "as-search"), "dana@fox-legal.com");
    await press(find(root, "as-invite"));
    await press(find(root, "as-role-guest:dana@fox-legal.com"));
    await press(find(root, "menu-item-Can reply"));
    await press(find(root, "as-add"));
    await flush();
    const call = s.calls.find((c) => c.cap === "threads.invite_guest");
    assert.deepEqual({ ...(call?.input as object), idempotencyKey: "k" }, { threadId: "c1", email: "dana@fox-legal.com", level: "reply", idempotencyKey: "k" });
    assert.ok(s.toasts.some((t) => /dana@fox-legal\.com was added/.test(t)), s.toasts.join("|"));
  });
});

test("a chat-owned agent is made through threads.agent.create and shows in the chat with its chat", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-new"));
    await typeInto(find(root, "as-name"), "Checker");
    await typeInto(find(root, "as-brief"), "Checks every upload against the spec");
    await press(find(root, "as-create"));
    await press(find(root, "as-add"));
    await flush();
    const call = s.calls.find((c) => c.cap === "threads.agent.create");
    assert.equal((call?.input as { threadId: string }).threadId, "c1");
    assert.equal((call?.input as { name: string }).name, "Checker");
    assert.equal((call?.input as { brief: string }).brief, "Checks every upload against the spec");
    assert.ok(!s.calls.some((c) => c.cap === "agents.create"), "it never reaches the Agents page");
    assert.ok(testIds(root).some((i) => /^face-agt_new/.test(i)), "it shows with the chat");
    assert.ok(s.toasts.includes("Checker was added"));
  });
});

test("an outside agent goes through threads.outside_agent.add, and its x on Here now calls threads.outside_agent.remove", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await pickAndAdd(root, ["outside:out_cc"]);
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.outside_agent.add").map((c) => c.input), [{ threadId: "c1", agentId: "out_cc", mode: "listen" }]);
    assert.ok(!s.calls.some((c) => c.cap === "threads.add_agent" && (c.input as { agentId: string }).agentId === "out_cc"), "never as a plain agent");
    // open again: it is Here now, and can be taken out
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-here-remove-out_cc"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.outside_agent.remove").map((c) => c.input), [{ threadId: "c1", agentId: "out_cc" }]);
    assert.equal(find(root, "as-here-remove-out_cc"), null, "gone from Here now");
    assert.ok(s.toasts.includes("Claude Code was removed"));
  });
});

test("an agent picked with Only listens is added, then set quiet; a person is added to the chat", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-row-agent:agt_research"));
    await press(find(root, "as-settings-agent:agt_research"));
    await press(find(root, "as-how-listen"));
    await press(find(root, "as-row-person:usr_maya"));
    await press(find(root, "as-add"));
    await flush();
    const caps = s.calls.map((c) => c.cap).filter((c) => /^threads\.(members\.add|add_agent|agent_settings\.set)$/.test(c));
    assert.deepEqual(caps, ["threads.add_agent", "threads.agent_settings.set", "threads.members.add"], "in the order picked; settings follow their agent");
    assert.equal((s.calls.find((c) => c.cap === "threads.agent_settings.set")?.input as { mode: string }).mode, "quiet");
    assert.ok(s.toasts.includes("Maya Chen and Research were added") || s.toasts.includes("Research and Maya Chen were added"), s.toasts.join("|"));
  });
});

test("a person who can only view cannot give Member: the option is not offered and the footer says why", async () => {
  await withDom(async () => {
    const s = createSample("idle", { viewOnly: true });
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-row-person:usr_maya"));
    assert.match(textOf(find(root, "as-pick-person:usr_maya")), /Can view/);
    assert.match(textOf(find(root, "as-line-limited")), /You can view here/);
    await press(find(root, "as-role-person:usr_maya"));
    assert.ok(find(root, "menu-item-Member") === null && find(root, "menu-item-Member (you do not have this)") === null, "a level above your own is hidden, not greyed");
  });
});

test("Include earlier messages shows for a chat and is off by default; on, the person is added with fromStart; a channel and a project never show it", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-row-person:usr_maya"));
    assert.ok(find(root, "as-earlier"), "shown for a chat");
    assert.match(textOf(find(root, "as-line-std")), /from now on/);
    await press(find(root, "as-add"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.members.add").map((c) => c.input), [{ threadId: "c1", personId: "usr_maya" }], "off by default: no flag");
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-row-person:usr_omar"));
    await press(find(root, "as-earlier"));
    assert.match(textOf(find(root, "as-line-std")), /They'll see the whole chat/);
    await press(find(root, "as-add"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.members.add").at(-1)?.input, { threadId: "c1", personId: "usr_omar", fromStart: true });
    const ch = createSample("channel");
    const room = await mount(createRoot, <Conversation data={ch.data} />);
    await press(find(room, "add-agent"));
    await flush();
    await press(find(room, "as-row-person:usr_omar"));
    assert.equal(find(room, "as-earlier"), null, "a channel's people read everything it holds");
  });
});

