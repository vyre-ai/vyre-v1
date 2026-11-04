// The one Add people and agents host (lane l-addsheet, increment UI-2). Every entry point opens the same ui/AccessSheet through the same hook: the composer's +, the conversation header, the
// people menu, a channel, a reply thread (the right pane), a project's members and teammates, and the new-chat landing. The picks become capability calls through the sheet's own addCalls.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { installDom, mount, press, find, flush, typeInto, textOf } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import { ChatRightPane } from "../rightpane/ChatRightPane.tsx";
import { createSample as createPane } from "../rightpane/sample.ts";
import { ProjectPage, ProjectPageDataProvider } from "../../records/projectpage/index.ts";
import { createSampleProject } from "../../records/projectpage/sample.ts";
import { useAddSheet } from "./index.ts";
import type { AddSheetApi } from "./index.ts";
import { addedLine, directoryOf, failedLine, hereSub, maxLevelOf, projectExtras, settingsOf } from "./model.ts";

installComposerForTests(Composer);
const widen = (width: number): void => Dimensions.set({ window: { width, height: 844, scale: 1, fontScale: 1 } });
const SHEET = "add-sheet";

async function withDom<T>(run: () => Promise<T>): Promise<T> {
  const off = installDom();
  widen(1280);
  try { return await run(); } finally { off(); widen(1280); }
}

const testIds = (n: Node | string, out: string[] = []): string[] => { if (typeof n === "string") return out; const t = n.props["data-testid"]; if (typeof t === "string") out.push(t); (n.children ?? []).forEach((c) => testIds(c, out)); return out; };

/** The sheet is open: pick people and agents by their row and press Add. */
async function pickAndAdd(root: Node, ids: string[]): Promise<void> {
  for (const id of ids) await press(find(root, `as-row-${id}`));
  await press(find(root, "as-add"));
  await flush();
}

/* ---------- one sheet, every entry point ---------- */

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

test("the people menu lists who is here and starts with Add people and agents, which opens the same sheet", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "participants-button"));
    const pop = find(root, "people-pop");
    assert.ok(pop);
    assert.match(textOf(pop), /^\s*Add people and agents/);
    // your own row reads "You" with your role under it, not "You / You"
    assert.match(textOf(find(root, "people-row-usr_irfad")), /^\s*You\s+Owner\s*$/);
    // a person row has nothing new; an agent row has Poke and a gear
    assert.equal(find(root, "people-poke-usr_irfad"), null);
    assert.equal(find(root, "people-gear-usr_irfad"), null);
    assert.ok(find(root, "people-poke-agt_intake") && find(root, "people-gear-agt_intake") && find(root, "people-poke-agt_docs"));
    await press(find(root, "people-add"));
    await flush();
    assert.equal(find(root, "people-pop"), null);
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

test("a project's members count and its Teammates tab open the same sheet; the old inline form is gone", async () => {
  await withDom(async () => {
    const s = createSampleProject();
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider>);
    await flush();
    await press(find(root, "project-members"));
    await flush();
    assert.ok(find(root, SHEET));
    assert.match(textOf(find(root, SHEET)), /to Rivera engagement/);
    await press(find(root, "as-cancel"));
    await press(find(root, "tab-teammates"));
    await flush();
    assert.equal(find(root, "teammate-name"), null, "no inline form");
    await press(find(root, "teammate-add"));
    await flush();
    assert.ok(find(root, SHEET));
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

test("a person who can only view cannot give Member: the option is grey and the footer says why", async () => {
  await withDom(async () => {
    const s = createSample("idle", { viewOnly: true });
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-row-person:usr_maya"));
    assert.match(textOf(find(root, "as-pick-person:usr_maya")), /Can view/);
    assert.match(textOf(find(root, "as-line-limited")), /You can view here/);
    await press(find(root, "as-role-person:usr_maya"));
    assert.match(textOf(find(root, "menu-item-Member (you do not have this)")), /you do not have this/);
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

test("@mentioning someone who is not in the chat shows one strip on the composer: the line, a primary Add, and a caret menu with the other ways", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await typeInto(find(root, "composer-field"), "@Maya Chen can you look at this");
    await flush();
    const strip = find(root, "channel-offer");
    assert.ok(strip, "the strip shows");
    assert.match(textOf(find(root, "channel-offer-text")), /^Maya isn't in this chat$/);
    assert.equal(textOf(find(root, "channel-add")).trim(), "Add Maya");
    // the loose lines and the switch are gone
    const text = textOf(strip);
    assert.ok(!/They will read|Earlier messages stay hidden|Include earlier messages|never gains people/i.test(text), text);
    assert.equal(find(root, "channel-earlier"), null);
    assert.equal(find(root, "channel-start"), null, "the channel is in the caret menu now");
    // the caret holds the three ways, the default first
    await press(find(root, "channel-add-menu"));
    for (const label of ["Add, from now on", "Add, with earlier messages", "Start a channel instead"]) assert.ok(find(root, `menu-item-${label}`), label);
    await press(find(root, "menu-item-Add, with earlier messages"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.members.add").map((c) => c.input), [{ threadId: "c1", personId: "usr_maya", fromStart: true }]);
  });
});

test("the strip's Add is from now on (no flag); Start a channel instead makes a channel", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await typeInto(find(root, "composer-field"), "@Maya Chen can you look at this");
    await flush();
    await press(find(root, "channel-add"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.members.add").map((c) => c.input), [{ threadId: "c1", personId: "usr_maya" }]);
    const again = createSample("idle");
    const root2 = await mount(createRoot, <Conversation data={again.data} />);
    await typeInto(find(root2, "composer-field"), "@Maya Chen can you look at this");
    await flush();
    await press(find(root2, "channel-add-menu"));
    await press(find(root2, "menu-item-Start a channel instead"));
    await flush();
    assert.ok(again.calls.some((c) => c.cap === "threads.make_channel"));
  });
});

test("on a phone the main button reads Add 3", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    widen(390);
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "composer-attach"));
    await press(find(root, "row-plus-people"));
    await flush();
    for (const id of ["person:usr_maya", "person:usr_omar", "agent:agt_research"]) await press(find(root, `as-row-${id}`));
    assert.equal(textOf(find(root, "as-add")).trim(), "Add 3");
  });
});

/* ---------- poke and the settings popover ---------- */

test("Poke calls threads.poke, the reply says Poked by, and the quiet line says who poked whom", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "participants-button"));
    await press(find(root, "people-poke-agt_docs"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.poke").map((c) => c.input), [{ threadId: "c1", agentId: "agt_docs" }]);
    assert.ok(s.toasts.includes("Poked Docs"));
    await flush();
    assert.match(textOf(find(root, "poked-pokeR_1")), /Poked by You/);
    assert.match(textOf(find(root, "event-poke_1")), /You poked Docs/);
  });
});

test("the gear opens How, When and Style; Listening is mode quiet; making another agent lead asks first and keeps the swap", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "participants-button"));
    await press(find(root, "people-gear-agt_docs"));
    assert.ok(find(root, "as-pop"));
    for (const id of ["as-how-lead", "as-how-tag", "as-how-listen", "as-when-always", "as-when-topics", "as-when-hours", "as-style-short", "as-style-full"]) assert.ok(find(root, id), id);
    await press(find(root, "as-how-listen"));
    await press(find(root, "as-style-full"));
    const sets = s.calls.filter((c) => c.cap === "threads.agent_settings.set").map((c) => c.input);
    assert.deepEqual(sets[0], { threadId: "c1", agentId: "agt_docs", mode: "quiet", when: "always", topics: null, hoursFrom: null, hoursTo: null, style: "short" });
    assert.equal((sets[1] as { style: string }).style, "full");
    // Intake leads: making Docs lead asks first
    await press(find(root, "as-how-lead"));
    assert.match(textOf(find(root, "menu-item-Swap") ?? root), /Swap/);
    assert.equal(s.calls.filter((c) => c.cap === "threads.agent_settings.set").length, 2, "nothing is sent before the swap is confirmed");
    await press(find(root, "menu-item-Swap"));
    await flush();
    assert.equal((s.calls.filter((c) => c.cap === "threads.agent_settings.set").at(-1)?.input as { mode: string }).mode, "lead");
    assert.ok(s.toasts.some((t) => /Docs now answers everything\. Intake answers only when mentioned\./.test(t)));
  });
});

test("a face in the header opens How and When It Answers instead of the old two mode items", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "face-agt_docs"));
    assert.equal(find(root, "menu-item-Replies to everything"), null);
    assert.equal(find(root, "menu-item-Only when @mentioned"), null);
    await press(find(root, "menu-item-How and When It Answers…"));
    assert.ok(find(root, "as-pop"));
  });
});

/* ---------- the pure parts ---------- */

test("settingsOf maps the chat's row to the sheet's words, and Listening is quiet", () => {
  assert.equal(settingsOf({ mode: "lead" }).how, "lead");
  assert.equal(settingsOf({ mode: "listen" }).how, "tag");
  assert.equal(settingsOf({ mode: "listen", quiet: true }).how, "listen");
  assert.deepEqual(settingsOf({ mode: "listen", when: "hours", hoursFrom: "08:00", hoursTo: "12:00", style: "full" }), { how: "tag", when: "hours", topics: "", hoursFrom: "08:00", hoursTo: "12:00", style: "full" });
  assert.equal(hereSub({ mode: "listen", quiet: true, owned: true }, false), "Only listens · made for this chat");
});

test("directoryOf offers the Space's people and agents, the person's Assistant first, and never someone else's Assistant or a chat's own agent", () => {
  const row = (agentId: string, name: string, extra: object = {}) => ({ agentId, name, kind: "agent", ownerId: "usr_me", ...extra } as never);
  const dir = directoryOf({
    me: "usr_me",
    principals: [{ id: "usr_me", kind: "person", name: "Me", status: "active" }, { id: "usr_sara", kind: "person", name: "Sara", status: "active", title: "Associate" }, { id: "usr_gone", kind: "person", name: "Gone", status: "removed" }] as never,
    agents: [row("agt_docs", "Docs"), row("agt_mine", "Mine", { kind: "assistant" }), row("agt_theirs", "Theirs", { kind: "assistant", ownerId: "usr_sara" }), row("agt_own", "Chat only", { chatOf: "c9" }), row("agt_cc", "Claude Code", { runtime: "outside" }), row("agt_mate", "Mate", { teammateOf: "pj_9" })],
    connected: [{ agentId: "out_cc", clientName: "Claude Code", connectedAt: 1, calls: 0, redirectHost: "On this Mac" }, { agentId: "out_setup", clientName: "Setup", connectedAt: 1, calls: 0, setup: true }] as never,
  });
  assert.deepEqual(dir.people?.map((p) => p.id), ["usr_sara"]);
  assert.deepEqual(dir.agents?.map((a) => [a.id, a.name]), [["agt_mine", "Assistant"], ["agt_docs", "Docs"]]);
  assert.deepEqual(dir.outside?.map((o) => o.id), ["out_cc"]);
  assert.equal(maxLevelOf({ manage: false, edit: false, use: false }), "view");
  assert.equal(maxLevelOf({ manage: false, edit: true, use: true }), "edit");
});

test("the line after adding names who went in and who did not", () => {
  assert.equal(addedLine(["Docs"]), "Docs was added");
  assert.equal(addedLine(["Docs", "Sara"]), "Docs and Sara were added");
  assert.equal(failedLine(["Docs", "Sara", "Mira"]), "Could not add Docs, Sara and Mira. Try again.");
  const x = projectExtras([{ key: "new:1", kind: "new", id: "1", name: "Checker", role: "", brief: "Checks", model: "Opus 5.5" }, { key: "outside:o", kind: "outside", id: "o", name: "CC", role: "" }, { key: "guest:a@b.c", kind: "guest", id: "a@b.c", name: "a@b.c", role: "gview", email: "a@b.c" }], () => "k1");
  assert.deepEqual(x.creates, [{ name: "Checker", role: "Checks", model: "Opus 5.5", key: "k1" }]);
  assert.deepEqual(x.viaChat.map((p) => p.kind), ["outside", "guest"]);
});

test("a project: people and agents become members, a new agent is agents.create with the project id", async () => {
  await withDom(async () => {
    const s = createSampleProject();
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider>);
    await flush();
    await press(find(root, "project-members"));
    await flush();
    await press(find(root, "as-row-person:usr_sara"));
    await press(find(root, "as-row-agent:agt_billing"));
    await press(find(root, "as-new"));
    await typeInto(find(root, "as-name"), "Checker");
    await typeInto(find(root, "as-brief"), "Checks every draft");
    await press(find(root, "as-create"));
    await press(find(root, "as-add"));
    await flush();
    const sets = s.calls.filter((c) => c.cap === "projects.members.set").map((c) => (c.input as { principal: string; role: string }));
    assert.deepEqual(sets.map((m) => [m.principal, m.role]), [["usr_sara", "member"], ["agt_billing", "member"]]);
    const made = s.calls.find((c) => c.cap === "agents.create")?.input as { name: string; role: string; projectId: string };
    assert.deepEqual([made.name, made.role, made.projectId], ["Checker", "Checks every draft", "pj_0"]);
  });
});

test("a teammate's role is chosen on its row (Lead answers first); adding is only the sheet", async () => {
  await withDom(async () => {
    const s = createSampleProject();
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider>);
    await flush();
    await press(find(root, "tab-teammates"));
    await flush();
    await press(find(root, "teammate-role-agt_docs"));
    await press(find(root, "menu-item-Lead: Answers first in a new chat of this project"));
    await flush();
    const call = s.calls.find((c) => c.cap === "projects.members.set")?.input as { projectId: string; principal: string; role: string };
    assert.deepEqual([call.projectId, call.principal, call.role], ["pj_0", "agt_docs", "lead"]);
  });
});

test("an outside agent in the chat never offers Answers everything in its settings popover", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    await s.data.call("threads.outside_agent.add", { threadId: "c1", agentId: "out_cc" });
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "participants-button"));
    await flush();
    await press(find(root, "people-gear-out_cc"));
    assert.ok(find(root, "as-pop"));
    assert.equal(find(root, "as-how-lead"), null);
    assert.ok(find(root, "as-how-tag") && find(root, "as-how-listen"));
    // a Space agent still offers it
    await press(find(root, "as-pop-x"));
    await press(find(root, "participants-button"));
    await flush();
    await press(find(root, "people-gear-agt_docs"));
    assert.ok(find(root, "as-how-lead"));
  });
});

test("the outside-agents note names the signed-in person in full, from data.me: Others see these as Irfad Imtiaz (Agent)", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    assert.equal(s.data.me.name, "Irfad Imtiaz");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    assert.match(textOf(find(root, SHEET)), /Others see these as Irfad Imtiaz \(Agent\)/);
    assert.ok(!/these as You \(Agent\)/.test(textOf(find(root, SHEET))));
  });
});
