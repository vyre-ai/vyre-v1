// New channel and Browse channels: the slug, the create call, the inline errors, the entry points with zero channels, Personal hiding them, and Browse with Join.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { ChatsSidebar } from "../sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, northwind, personal } from "../sidebar/sample.ts";
import type { SampleSpace } from "../sidebar/sample.ts";
import { gateActions } from "../../../shell/cmdk/gate.ts";
import { NewChannelSheet } from "./NewChannelSheet.tsx";
import { canCreate, createInput, joinable, nameProblem, pickEntries, sheetError, slugOf, takenNames } from "./model.ts";
import type { CreateIn } from "./model.ts";
import { requestChannelSheet, takeChannelRequest } from "./request.ts";
import type { Channel } from "../sidebar/model.ts";

const window500 = { start: 0, end: 500 };
const empty: SampleSpace = { ...northwind, channels: [] };
const withBrowse: SampleSpace = {
  ...northwind,
  channels: [
    { channelId: "intake", name: "intake", unread: 0, visibility: "public" },
    { channelId: "events", name: "events", unread: 0, visibility: "public", joined: false, topic: "Dates and venues" },
    { channelId: "ops", name: "ops", unread: 0, visibility: "public", joined: false },
  ],
};
const ids = (root: Node): string[] => {
  const out: string[] = [];
  const walk = (n: Node | string): void => { if (typeof n === "string") return; const t = n.props["data-testid"]; if (typeof t === "string") out.push(t); (n.children ?? []).forEach(walk); };
  walk(root);
  return out;
};
// every tree is taken down after its test: a sidebar left mounted would still hear the next test's request for the sheet
const open: Array<{ unmount(): void }> = [];
afterEach(async () => { for (const r of open.splice(0)) await act(async () => { r.unmount(); }); });
async function mount(_root: unknown, el: ReactElement): Promise<Node> {
  const r = createRoot();
  open.push(r);
  await act(async () => { r.render(el); });
  await flush();
  return r.container as unknown as Node;
}
const enter = async (n: Node | null): Promise<void> => {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props.onKeyDown as (e: unknown) => void)({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {}, isDefaultPrevented: () => false, target: { blur() {} } }); });
};

test("a name becomes a lower case slug of letters, digits and dashes", () => {
  assert.equal(slugOf("Rivera Intake!"), "rivera-intake");
  assert.equal(slugOf("  #Q4__plan  "), "q4-plan");
  assert.equal(slugOf("a   b--c"), "a-b-c");
  assert.equal(slugOf("---"), "");
  assert.equal(slugOf("x".repeat(120)).length, 80);
});

test("the create input splits people from agents and leaves out what is empty", () => {
  const f = { name: "Rivera Intake", topic: "  ", visibility: "invite" as const, picked: ["usr_maya", "agt_intake", "usr_omar"], recordId: "rec_rivera" };
  assert.deepEqual(createInput(f, "k1"), { name: "rivera-intake", visibility: "invite", idempotencyKey: "k1", memberIds: ["usr_maya", "usr_omar"], agentIds: ["agt_intake"], recordId: "rec_rivera" });
  assert.deepEqual(createInput({ name: "ops", topic: "Shifts", visibility: "public", picked: [] }, "k2"), { name: "ops", visibility: "public", idempotencyKey: "k2", topic: "Shifts" });
});

test("a taken name is a problem and Create waits on an empty or taken name", () => {
  const taken = new Set(["intake"]);
  assert.equal(nameProblem("Intake", taken), "That name is taken");
  assert.equal(nameProblem("", taken), null);
  assert.equal(canCreate({ name: "", topic: "", visibility: "public", picked: [] }, taken), false);
  assert.equal(canCreate({ name: "intake", topic: "", visibility: "public", picked: [] }, taken), false);
  assert.equal(canCreate({ name: "events", topic: "", visibility: "public", picked: [] }, taken), true);
});

test("each refusal from the Space says one short thing in the right place", () => {
  assert.deepEqual(sheetError({ error: { code: "validation.bad_input", message: "A channel with that name already exists." } }), { field: "name", text: "That name is taken" });
  assert.equal(sheetError({ error: { code: "permission.denied", message: "no" } }).field, "form");
  assert.match(sheetError({ error: { code: "permission.denied", message: "no" } }).text, /cannot create channels/);
  assert.match(sheetError(new Error("offline")).text, /Try again/);
});

test("the picker lists people, then the assistant, then agents; never you", () => {
  const p = pickEntries(
    [{ id: "usr_me", kind: "person", name: "Me", status: "active" }, { id: "usr_maya", kind: "person", name: "Maya", status: "active", title: "Partner" }, { id: "usr_gone", kind: "person", name: "Gone", status: "suspended" }] as never,
    [{ agentId: "agt_intake", name: "Intake" }, { agentId: "agt_assistant", name: "Assistant" }] as never, "usr_me", "agt_assistant",
  );
  assert.deepEqual(p.people.map((x) => x.id), ["usr_maya"]);
  assert.deepEqual(p.agents.map((x) => x.id), ["agt_assistant", "agt_intake"]);
});

test("Browse offers public channels you are not in", () => {
  const ch = (channelId: string, o: Partial<Channel>): Channel => ({ channelId, mainThreadId: `th_${channelId}`, name: channelId, visibility: "public", archived: false, members: [], agents: [], unread: 0, createdAt: 1, ...o } as Channel);
  const list = [ch("mine", { members: [{ kind: "person", id: "usr_me" }] }), ch("open", { createdAt: 5 }), ch("secret", { visibility: "invite" }), ch("old", { archived: true }), ch("newer", { createdAt: 9 })];
  assert.deepEqual(joinable(list, "usr_me").map((c) => c.channelId), ["newer", "open"]);
  assert.deepEqual([...takenNames(list)].sort(), ["mine", "newer", "old", "open", "secret"]);
});

const sheet = (o: { create?: (i: CreateIn) => Promise<string>; taken?: string[]; projects?: boolean } = {}): { el: ReturnType<typeof NewChannelSheet>; made: CreateIn[]; created: string[]; closed: number[] } => {
  const made: CreateIn[] = [];
  const created: string[] = [];
  const closed: number[] = [];
  const el = (
    <NewChannelSheet
      people={[{ id: "usr_maya", name: "Maya Chen", kind: "person", sub: "Partner" }, { id: "usr_omar", name: "Omar Haddad", kind: "person" }]}
      agents={[{ id: "agt_assistant", name: "Assistant", kind: "agent", sub: "Assistant" }, { id: "agt_intake", name: "Intake", kind: "agent", sub: "Agent" }]}
      projects={o.projects === false ? [] : [{ recordId: "rec_rivera", title: "Rivera matter" }]} taken={new Set(o.taken ?? ["intake"])}
      create={o.create ?? (async (i) => { made.push(i); return "chn_new"; })} onCreated={(id) => void created.push(id)} onClose={() => void closed.push(1)} now={() => 1000}
    />
  );
  return { el, made, created, closed };
};

test("the sheet shows the slug as you type, creates with the picked people and agents, and opens the new channel", async () => {
  installDom();
  const s = sheet();
  const root = await mount(createRoot, s.el);
  assert.equal(textOf(find(root, "new-channel-slug")), "#name", "an empty name shows the #name hint");
  assert.equal((find(root, "new-channel-create")!.props as { disabled?: boolean })["aria-disabled"] ?? (find(root, "new-channel-create")!.props as { disabled?: boolean }).disabled, true, "Create waits for a name");
  await typeInto(find(root, "new-channel-name"), "Rivera Intake");
  assert.equal(textOf(find(root, "new-channel-slug")), "#rivera-intake");
  await press(find(root, "new-channel-visibility-invite"));
  await press(find(root, "row-new-channel-people-usr_maya"));
  await press(find(root, "row-new-channel-people-agt_intake"));
  assert.ok(find(root, "new-channel-people-chip-usr_maya"), "a chosen person shows as a chip");
  await press(find(root, "new-channel-create"));
  await flush();
  assert.equal(s.made.length, 1);
  assert.deepEqual(s.made[0], { name: "rivera-intake", visibility: "invite", idempotencyKey: s.made[0]!.idempotencyKey, memberIds: ["usr_maya"], agentIds: ["agt_intake"] });
  assert.deepEqual(s.created, ["chn_new"], "the new channel opens");
});

test("Enter in the name field creates", async () => {
  installDom();
  const s = sheet();
  const root = await mount(createRoot, s.el);
  await enter(find(root, "new-channel-name"));
  assert.equal(s.made.length, 0, "nothing to create without a name");
  await typeInto(find(root, "new-channel-name"), "events");
  await enter(find(root, "new-channel-name"));
  await flush();
  assert.equal(s.made.length, 1);
  assert.equal(s.made[0]!.name, "events");
});

test("a taken name shows under the field at once and a refusal from the Space shows where it belongs", async () => {
  installDom();
  const s = sheet({ create: async () => { throw { error: { code: "validation.bad_input", message: "A channel with that name already exists." } }; } });
  const root = await mount(createRoot, s.el);
  await typeInto(find(root, "new-channel-name"), "Intake");
  assert.equal(textOf(find(root, "new-channel-slug")), "That name is taken");
  await typeInto(find(root, "new-channel-name"), "ops");
  await press(find(root, "new-channel-create"));
  await flush();
  assert.equal(textOf(find(root, "new-channel-slug")), "That name is taken", "the Space said the name is taken: the name field says so");
  const denied = sheet({ create: async () => { throw { error: { code: "permission.denied", message: "no" } }; } });
  const r2 = await mount(createRoot, denied.el);
  await typeInto(find(r2, "new-channel-name"), "ops");
  await press(find(r2, "new-channel-create"));
  await flush();
  assert.match(textOf(find(r2, "new-channel-error")), /cannot create channels/);
  assert.deepEqual(denied.created, [], "no channel opened");
});

test("a Team Space with no channels has the Channels head and a Create a channel row that opens the sheet", async () => {
  installDom();
  const s = createSampleSidebar(empty);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={window500} />);
  assert.ok(find(root, "head-channels"), "the Channels head is there with zero channels");
  const row = find(root, "row-a:new-channel");
  assert.ok(row && textOf(row).includes("Create a channel"));
  assert.ok(!find(root, "new-channel-sheet"));
  await press(row);
  await flush();
  assert.ok(find(root, "new-channel-sheet"), "the sheet is open");
});

test("the head's plus and the new menu both reach the sheet; Browse is beside them", async () => {
  installDom();
  const s = createSampleSidebar(northwind);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={window500} />);
  assert.ok(find(root, "new-menu"), "the new menu is in the header of a Team Space");
  assert.ok(find(root, "browse-channels-tool"), "Browse channels sits in the Channels head");
  await press(find(root, "new-channel"));
  await flush();
  assert.ok(find(root, "new-channel-sheet"));
  await press(find(root, "new-channel-cancel"));
  await flush();
  assert.ok(!find(root, "new-channel-sheet"), "Cancel closes it");
});

test("a request from Cmd-K opens the sheet whether the sidebar was on screen or not", async () => {
  installDom();
  requestChannelSheet("new");
  const s = createSampleSidebar(northwind);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={window500} />);
  assert.ok(find(root, "new-channel-sheet"), "the request waited for the sidebar and opened it as it mounted");
  assert.equal(takeChannelRequest(), null, "and was taken once");
  await press(find(root, "new-channel-cancel"));
  await flush();
  await act(async () => { requestChannelSheet("new"); });
  await flush();
  assert.ok(find(root, "new-channel-sheet"), "a request while it is on screen opens it too");
});

test("Cmd-K offers New channel in a Team Space and not in a Personal one", () => {
  const state = { away: false, offline: false };
  assert.ok(gateActions(state, true).some((a) => a.key === "channel.new" && a.title === "New channel"));
  assert.ok(!gateActions(state, false).some((a) => a.key === "channel.new"));
});

test("Personal has no Channels, no Browse, no new menu and no Create row", async () => {
  installDom();
  requestChannelSheet("new");
  const s = createSampleSidebar(personal);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={window500} />);
  const all = ids(root);
  for (const gone of ["head-channels", "row-a:new-channel", "new-menu", "browse-channels-tool", "new-channel", "new-channel-sheet"]) assert.ok(!all.includes(gone), `${gone} is hidden`);
  assert.ok(find(root, "new-chat"), "the New chat button stays");
  assert.equal(takeChannelRequest(), null, "a Personal Space took the request and dropped it");
});

test("Browse lists the public channels you are not in and Join opens one", async () => {
  installDom();
  const s = createSampleSidebar(withBrowse);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={window500} />);
  const all = ids(root);
  assert.ok(all.includes("row-ch:intake") && !all.includes("row-ch:events"), "the list is the channels you are in");
  await press(find(root, "browse-channels-tool"));
  await flush();
  assert.ok(find(root, "browse-channels"), "Browse is open");
  assert.ok(find(root, "join-events") && find(root, "join-ops"));
  assert.ok(!find(root, "join-intake"), "a channel you are in is not offered");
  await press(find(root, "join-events"));
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "channels.join").map((c) => c.input), [{ channelId: "events" }]);
  assert.deepEqual(s.opened, ["channel:events"], "the joined channel opens");
  assert.ok(!find(root, "browse-channels"), "and Browse closes");
});

test("Browse with nothing to join offers a new channel", async () => {
  installDom();
  const s = createSampleSidebar(northwind);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={window500} />);
  await press(find(root, "browse-channels-tool"));
  await flush();
  assert.ok(find(root, "browse-empty"));
  await press(find(root, "browse-new"));
  await flush();
  assert.ok(find(root, "new-channel-sheet") && !find(root, "browse-channels"), "the New channel sheet replaces Browse");
});

test("the real sheet creates through the Space and the new channel appears in the list and opens", async () => {
  installDom();
  const s = createSampleSidebar(empty);
  const root = await mount(createRoot, <ChatsSidebar data={s.data} window={window500} />);
  await press(find(root, "row-a:new-channel"));
  await flush();
  await typeInto(find(root, "new-channel-name"), "Client Intake");
  await flush();
  await press(find(root, "row-new-channel-people-usr_maya"));
  await press(find(root, "new-channel-create"));
  await flush();
  const made = s.calls.find((c) => c.cap === "channels.create")!;
  assert.equal((made.input as CreateIn).name, "client-intake");
  assert.deepEqual((made.input as CreateIn).memberIds, ["usr_maya"]);
  assert.ok(s.opened.some((o) => o.startsWith("channel:")), "the new channel opened");
  assert.ok(!find(root, "new-channel-sheet"), "the sheet closed");
});
