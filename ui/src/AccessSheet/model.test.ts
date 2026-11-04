// ui/AccessSheet model: the words, the locks, the lists and the capability inputs, with nothing drawn.
import test from "node:test";
import assert from "node:assert/strict";
import type { CapMap } from "../../../generated/types.ts";
import {
  ASSISTANT_NOTICE,
  ITEM_DEFS,
  LINK_SUBJECT_ID,
  SHARE_CAPABILITY,
  UNSHARE_CAPABILITY,
  VIEW_ONLY_NOTE,
  actionLabel,
  addAgentInput,
  addCalls,
  addLines,
  agentCreateInput,
  agentSettingsInput,
  canGiveLevel,
  channelMembersInput,
  defaultRole,
  effectiveLevel,
  idleLine,
  inviteGuestInput,
  isEmail,
  isPhoneWidth,
  isViewOnly,
  levelDefs,
  levelName,
  levelsFor,
  modeOf,
  noMatch,
  outsideAgentAddInput,
  outsideAgentRemoveInput,
  pickFromEmail,
  pickFromEntry,
  pickFromNew,
  pokeInput,
  pokeNote,
  projectMemberInput,
  removable,
  roleLabel,
  roleOptions,
  sections,
  settingsSummary,
  shareCalls,
  shareInput,
  shareLines,
  shareVerb,
  sheetRows,
  showsEarlier,
  subjectOfPick,
  takenFromRows,
  threadMemberInput,
  topMatch,
  unshareInput,
} from "./model.ts";
import type { AccessDirectory, AccessEntry, AccessPick, AddTarget, ShareItemType, ShareLevel, ShareRow } from "./props.ts";
import { DEFAULT_AGENT_SETTINGS } from "./props.ts";

const person = (id: string, name: string): AccessEntry => ({ id, name, kind: "person", sub: "Space member" });
const agent = (id: string, name: string): AccessEntry => ({ id, name, kind: "agent", sub: "Space agent" });
const outside: AccessEntry = { id: "out_cc", name: "Claude Code", kind: "outside", sub: "On this Mac" };
const assistant: AccessEntry = { id: "agt_me", name: "Assistant", kind: "agent", assistant: true };
const dir: AccessDirectory = {
  suggested: [person("sara", "Sara Malik"), assistant],
  people: [person("sara", "Sara Malik"), person("omar", "Omar Reyes")],
  agents: [assistant, agent("docs", "Docs"), agent("mira", "Mira")],
  outside: [outside],
  groups: [{ id: "fin", name: "Finance", kind: "group", sub: "Group" }],
  space: { id: "space", name: "Anyone in the Space", kind: "space", subject: { kind: "group", id: "space" } },
};
const target: AddTarget = { kind: "chat", name: "Upload contract", filesFolder: "Portal uploads", recordsFolder: "Clients" };
const addCtx = { mode: "add" as const };
const none = new Set<string>();

/* ---------- the levels of each item ---------- */

test("each item type offers its own levels with its own words", () => {
  const names = (t: ShareItemType): string[] => levelDefs(t).map((l) => l.label);
  assert.deepEqual(names("note"), ["Can view", "Can edit", "Can manage"]);
  assert.deepEqual(names("file"), ["Can view", "Can edit", "Can manage"]);
  assert.deepEqual(names("record"), ["Can view", "Can edit", "Can manage"]);
  assert.deepEqual(names("artifact"), ["Can view", "Can edit", "Can manage"]);
  assert.deepEqual(names("project"), ["Can view", "Can edit", "Can manage"]);
  assert.deepEqual(names("rtype"), ["Can view records", "Can edit records", "Can manage the type"]);
  assert.deepEqual(names("vault"), ["Can use without seeing", "Can view", "Can edit"]);
  assert.deepEqual(names("agent"), ["Can chat with", "Can use", "Can edit", "Can manage"]);
  assert.equal(levelName("agent", "view"), "Can chat with", "chat with is the view level");
  assert.equal(levelName("vault", "use"), "Can use without seeing");
  assert.equal(levelName("note", "owner"), "Owner");
});

test("the host can narrow a type's levels, and one level always remains", () => {
  assert.deepEqual(levelDefs("note", ["view", "edit"]).map((l) => l.id), ["view", "edit"]);
  assert.deepEqual(levelDefs("note", ["use"]).map((l) => l.id), ["view"]);
});

test("what they get, for every item type and level", () => {
  const n = "Q4";
  assert.equal(shareVerb("note", "view", n), "view “Q4”");
  assert.equal(shareVerb("file", "edit", n), "view and edit “Q4”");
  assert.equal(shareVerb("record", "manage", n), "view, edit and share “Q4”");
  assert.equal(shareVerb("rtype", "edit", n), "view and edit “Q4”");
  assert.equal(shareVerb("artifact", "view", n), "view “Q4”");
  assert.equal(shareVerb("project", "manage", n), "view, edit and share “Q4”");
  assert.equal(shareVerb("vault", "use", "GHL key"), "use “GHL key” in actions without seeing its value");
  assert.equal(shareVerb("vault", "view", n), "view “Q4”");
  assert.equal(shareVerb("vault", "edit", n), "view and edit “Q4”");
  assert.equal(shareVerb("agent", "view", "Ember"), "chat with Ember and add it to their chats");
  assert.equal(shareVerb("agent", "use", "Ember"), "use Ember in their automations, tasks and crews, on their own account");
  assert.equal(shareVerb("agent", "edit", "Ember"), "edit Ember's instructions (AGENT.md), skills and memory settings");
  assert.equal(shareVerb("agent", "manage", "Ember"), "share, rename and delete Ember");
});

test("the tail of each item type", () => {
  assert.equal(ITEM_DEFS.file.tail, "Everything inside comes with it, including new files.");
  assert.equal(ITEM_DEFS.note.tail, "They see its history from now on.");
  assert.equal(ITEM_DEFS.record.tail, "They see this record's fields, not the rest of the table.");
  assert.equal(ITEM_DEFS.rtype.tail, "Every record of this type, and its fields.");
  assert.equal(ITEM_DEFS.artifact.tail, "They see the latest version and its comments.");
  assert.match(ITEM_DEFS.vault.tail, /never shown or sent in chat/);
});

const sara = (role: string, kind: AccessPick["kind"] = "person", name = "Sara Malik"): AccessPick => ({ key: `${kind}:${name}`, kind, id: name, name, role });

test("share lines group people by level, then guests, outside agents, the Space and the tail", () => {
  const lines = shareLines({
    type: "file", name: "Q4 invoices", ownerName: "Irfad",
    picks: [sara("view"), sara("edit", "person", "Omar Reyes"), sara("view", "person", "Kai Lund"), { ...sara("view", "guest", "joe@weinbergerlaw.com"), email: "joe@weinbergerlaw.com" }, sara("", "outside", "Claude Code"), sara("view", "space", "Anyone in the Space")],
  });
  const text = lines.map((l) => l.text);
  assert.ok(text.includes("Sara Malik and Kai Lund can view “Q4 invoices”."));
  assert.ok(text.includes("Omar Reyes can view and edit “Q4 invoices”."));
  assert.ok(text.includes("joe@weinbergerlaw.com sees only this folder, never what is around it."));
  assert.ok(text.some((x) => x.startsWith("Claude Code reaches it through MCP tools scoped to exactly this folder, never wider. It shows as Irfad (Agent), is audited, and removing it ends access at once.")));
  assert.ok(text.includes("Anyone in the Space can view “Q4 invoices”."));
  assert.ok(text.includes("Anyone in the Space can find it from search."));
  assert.equal(text[text.length - 1], "Everything inside comes with it, including new files.");
});

test("a Vault pick that can only use it says so, and the value stays out of chat", () => {
  const lines = shareLines({ type: "vault", name: "GHL API key", ownerName: "Irfad", picks: [sara("use", "person", "Dana Fox")] }).map((l) => l.text);
  assert.equal(lines[0], "Dana Fox can use “GHL API key” in actions without seeing its value.");
  assert.match(lines[lines.length - 1] ?? "", /The value is never shown or sent in chat/);
});

test("sharing an agent: the pays-with-their-own-account note, and the four levels with nobody picked", () => {
  const picked = shareLines({ type: "agent", name: "Ember", ownerName: "Irfad", picks: [sara("use", "person", "Omar Reyes")] }).map((l) => l.text);
  assert.equal(picked[0], "Omar Reyes can use Ember in their automations, tasks and crews, on their own account.");
  assert.ok(picked.includes("Whoever uses Ember pays with their own AI account. Ember reaches for them only what they can reach themselves."));
  const idle = shareLines({ type: "agent", name: "Ember", ownerName: "Irfad", picks: [] });
  assert.equal(idle.length, 0, "no legend: each level describes itself in its picker menu");
  assert.equal(shareLines({ type: "note", name: "x", ownerName: "I", picks: [] }).length, 0);
});

test("a limited giver is told they can give only what they have", () => {
  const lines = shareLines({ type: "note", name: "Plan", ownerName: "Irfad", picks: [sara("view")], limited: true }).map((l) => l.text);
  assert.match(lines[lines.length - 1] ?? "", /You can give only what you have yourself\.$/);
});

/* ---------- a person can only give what they have ---------- */

test("levels above the giver's are locked, with the words the sheet shows", () => {
  const giving = { maxLevel: "edit" as ShareLevel };
  assert.equal(canGiveLevel("note", "edit", giving), true);
  assert.equal(canGiveLevel("note", "manage", giving), false);
  const opts = roleOptions("person", { mode: "share", itemType: "note", giving });
  assert.deepEqual(opts.map((o) => [o.id, o.locked]), [["view", false], ["edit", false], ["manage", true]]);
  assert.equal(roleLabel(opts[2]!), "Can manage (you do not have this)");
  assert.equal(roleLabel(opts[0]!), "Can view");
});

test("the Vault ranks Can use without seeing lowest, and canGive wins over maxLevel", () => {
  assert.equal(canGiveLevel("vault", "use", { maxLevel: "use" }), true);
  assert.equal(canGiveLevel("vault", "view", { maxLevel: "use" }), false);
  assert.equal(canGiveLevel("note", "manage", { maxLevel: "view", canGive: () => true }), true);
  assert.equal(canGiveLevel("note", "view", { canGive: (l) => l === "manage" }), false);
});

test("add mode: a viewer adds viewers only; a member can add members", () => {
  assert.equal(isViewOnly({ maxLevel: "view" }), true);
  assert.equal(isViewOnly({ maxLevel: "edit" }), false);
  assert.equal(isViewOnly({}), false);
  assert.equal(isViewOnly({ canGive: (l) => l === "view" }), true);
  const limited = roleOptions("person", { ...addCtx, giving: { maxLevel: "view" } });
  assert.deepEqual(limited.map((o) => [o.label, o.locked]), [["Member", true], ["Can view", false]]);
  assert.equal(defaultRole("person", { ...addCtx, giving: { maxLevel: "view" } }), "view");
  assert.equal(defaultRole("person", addCtx), "member");
  assert.match(VIEW_ONLY_NOTE, /^You can view here, so you can add people as viewers only\. A person can give only what they have\.$/);
});

test("role lists: people Member or Can view, guests Can view or Can reply, agents none (they use the popover)", () => {
  assert.deepEqual(roleOptions("person", addCtx).map((o) => o.label), ["Member", "Can view"]);
  assert.deepEqual(roleOptions("guest", addCtx).map((o) => o.label), ["Can view", "Can reply"]);
  assert.deepEqual(roleOptions("agent", addCtx), []);
  assert.deepEqual(roleOptions("outside", addCtx), []);
  assert.deepEqual(roleOptions("guest", { mode: "share", itemType: "agent" }).map((o) => o.label), ["Can chat with"], "a guest gets the first level only");
  assert.equal(defaultRole("guest", addCtx), "gview");
  assert.equal(defaultRole("person", { mode: "share", itemType: "vault" }), "use");
  assert.equal(defaultRole("person", { mode: "share", itemType: "agent" }), "view");
});

/* ---------- buttons ---------- */

test("the main button names who is added", () => {
  const p = (name: string, kind: AccessPick["kind"] = "person"): AccessPick => ({ key: name, kind, id: name, name, role: "member" });
  assert.equal(actionLabel("add", [], false), "Add");
  assert.equal(actionLabel("add", [p("Sara Malik")], false), "Add Sara");
  assert.equal(actionLabel("add", [p("Sara Malik"), p("Docs", "agent")], false), "Add Sara and Docs");
  assert.equal(actionLabel("add", [p("Sara Malik"), p("Docs", "agent"), p("Omar")], false), "Add 3 people and agents");
  assert.equal(actionLabel("add", [p("Sara Malik"), p("Docs", "agent"), p("Omar")], true), "Add 3", "on a phone");
  assert.equal(actionLabel("add", [p("Sara Malik")], true), "Add Sara");
  assert.equal(actionLabel("share", [], false), "Share");
  assert.equal(actionLabel("share", [p("Sara Malik")], false), "Share with Sara");
  assert.equal(actionLabel("share", [p("Sara Malik"), p("Omar Reyes")], false), "Share with Sara and Omar");
  assert.equal(actionLabel("share", [p("A"), p("B"), p("C")], false), "Share with 3");
});

test("a phone is under 640 px", () => {
  assert.equal(isPhoneWidth(390), true);
  assert.equal(isPhoneWidth(639), true);
  assert.equal(isPhoneWidth(640), false);
  assert.equal(isPhoneWidth(1440), false);
  assert.equal(isPhoneWidth(0), false, "no width known yet");
});

/* ---------- what they get: add ---------- */

test("add lines: messages from now on or the start, files folder, records", () => {
  const picks = [sara("member")];
  assert.equal(addLines({ target, picks, earlier: false, ownerName: "Irfad" })[0]?.text, "They'll see this chat's messages from now on, its files folder Portal uploads, and records in Clients.");
  assert.equal(addLines({ target, picks, earlier: true, ownerName: "Irfad" })[0]?.text, "They'll see the whole chat, its files folder Portal uploads, and records in Clients.");
  assert.deepEqual(addLines({ target, picks: [], earlier: false, ownerName: "Irfad" }), []);
});

test("add lines: guests, outside agents and chat-owned agents", () => {
  const guest: AccessPick = { ...sara("gview", "guest", "dana@fox-legal.com"), email: "dana@fox-legal.com" };
  const texts = addLines({ target, picks: [guest, sara("", "outside", "Claude Code"), pickFromNew(1, { name: "Checker", brief: "", model: "Sonnet 5.5" })], earlier: false, ownerName: "Irfad" }).map((l) => l.text);
  assert.ok(texts.includes("dana@fox-legal.com sees only what this chat allows: messages from now on, no files folder, no records."));
  assert.ok(texts.includes("Claude Code reads and posts in this chat and reads its folder and the records folder, through MCP tools scoped to exactly these, never wider. It shows as Irfad (Agent), is audited, and removing it ends access at once."));
  assert.ok(texts.includes("Checker belongs to the chat and is removed with it."));
  const proj = addLines({ target: { ...target, kind: "project", name: "Lab 8" }, picks: [sara("", "outside", "Codex")], earlier: false, ownerName: "Irfad" }).map((l) => l.text);
  assert.ok(proj.some((x) => x.startsWith("Codex reads and posts in this project and reads the project's context and folders, through MCP tools")));
  const lim = addLines({ target, picks: [sara("view")], earlier: false, ownerName: "I", limited: true }).map((l) => l.text);
  assert.equal(lim[lim.length - 1], VIEW_ONLY_NOTE);
});

test("the earlier switch shows when a person, not only a guest or an agent, is picked", () => {
  assert.equal(showsEarlier([sara("member")]), true);
  assert.equal(showsEarlier([sara("gview", "guest")]), false);
  assert.equal(showsEarlier([sara("", "agent", "Docs")]), false);
  assert.equal(idleLine("add"), "Pick who to add. You will see what they get before you confirm.");
  assert.equal(idleLine("share", "note"), "Pick who to share with. You will see what they get before you confirm.");
  assert.equal(idleLine("share", "agent", "Ember"), "Pick who to share with. You will see what they get before you confirm.");
});

/* ---------- the lists ---------- */

test("with nothing typed: suggested first, then the rest without repeats; the Assistant is named Assistant", () => {
  const s = sections({ directory: dir, query: "", mode: "add", taken: none });
  assert.deepEqual(s.suggested.map((e) => e.name), ["Sara Malik", "Assistant"]);
  assert.deepEqual(s.people.map((e) => e.name), ["Omar Reyes"]);
  assert.deepEqual(s.agents.map((e) => e.name), ["Docs", "Mira"]);
  assert.deepEqual(s.outside.map((e) => e.name), ["Claude Code"]);
  assert.equal(s.invite, null);
  assert.equal(s.space, null, "the Space row is for sharing");
  assert.deepEqual(s.groups, []);
});

test("typing narrows the lists; people already in or picked are left out", () => {
  const s = sections({ directory: dir, query: "o", mode: "add", taken: new Set(["person:omar"]) });
  assert.deepEqual(s.suggested, []);
  assert.deepEqual(s.people.map((e) => e.name), []);
  assert.deepEqual(s.agents.map((e) => e.name), ["Docs"]);
  assert.deepEqual(s.outside.map((e) => e.name), ["Claude Code"]);
  assert.equal(noMatch(sections({ directory: dir, query: "zzz", mode: "add", taken: none }), "zzz"), true);
  assert.equal(noMatch(s, "o"), false);
});

test("an address offers an invite, and Enter picks it before any row", () => {
  const s = sections({ directory: dir, query: "joe@weinbergerlaw.com", mode: "add", taken: none });
  assert.equal(s.invite, "joe@weinbergerlaw.com");
  assert.deepEqual(topMatch(s), { invite: "joe@weinbergerlaw.com" });
  assert.equal(isEmail("not an email"), false);
  assert.equal(isEmail(" a@b.co "), true);
  const gone = sections({ directory: dir, query: "joe@weinbergerlaw.com", mode: "add", taken: new Set(["guest:joe@weinbergerlaw.com"]) });
  assert.equal(gone.invite, null);
  assert.equal(noMatch(gone, "joe@weinbergerlaw.com"), true);
});

test("Enter takes the top match: the first suggestion, else the first person, group, agent, outside agent", () => {
  assert.equal((topMatch(sections({ directory: dir, query: "", mode: "add", taken: none })) as { entry: AccessEntry }).entry.name, "Sara Malik");
  assert.equal((topMatch(sections({ directory: dir, query: "mi", mode: "add", taken: none })) as { entry: AccessEntry }).entry.name, "Mira");
  assert.equal(topMatch(sections({ directory: dir, query: "zzz", mode: "add", taken: none })), null);
});

test("share mode: one short Suggested list of five at most; typing finds the Space, groups and agents; an agent is shared with people and groups only", () => {
  const s = sections({ directory: dir, query: "", mode: "share", itemType: "note", taken: none });
  assert.equal(s.space, null, "General access at the top is the Space; it is not offered twice");
  assert.ok(s.suggested.length > 0 && s.suggested.length <= 5);
  assert.deepEqual([s.people, s.groups, s.agents], [[], [], []], "one list, not four");
  const many = { ...dir, people: Array.from({ length: 9 }, (_, n) => ({ id: `usr_${n}`, name: `Person ${n}`, kind: "person" as const })) };
  assert.equal(sections({ directory: many, query: "", mode: "share", itemType: "note", taken: none }).suggested.length, 5, "capped at five");
  assert.equal(sections({ directory: dir, query: "space", mode: "share", itemType: "note", taken: none }).space?.name, "Anyone in the Space");
  assert.deepEqual(sections({ directory: dir, query: "fin", mode: "share", itemType: "note", taken: none }).groups.map((e) => e.name), ["Finance"]);
  assert.ok(sections({ directory: dir, query: "mi", mode: "share", itemType: "note", taken: none }).agents.length > 0);
  const a = sections({ directory: dir, query: "", mode: "share", itemType: "agent", taken: none });
  assert.deepEqual(a.agents, []);
  assert.deepEqual(a.outside, []);
  assert.ok(!a.suggested.some((e) => e.kind === "agent"), "the Assistant is not offered as a recipient of an agent");
});

test("rows that already hold access are taken, including the Space row", () => {
  const taken = takenFromRows(dir, [{ subjectKind: "person", subjectId: "omar" }, { subjectKind: "group", subjectId: "space" }]);
  assert.ok(taken.has("person:omar"));
  assert.ok(taken.has("space:space"));
  assert.ok(!taken.has("person:sara"));
  assert.equal(sections({ directory: dir, query: "", mode: "share", itemType: "note", taken }).space, null);
});

test("picks start with the right role and settings", () => {
  const a = pickFromEntry(assistant, addCtx);
  assert.equal(a.name, "Assistant");
  assert.equal(a.sub, "Yours, private to you");
  assert.equal(a.assistant, true);
  assert.deepEqual(a.settings, DEFAULT_AGENT_SETTINGS);
  const p = pickFromEntry(person("sara", "Sara Malik"), addCtx);
  assert.equal(p.role, "member");
  assert.equal(p.settings, undefined);
  const g = pickFromEmail(" Dana@Fox-Legal.com ", addCtx);
  assert.equal(g.key, "guest:dana@fox-legal.com");
  assert.equal(g.email, "Dana@Fox-Legal.com");
  assert.equal(g.role, "gview");
  const n = pickFromNew(2, { name: " Checker ", brief: "Checks every upload against the spec", model: "Sonnet 5.5" });
  assert.deepEqual([n.key, n.name, n.brief, n.sub], ["new:2", "Checker", "Checks every upload against the spec", "New · Sonnet 5.5"]);
  const sp = pickFromEntry(dir.space!, { mode: "share", itemType: "note" });
  assert.deepEqual(subjectOfPick(sp), { kind: "group", id: "space" });
  assert.deepEqual(subjectOfPick({ kind: "outside", id: "out_cc" }), { kind: "agent", id: "out_cc" });
});

/* ---------- how an agent answers ---------- */

test("the three Hows map to the modes the contract has", () => {
  assert.equal(modeOf("lead"), "lead");
  assert.equal(modeOf("tag"), "listen");
  assert.equal(modeOf("listen"), "quiet");
  assert.equal(settingsSummary(DEFAULT_AGENT_SETTINGS), "Answers when mentioned · Any time · Short replies");
  assert.equal(settingsSummary({ ...DEFAULT_AGENT_SETTINGS, how: "lead", when: "topics", topics: "invoices, billing", style: "full" }), "Answers everything · Only on invoices, billing · Full detail");
  assert.equal(settingsSummary({ ...DEFAULT_AGENT_SETTINGS, how: "listen", when: "hours", hoursFrom: "08:00", hoursTo: "18:00" }), "Only listens · 08:00 to 18:00 · Short replies");
  assert.equal(pokeNote("Docs"), "Poke asks Docs to read the chat now and reply. It only sees what you can see.");
});

/* ---------- capability inputs: add mode (each one must satisfy CapMap[...]["in"]) ---------- */

test("threads.add_agent: lead or listen", () => {
  const lead = addAgentInput("thr_1", "agt_docs", "lead") satisfies CapMap["threads.add_agent"]["in"];
  assert.deepEqual(lead, { threadId: "thr_1", agentId: "agt_docs", mode: "lead" });
  assert.equal(addAgentInput("thr_1", "agt_docs").mode, "listen");
  assert.equal(addAgentInput("thr_1", "agt_docs", "listen").mode, "listen", "Listening is added as listen, then set quiet");
});

test("threads.agent.create: name, brief, model, mode and the key", () => {
  const full = agentCreateInput("thr_1", { name: " Checker ", brief: " Checks uploads ", model: "Sonnet 5.5", how: "listen" }, "k1") satisfies CapMap["threads.agent.create"]["in"];
  assert.deepEqual(full, { threadId: "thr_1", name: "Checker", brief: "Checks uploads", model: "Sonnet 5.5", mode: "quiet", idempotencyKey: "k1" });
  assert.deepEqual(agentCreateInput("thr_1", { name: "Checker", brief: "  " }, "k2"), { threadId: "thr_1", name: "Checker", idempotencyKey: "k2" });
});

test("threads.agent_settings.set: Answers everything is lead, when it is mentioned is listen, Only listens is quiet", () => {
  const s = agentSettingsInput("thr_1", "agt_docs", { how: "tag", when: "topics", topics: " invoices, billing ", style: "short" }) satisfies CapMap["threads.agent_settings.set"]["in"];
  assert.deepEqual(s, { threadId: "thr_1", agentId: "agt_docs", mode: "listen", when: "topics", topics: "invoices, billing", hoursFrom: null, hoursTo: null, style: "short" });
  assert.deepEqual(agentSettingsInput("t", "a", { how: "lead", when: "hours", hoursFrom: "08:00", hoursTo: "18:00" }), { threadId: "t", agentId: "a", mode: "lead", when: "hours", topics: null, hoursFrom: "08:00", hoursTo: "18:00" });
  assert.deepEqual(agentSettingsInput("t", "a", { how: "listen" }), { threadId: "t", agentId: "a", mode: "quiet" });
  assert.deepEqual(agentSettingsInput("t", "a", { when: "always" }), { threadId: "t", agentId: "a", when: "always", topics: null, hoursFrom: null, hoursTo: null });
  assert.equal(agentSettingsInput("t", "a", DEFAULT_AGENT_SETTINGS).mode, "listen");
});

test("threads.poke and the outside agent calls", () => {
  assert.deepEqual(pokeInput("thr_1", "agt_docs") satisfies CapMap["threads.poke"]["in"], { threadId: "thr_1", agentId: "agt_docs" });
  assert.deepEqual(pokeInput("thr_1", "agt_docs", " check the totals "), { threadId: "thr_1", agentId: "agt_docs", note: "check the totals" });
  assert.deepEqual(outsideAgentAddInput("thr_1", "out_cc") satisfies CapMap["threads.outside_agent.add"]["in"], { threadId: "thr_1", agentId: "out_cc" });
  assert.deepEqual(outsideAgentAddInput("thr_1", "out_cc", "listen"), { threadId: "thr_1", agentId: "out_cc", mode: "quiet" });
  assert.deepEqual(outsideAgentRemoveInput("thr_1", "out_cc") satisfies CapMap["threads.outside_agent.remove"]["in"], { threadId: "thr_1", agentId: "out_cc" });
});

test("threads.invite_guest, threads.members.add, channels.members.add, projects.members.set", () => {
  assert.deepEqual(inviteGuestInput("thr_1", " dana@fox-legal.com ", "gview", "k") satisfies CapMap["threads.invite_guest"]["in"], { threadId: "thr_1", email: "dana@fox-legal.com", level: "view", idempotencyKey: "k" });
  assert.equal(inviteGuestInput("thr_1", "a@b.co", "greply", "k").level, "reply");
  assert.deepEqual(threadMemberInput("thr_1", "usr_sara") satisfies CapMap["threads.members.add"]["in"], { threadId: "thr_1", personId: "usr_sara" });
  assert.deepEqual(channelMembersInput("ch_1", ["usr_sara", "usr_omar"]) satisfies CapMap["channels.members.add"]["in"], { channelId: "ch_1", personIds: ["usr_sara", "usr_omar"], level: "use" });
  assert.equal(channelMembersInput("ch_1", ["u"], "view").level, "view");
  assert.deepEqual(projectMemberInput("prj_1", "usr_sara", "member", "k") satisfies CapMap["projects.members.set"]["in"], { projectId: "prj_1", principal: "usr_sara", role: "member", idempotencyKey: "k" });
  assert.equal(projectMemberInput("prj_1", "usr_sara", "view", "k").role, "guest");
});

test("a chat's picks become calls in order, with settings after any agent that answers differently", () => {
  const docs: AccessPick = { ...pickFromEntry(agent("agt_docs", "Docs"), addCtx), settings: { ...DEFAULT_AGENT_SETTINGS, how: "lead", style: "full" } };
  const plan = addCalls(
    { kind: "chat", threadId: "thr_1" },
    [pickFromEntry(person("usr_sara", "Sara Malik"), addCtx), docs, pickFromEntry(outside, addCtx), pickFromNew(1, { name: "Checker", brief: "Checks", model: "Sonnet 5.5" }), { ...pickFromEmail("dana@fox-legal.com", addCtx), role: "greply" }],
    (p) => `key-${p.key}`,
  );
  assert.deepEqual(plan.calls.map((c) => c.cap), ["threads.members.add", "threads.add_agent", "threads.agent_settings.set", "threads.outside_agent.add", "threads.agent.create", "threads.invite_guest"]);
  assert.deepEqual(plan.calls[1], { cap: "threads.add_agent", input: { threadId: "thr_1", agentId: "agt_docs", mode: "lead" } });
  assert.deepEqual(plan.calls[2], { cap: "threads.agent_settings.set", input: { threadId: "thr_1", agentId: "agt_docs", mode: "lead", when: "always", topics: null, hoursFrom: null, hoursTo: null, style: "full" } });
  assert.deepEqual(plan.calls[5], { cap: "threads.invite_guest", input: { threadId: "thr_1", email: "dana@fox-legal.com", level: "reply", idempotencyKey: "key-guest:dana@fox-legal.com" } });
  assert.deepEqual(plan.unsupported, []);
});

test("a channel's people join the channel in one call per role; its agents act on the main chat", () => {
  const sara2 = pickFromEntry(person("usr_sara", "Sara Malik"), addCtx);
  const omar = { ...pickFromEntry(person("usr_omar", "Omar Reyes"), addCtx), role: "view" };
  const kai = pickFromEntry(person("usr_kai", "Kai Lund"), addCtx);
  const plan = addCalls({ kind: "channel", channelId: "ch_1", mainThreadId: "thr_main" }, [sara2, omar, kai, pickFromEntry(agent("agt_docs", "Docs"), addCtx)], (p) => p.key);
  assert.deepEqual(plan.calls.map((c) => c.cap), ["channels.members.add", "channels.members.add", "threads.add_agent"]);
  assert.deepEqual((plan.calls[0] as { input: { personIds: string[] } }).input.personIds, ["usr_sara", "usr_kai"]);
  assert.deepEqual((plan.calls[2] as { input: { threadId: string } }).input.threadId, "thr_main");
});

test("a project's people and agents are members; what needs a chat is handed back", () => {
  const plan = addCalls({ kind: "project", projectId: "prj_1" }, [pickFromEntry(person("usr_sara", "Sara"), addCtx), pickFromEntry(agent("agt_docs", "Docs"), addCtx), pickFromEntry(outside, addCtx), pickFromEmail("a@b.co", addCtx)], (p) => `k-${p.key}`);
  assert.deepEqual(plan.calls.map((c) => c.cap), ["projects.members.set", "projects.members.set"]);
  assert.deepEqual(plan.unsupported.map((p) => p.kind), ["outside", "guest"]);
});

/* ---------- capability inputs: share mode ---------- */

test("sharing keeps the access.share and access.unshare names and inputs", () => {
  assert.equal(SHARE_CAPABILITY, "access.share");
  assert.equal(UNSHARE_CAPABILITY, "access.unshare");
  const res = { resourceType: "folder" as const, resourceId: "fld_clients" };
  assert.deepEqual(shareInput(res, { kind: "person", id: "prs_omar" }, "edit", "k1") satisfies CapMap["access.share"]["in"], { resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "prs_omar" }, level: "edit", idempotencyKey: "k1" });
  assert.equal(shareInput(res, { kind: "person", id: "prs_omar" }, "edit").idempotencyKey, undefined, "no key unless the host gives one");
  assert.deepEqual(unshareInput(res, { kind: "person", id: "prs_omar" }) satisfies CapMap["access.unshare"]["in"], { resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "prs_omar" } });
  assert.equal(effectiveLevel("link", "manage"), "view");
  assert.equal(effectiveLevel("person", "manage"), "manage");
  assert.deepEqual(shareInput(res, { kind: "link", id: LINK_SUBJECT_ID }, "edit").level, "view");
});

test("share picks become access.share inputs; guests are invited, not granted", () => {
  const res = { resourceType: "agent" as const, resourceId: "agt_ember" };
  const picks = [{ ...pickFromEntry(person("usr_omar", "Omar Reyes"), { mode: "share" as const, itemType: "agent" as const }), role: "use" }, { ...pickFromEntry(dir.space!, { mode: "share", itemType: "agent" }), role: "view" }, pickFromEmail("joe@x.co", { mode: "share", itemType: "agent" })];
  assert.deepEqual(shareCalls(res, picks), [
    { resource: { type: "agent", id: "agt_ember" }, subject: { kind: "person", id: "usr_omar" }, level: "use" },
    { resource: { type: "agent", id: "agt_ember" }, subject: { kind: "group", id: "space" }, level: "view" },
  ]);
});

test("rows ported from the old sheet: raise never lower, link is view only, only direct rows are removable, order by access", () => {
  const row = (over: Partial<ShareRow> & Pick<ShareRow, "name">): ShareRow => ({ subjectKind: "person", subjectId: `prs_${over.name.toLowerCase()}`, level: "view", via: "grant", fromFolderId: null, ...over });
  assert.deepEqual(levelsFor(row({ name: "Maya", via: "folder", level: "edit" }), "note"), ["edit", "manage"]);
  assert.deepEqual(levelsFor(row({ name: "Maya" }), "note"), ["view", "edit", "manage"]);
  assert.deepEqual(levelsFor(row({ name: "Maya" }), "agent"), ["view", "use", "edit", "manage"]);
  assert.deepEqual(levelsFor(row({ name: "Maya" }), "note", ["view", "edit"]), ["view", "edit"]);
  assert.deepEqual(levelsFor(row({ name: "Public", subjectKind: "link" }), "note"), ["view"]);
  assert.deepEqual(levelsFor(row({ name: "Maya", via: "grant", level: "view" }), "vault"), ["use", "view", "edit"]);
  assert.deepEqual(levelsFor(row({ name: "Maya", via: "folder", level: "view" }), "vault"), ["view", "edit"], "a Vault row from a folder cannot drop to use");
  assert.equal(removable({ via: "grant" }), true);
  assert.equal(removable({ via: "folder" }), false);
  assert.equal(removable({ via: "owner" }), false);
  const r = sheetRows([row({ name: "Zed" }), row({ name: "Amy", level: "manage" }), row({ name: "Kai", via: "folder", fromFolderId: "f" }), row({ name: "Public", subjectKind: "link", subjectId: "public" })]);
  assert.deepEqual(r.direct.map((x) => x.name), ["Amy", "Zed"]);
  assert.deepEqual(r.inherited.map((x) => x.name), ["Kai"]);
  assert.equal(r.link?.name, "Public");
});

test("the Assistant notice is the two plain sentences", () => {
  assert.equal(ASSISTANT_NOTICE[0], "Your Assistant can't be shared. It holds your sign-ins, your memory and what you ask it, and only you see those.");
  assert.equal(ASSISTANT_NOTICE[1], "To give others an agent like it, make a new agent for the Space and share that one.");
});

test("no string shown to people holds an em dash or a section sign", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["model.ts", "parts.tsx", "index.tsx", "props.ts"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    assert.ok(!src.includes("—"), `${f} has an em dash`);
    assert.ok(!src.includes("§"), `${f} has a section sign`);
  }
});

test("addCalls sends fromStart only when Include earlier messages is on", () => {
  const person = { key: "person:usr_sara", kind: "person", id: "usr_sara", name: "Sara", role: "member" } as never;
  const off = addCalls({ kind: "chat", threadId: "thr_1" }, [person], () => "k");
  assert.deepEqual(off.calls.map((c) => c.input), [{ threadId: "thr_1", personId: "usr_sara" }]);
  const on = addCalls({ kind: "chat", threadId: "thr_1" }, [person], () => "k", { earlier: true });
  assert.deepEqual(on.calls.map((c) => c.input), [{ threadId: "thr_1", personId: "usr_sara", fromStart: true }]);
});

/* ---------- accessView: the rules behind the Dex sheet ---------- */

import { accessCount, accessSubtitle, accessView, levelHint, rowSub } from "./model.ts";
import type { ShareRow as Row } from "./props.ts";

const r = (o: Partial<Row> & Pick<Row, "subjectKind" | "subjectId">): Row => ({ name: o.subjectId, level: "view", via: "grant", fromFolderId: null, ...o });
const base = { itemType: "agent" as const, resourceId: "agt_dex", ownerId: "usr_me", ownerName: "Irfad" };

test("accessView: an item never lists itself", () => {
  const v = accessView({ ...base, shares: [r({ subjectKind: "agent", subjectId: "agt_dex", level: "edit", via: "space" })] });
  assert.deepEqual(v.agents.specific, []);
  assert.equal(v.agents.on, false);
  assert.equal(v.count, 1);
});

test("accessView: a person is one row at their highest level; the owner is only the Owner row", () => {
  const v = accessView({ ...base, shares: [
    r({ subjectKind: "person", subjectId: "usr_me", level: "manage", via: "folder" }),
    r({ subjectKind: "person", subjectId: "usr_omar", level: "view", via: "grant" }),
    r({ subjectKind: "person", subjectId: "usr_omar", level: "edit", via: "folder" }),
    r({ subjectKind: "person", subjectId: "usr_kai", level: "edit", via: "grant" }),
    r({ subjectKind: "person", subjectId: "usr_kai", level: "edit", via: "folder" }),
  ] });
  assert.deepEqual(v.people.map((p) => [p.subjectId, p.level, p.via]), [["usr_kai", "edit", "grant"], ["usr_omar", "edit", "folder"]]);
  assert.equal(v.people.some((p) => p.subjectId === "usr_me"), false);
});

test("accessView: a private agent is never listed by name, a Space agent folds into one line, one added on purpose shows", () => {
  const v = accessView({ ...base, shares: [
    r({ subjectKind: "agent", subjectId: "agt_aliza", name: "Aliza Rizvi (Agent)", level: "edit", via: "space", privateAgent: true }),
    r({ subjectKind: "agent", subjectId: "agt_docs", name: "Docs", level: "edit", via: "space" }),
    r({ subjectKind: "agent", subjectId: "agt_scout", name: "Scout", level: "use", via: "grant" }),
  ] });
  assert.deepEqual(v.agents.specific.map((a) => a.name), ["Scout"]);
  assert.equal(v.agents.on, true);
  assert.equal(JSON.stringify(v).includes("Aliza"), false);
});

test("accessView: Everyone is general access, not a person row, and its level is read from the grant", () => {
  const v = accessView({ ...base, shares: [r({ subjectKind: "group", subjectId: "grp_everyone", level: "use", via: "space" })] });
  assert.equal(v.general.level, "use");
  assert.deepEqual(v.people, []);
  assert.equal(accessView({ ...base, shares: [] }).general.level, null);
});

test("accessView: the folder words stay true, and Nobody else yet is only for a truly empty list", () => {
  const inherited = [r({ subjectKind: "person", subjectId: "usr_omar", level: "edit", via: "folder" })];
  assert.equal(accessView({ ...base, shares: inherited }).inheritedFrom, "From the Space");
  assert.equal(accessView({ ...base, folderName: "Clients", shares: inherited }).inheritedFrom, "From the folder Clients");
  assert.equal(rowSub({ subjectKind: "person", via: "folder" }), "From the Space");
  assert.equal(accessView({ ...base, shares: inherited }).empty, false);
  assert.equal(accessView({ ...base, shares: [] }).empty, true);
  assert.equal(accessView({ ...base, shares: [r({ subjectKind: "group", subjectId: "grp_everyone", via: "space" })] }).empty, false);
});

test("accessView: the count behind the sheet is the same deduped list", () => {
  const shares = [
    r({ subjectKind: "person", subjectId: "usr_me", level: "manage", via: "folder" }),
    r({ subjectKind: "person", subjectId: "usr_omar", level: "view" }),
    r({ subjectKind: "person", subjectId: "usr_omar", level: "edit", via: "folder" }),
    r({ subjectKind: "agent", subjectId: "agt_dex", via: "space" }),
    r({ subjectKind: "agent", subjectId: "agt_x", via: "space", privateAgent: true }),
    r({ subjectKind: "group", subjectId: "grp_everyone", level: "use", via: "space" }),
  ];
  assert.equal(accessCount({ ...base, shares }), 3);
  assert.equal(accessView({ ...base, shares }).count, 3);
});

test("levelHint: every level of every item has a one line description", () => {
  for (const type of ["note", "file", "record", "rtype", "artifact", "project", "vault", "agent", "automation"] as const) {
    for (const l of ["view", "use", "edit", "manage"] as const) assert.ok(levelHint(type, l).length > 0 && !/\n/.test(levelHint(type, l)));
  }
});

test("an automation offers View, Edit and Manage", () => {
  assert.deepEqual(levelDefs("automation").map((l) => l.label), ["Can view", "Can edit", "Can manage"]);
  assert.equal(accessSubtitle("automation", 3), "Automation · 3 with access");
});
