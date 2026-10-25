// Automation config and the Journey designer (spec 3.7, 2.12; ARCH 7.7): the config pane's Settings, Alerts and Runs, the Promote sheet's access diff and key replacement, the designer's stages,
// tasks and panes, and the migration preview, built from the Northwind sample through the live screen queries. Screens render with react-dom/server over react-native-web (ruling 28); the
// controls are checked by the writes they make, because a static render has no clicks. Path mapping: the packet names apps/app/tests/auto-config*.test.tsx, which lanes-check rejects as outside
// lane L9f; the lane's tests live beside the screens, as P-L9f_01's do.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { AutomationConfig } from "./AutomationConfig.tsx";
import type { ConfigTab } from "./AutomationConfig.tsx";
import { ConfigExtrasProvider } from "./data.tsx";
import { PromoteSheet } from "./PromoteSheet.tsx";
import { createConfigSample, harbor, northwind } from "./sample.ts";
import type { ConfigSample } from "./sample.ts";
import { shareRows } from "./SettingsTab.tsx";
import { ESCALATE_AFTER_HOURS, MAX_ESCALATION_STEPS, addStep, addWho, alertSentence, canPromote, choiceFor, escalationWords, hoursWords, initialChoices, nextStepHours, promoteInput, removeStep, removeWho, setChoice, setStepHours, setStepTo, setWhen, setWhere, whoWords, withoutChannel } from "./model.ts";
import type { Alerts, PromoteDiff } from "./model.ts";
import { JourneyDesigner } from "../journeys/JourneyDesigner.tsx";
import { JourneyNewSheet, newJourneyIssue, stagesFromText } from "../journeys/JourneyNewSheet.tsx";
import { JourneyPane } from "../journeys/JourneyPane.tsx";
import { MigrateView } from "../journeys/MigrateSheet.tsx";
import { addAutomation, addStage, addTask, agentSeats, canDeleteStage, canMigrate, clearTaskField, designIssues, dueWords, exitWords, initials, limitWords, migrationLine, moveStage, moveTask, removeStage, removeTask, setSeat, setTimeLimit, stageMapOf, unmappedMoves, updateTask } from "../journeys/model.ts";
import type { Journey, Preview, Stage } from "../journeys/model.ts";

const page = (s: ConfigSample, el: ReactNode): string =>
  renderToStaticMarkup(<AutomationsDataProvider value={s.data}><ConfigExtrasProvider value={s.extras}>{el}</ConfigExtrasProvider></AutomationsDataProvider>).replaceAll("<!-- -->", "");
const config = (s: ConfigSample, id: string, tab: ConfigTab = "settings"): string => page(s, <AutomationConfig automationId={id} initialTab={tab} />);
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const autoOf = (s: ConfigSample, id: string): Record<string, unknown> => s.replica.rows("automations").find((r) => r.id === id)!;
const journeyOf = (s: ConfigSample, id: string): Journey => s.replica.rows("journeys_full").find((r) => r.id === id) as unknown as Journey;
const alertsOf = (s: ConfigSample, id: string): Alerts => autoOf(s, id)["alerts"] as Alerts;
const previewOf = async (s: ConfigSample, id: string): Promise<PromoteDiff> => (await s.data.call("automations.preview_promote", { automationId: id })) as PromoteDiff;
const designer = (s: ConfigSample, id = "jrn_onboard", props: Partial<Parameters<typeof JourneyDesigner>[0]> = {}): string => page(s, <JourneyDesigner journeyId={id} {...props} />);
const pane = (s: ConfigSample, sel: { stage: string; task?: string } | null, id = "jrn_onboard", canDesign = true): string => page(s, <JourneyPane journeyId={id} selection={sel} canDesign={canDesign} />);
const nw = (): ConfigSample => createConfigSample(northwind);

/* ---------- alerts ---------- */

test("the alert sentence says who, when and where; a Personal Automation tells only its owner", () => {
  const s = nw();
  const name = s.data.name, chan = (id: string): string => (id === "chn_sales" ? "#sales" : id);
  const lead = alertsOf(s, "aut_lead");
  assert.equal(alertSentence({ kind: "space", ownerId: "usr_irfad", alerts: lead }, name, chan, "usr_irfad"), "Tells you and Maya Chen on every failure, in Needs you and #sales.");
  assert.equal(alertSentence({ kind: "space", ownerId: "usr_irfad", alerts: lead }, name, chan, "usr_omar"), "Tells Irfad Imtiaz and Maya Chen on every failure, in Needs you and #sales.");
  assert.equal(alertSentence({ kind: "space", ownerId: "usr_irfad", alerts: alertsOf(s, "aut_invoice") }, name, chan, "usr_irfad"), "Tells you after 3 failures in a row, in Needs you and a direct message.");
  assert.equal(alertSentence({ kind: "personal", ownerId: "usr_irfad", alerts: alertsOf(s, "aut_brief") }, name, chan, "usr_irfad"), "Tells you on every failure, in Needs you.");
  assert.equal(whoWords([{ kind: "role", id: "rol_ops" }, { kind: "person", id: "usr_maya" }, { kind: "group", id: "grp_admins" }], name), "the Ops leads role, Maya Chen and the Admins group");
  assert.equal(whoWords([], name), "nobody");
  assert.equal(escalationWords({ to: { kind: "role", id: "rol_ops" }, afterHours: 4 }, name), "After 4 hours, the Ops leads role is told as well");
  assert.equal(hoursWords(24), "1 day");
  assert.equal(hoursWords(1), "1 hour");
  assert.equal(hoursWords(48), "2 days");
});

test("alert edits return a new rule: add and remove who, when, where, and a chain that stays in order and stops at five", () => {
  const base: Alerts = { who: [{ kind: "person", id: "a" }], when: { mode: "every" }, where: { needsYou: true, dm: false }, escalation: [] };
  const two = addWho(base, { kind: "person", id: "b" });
  assert.deepEqual(two.who.map((w) => w.id), ["a", "b"]);
  assert.equal(addWho(two, { kind: "person", id: "b" }), two, "no duplicate");
  assert.deepEqual(removeWho(two, { kind: "person", id: "a" }).who.map((w) => w.id), ["b"]);
  assert.deepEqual(setWhen(base, "after_n", 5).when, { mode: "after_n", n: 5 });
  assert.deepEqual(setWhen(setWhen(base, "after_n", 5), "every").when, { mode: "every" });
  const withChannel = setWhere(base, { channelId: "c" });
  assert.equal(withChannel.where.channelId, "c");
  assert.equal("channelId" in withoutChannel(withChannel).where, false);
  let chain = base;
  chain = addStep(chain, { kind: "role", id: "r" }, 8);
  chain = addStep(chain, { kind: "person", id: "p" }, 2);
  assert.deepEqual(chain.escalation.map((e) => e.afterHours), [2, 8], "sorted by time");
  assert.deepEqual(setStepHours(chain, 0, 24).escalation.map((e) => e.afterHours), [8, 24], "re-sorted after a change");
  assert.equal(setStepTo(chain, 0, { kind: "person", id: "z" }).escalation[0]!.to.id, "z");
  assert.equal(nextStepHours(chain), 24, "one step past the last");
  assert.equal(nextStepHours(base), 1);
  assert.deepEqual(removeStep(chain, 0).escalation.map((e) => e.afterHours), [8]);
  let full = base;
  for (let n = 0; n < 8; n++) full = addStep(full, { kind: "person", id: `p${n}` }, ESCALATE_AFTER_HOURS[n % ESCALATE_AFTER_HOURS.length]!);
  assert.equal(full.escalation.length, MAX_ESCALATION_STEPS);
});

test("the Alerts tab: the sentence, Who, When, Where and the escalation chain, from the Automation's own rule", () => {
  const out = config(nw(), "aut_lead", "alerts");
  assert.ok(has(out, 'data-testid="alerts-tab"') && has(out, "Tells you and Maya Chen on every failure, in Needs you and #sales."));
  const order = ["Who", "When", "Where", "If it keeps failing"].map((t) => at(out, `>${t}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "sections in order");
  assert.ok(has(out, 'data-testid="row-who-usr_irfad"') && has(out, 'data-testid="row-who-usr_maya"') && has(out, 'data-testid="who-add"'));
  assert.ok(has(out, "On every failure") && !has(out, 'data-testid="when-n"'), "no count while it tells on every failure");
  for (const id of ["where-needs", "where-dm", "where-channel", "where-channel-pick"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.match(tag(out, "where-needs"), /aria-checked="true"/);
  assert.match(tag(out, "where-dm"), /aria-checked="false"/);
  assert.ok(has(out, "#sales"));
  assert.ok(has(out, 'data-testid="row-step-0"') && has(out, "The Ops leads role") && has(out, "After 4 hours") && has(out, 'data-testid="step-add"'));
  assert.ok(has(out, "Each step tells one more person or role"));
});

test("a rule that tells after failures in a row shows the count; a Personal Automation shows only you and no chain", () => {
  const s = nw();
  const inv = config(s, "aut_invoice", "alerts");
  assert.ok(has(inv, "After failures in a row") && has(inv, 'data-testid="when-n"') && has(inv, "The Admins group") && has(inv, "After 2 hours"));
  const mine = config(s, "aut_brief", "alerts");
  assert.ok(has(mine, "Only you, it is yours") && !has(mine, "If it keeps failing") && !has(mine, 'data-testid="who-add"'));
});

test("saving alerts writes the whole rule through automations.alerts.set and the pane shows it at once", async () => {
  const s = nw();
  const next = setWhere(addStep(alertsOf(s, "aut_lead"), { kind: "person", id: "usr_omar" }, 8), { dm: true });
  await s.data.call("automations.alerts.set", { automationId: "aut_lead", alerts: next });
  assert.deepEqual(s.calls.at(-1), { cap: "automations.alerts.set", input: { automationId: "aut_lead", alerts: next } });
  const out = config(s, "aut_lead", "alerts");
  assert.match(tag(out, "where-dm"), /aria-checked="true"/);
  assert.ok(has(out, "Omar Haddad") && has(out, "After 8 hours"));
});

/* ---------- settings ---------- */

test("the Settings tab of a Space Automation: scope, owner, access, followers, loops and the access it runs on", () => {
  const out = config(nw(), "aut_lead", "settings");
  assert.ok(has(out, 'data-testid="automation-config"') && has(out, "Space, owned by Irfad Imtiaz") && has(out, "New lead follow-up"));
  const order = ["Scope", "Files", "Owner", "Access", "Followers", "Loops", "Runs on access given to it"].map((t) => at(out, `>${t}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "sections in order");
  assert.ok(has(out, "Bigger than one person. It runs on access given to it, not on anyone") && has(out, 'data-testid="personal-copy"') && !has(out, 'data-testid="promote"'));
  assert.ok(has(out, "Space › Automations › New lead follow-up") && has(out, 'data-testid="open-files"'));
  assert.ok(has(out, "The accountable person shown on it."));
  assert.ok(has(out, 'data-testid="row-follower-usr_maya"') && has(out, "Updates only") && has(out, 'data-testid="unfollow-usr_maya"'));
  assert.match(tag(out, "self-trigger"), /aria-checked="false"/);
  assert.ok(has(out, "Chain depth") && has(out, "stops at 8 levels"));
  assert.ok(has(out, "Intake on Your Claude sign-in, then Northwind OpenAI key"), "the AI step with its key and backup");
  assert.ok(has(out, 'data-testid="share"') && has(out, "View sees it, its runs and its history."));
});

test("a Personal Automation: scope offers Promote to Space and says it runs on your own access; one shared with you says whose", () => {
  const s = nw();
  const mine = config(s, "aut_brief", "settings");
  assert.ok(has(mine, "Personal, only you") && has(mine, "Yours alone. It runs with only the access you already have.") && has(mine, 'data-testid="promote"') && !has(mine, 'data-testid="personal-copy"'));
  assert.ok(has(mine, 'data-testid="runs-on-yours"') && has(mine, "If you lose access to something, it stops."));
  assert.ok(!has(mine, "Followers") && !has(mine, "Loops"), "Space-only sections stay off a Personal Automation");
  s.replica.put("automations", [{ ...autoOf(s, "aut_brief"), id: "aut_theirs", ownerId: "usr_maya" } as never]);
  const theirs = config(s, "aut_theirs", "settings");
  assert.ok(has(theirs, "Personal automation, shared with you. It runs on Maya Chen") && !has(theirs, 'data-testid="promote"'));
  assert.ok(has(theirs, "Personal, shared by Maya Chen"));
});

test("followers and access go through their own capabilities and show in the pane", async () => {
  const s = nw();
  await s.data.call("automations.followers.add", { automationId: "aut_lead", follower: "usr_lena" });
  await s.data.call("automations.followers.remove", { automationId: "aut_lead", follower: "usr_maya" });
  const out = config(s, "aut_lead", "settings");
  assert.ok(has(out, 'data-testid="row-follower-usr_lena"') && !has(out, 'data-testid="row-follower-usr_maya"'));
  const before = shareRows((await s.data.call("access.shares_of", { resource: { type: "automation", id: "aut_lead" } })) as never, s.data.name);
  assert.deepEqual(before.map((r) => [r.subjectId, r.level, r.via, r.through]), [["usr_irfad", "manage", "owner", "owner"], ["usr_maya", "edit", "grant", "direct"], ["usr_omar", "view", "grant", "direct"], ["agt_intake", "use", "grant", "direct"], ["grp_admins", "view", "space", "group"]]);
  await s.data.call("access.share", { resource: { type: "automation", id: "aut_lead" }, subject: { kind: "person", id: "usr_lena" }, level: "view" });
  await s.data.call("access.unshare", { resource: { type: "automation", id: "aut_lead" }, subject: { kind: "person", id: "usr_omar" } });
  const after = shareRows((await s.data.call("access.shares_of", { resource: { type: "automation", id: "aut_lead" } })) as never, s.data.name);
  assert.deepEqual(after.map((r) => r.subjectId).sort(), ["agt_intake", "grp_admins", "usr_irfad", "usr_lena", "usr_maya"]);
  assert.equal(after.find((r) => r.subjectId === "usr_irfad")!.via, "owner", "the owner cannot be removed");
});

test("Make a personal copy and the webhook address use their own capabilities", async () => {
  const s = nw();
  const out = (await s.data.call("automations.make_personal_copy", { automationId: "aut_lead", idempotencyKey: "k" })) as { automation: { id: string; kind: string; name: string } };
  assert.equal(out.automation.kind, "personal");
  assert.equal(out.automation.name, "New lead follow-up (mine)");
  const url1 = ((await s.data.call("automations.webhook_url.get", { automationId: "aut_lead" })) as { url: string }).url;
  const url2 = ((await s.data.call("automations.webhook_url.rotate", { automationId: "aut_lead", confirm: true })) as { url: string }).url;
  assert.notEqual(url1, url2);
  assert.equal(((await s.data.call("automations.webhook_url.get", { automationId: "aut_lead" })) as { url: string }).url, url2);
  await s.data.call("automations.update", { automationId: "aut_lead", definition: { ...(autoOf(s, "aut_lead")["definition"] as never as { triggers: never[]; nodes: never[] }), allowSelfTrigger: true }, expectedVersion: 5 });
  assert.match(tag(config(s, "aut_lead", "settings"), "self-trigger"), /aria-checked="true"/);
  await assert.rejects(() => s.data.call("automations.update", { automationId: "aut_lead", expectedVersion: 5 }), /Someone else changed/);
});

/* ---------- runs ---------- */

test("the Runs tab lists the latest runs with the shared run row and a way to all of them", () => {
  const out = config(nw(), "aut_lead", "runs");
  assert.ok(has(out, 'data-testid="runs-tab"') && has(out, "Latest runs") && has(out, 'data-testid="runs-list"'));
  assert.ok(has(out, 'data-testid="row-run-run_a"') && has(out, 'data-testid="row-run-run_b"') && has(out, 'data-testid="row-run-run_c"'));
  assert.ok(at(out, 'data-testid="row-run-run_a"') < at(out, 'data-testid="row-run-run_b"'), "newest first");
  assert.ok(has(out, "Text the lead failed: no Twilio key") && has(out, 'data-testid="all-runs"') && has(out, "All runs in the main view"));
  assert.ok(has(config(createConfigSample(harbor), "aut_h2", "runs"), "None yet."));
});

/* ---------- promote ---------- */

test("the Promote sheet shows the access diff: what stops running on yours, what it will run on, and the key to replace", async () => {
  const s = nw();
  const preview = await previewOf(s, "aut_brief");
  const a = s.replica.rows("automations").find((r) => r.id === "aut_brief") as never;
  const out = page(s, <PromoteSheet automation={a} preview={preview} onClose={() => undefined} />);
  assert.ok(has(out, "Promote “My morning briefing” to the Space") && has(out, "This is the access it will run on. Confirm the changes."));
  assert.ok(has(out, "It becomes a Service") && has(out, "Agent steps run on a shared API key, never a subscription."));
  const order = ["Stops running on your access", "Will run on access given to it"].map((t) => at(out, `>${t}<`));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  assert.ok(has(out, "Your own access to Calendar events") && has(out, "Your own #Google_Calendar sign-in") && has(out, "Your own AI account for 1 agent step") && has(out, "A subscription sign-in stays yours and cannot be shared"));
  assert.ok(has(out, "View on Calendar events") && has(out, "A new grant to the Automation") && has(out, "From the Vault. Shared with the automation. Agents see the handle, never the value.") && has(out, "The Google Calendar connection"));
  assert.ok(has(out, 'data-testid="replace-brief"') && has(out, "Write the briefing") && has(out, "Your Claude sign-in is a subscription. It stays yours and cannot be shared."));
  assert.ok(has(out, "Northwind OpenAI key"), "the shared API key it starts on");
  assert.ok(has(out, "History, versions and runs come with it.") && has(out, "You can make a personal copy later."));
  assert.doesNotMatch(tag(out, "promote-confirm"), /aria-disabled="true"/);
});

test("Promote waits for a shared API key: a step with none to use keeps the button off, and a subscription never counts", async () => {
  const s = nw();
  const preview = await previewOf(s, "aut_brief");
  const keys = [{ id: "key_claude", name: "Your Claude sign-in", kind: "subscription" as const }, { id: "key_api", name: "Team key", kind: "api" as const }];
  const picked = initialChoices(preview.diff, keys);
  assert.deepEqual(picked, [{ stepId: "brief", keyId: "key_api" }], "starts on the first API key");
  assert.ok(canPromote(preview, picked, keys));
  assert.ok(!canPromote(preview, setChoice(picked, "brief", "key_claude"), keys), "a subscription is not allowed");
  assert.ok(!canPromote(preview, setChoice(picked, "brief", ""), keys), "no key, no promote");
  assert.equal(choiceFor(picked, "brief"), "key_api");
  const noApi = initialChoices(preview.diff, [keys[0]!]);
  assert.deepEqual(noApi, [{ stepId: "brief", keyId: "" }]);
  assert.ok(!canPromote(preview, noApi, [keys[0]!]));
  const plain = await previewOf(s, "aut_digest");
  assert.ok(canPromote(plain, [], keys), "nothing to replace and ready");
  const off = renderToStaticMarkup(<AutomationsDataProvider value={{ ...s.data, keys: [keys[0]!] }}><PromoteSheet automation={s.replica.rows("automations").find((r) => r.id === "aut_brief") as never} preview={preview} onClose={() => undefined} /></AutomationsDataProvider>);
  assert.match(tag(off, "promote-confirm"), /aria-disabled="true"/);
  assert.ok(has(off, "No shared API key") === false && has(off, "Choose a key"), "the row says to choose");
});

test("promoting calls automations.promote with the keys chosen; it refuses a missing or subscription key and the Automation becomes a Space Automation", async () => {
  const s = nw();
  assert.deepEqual(promoteInput("aut_brief", "usr_irfad", [{ stepId: "brief", keyId: "key_nw_openai" }, { stepId: "x", keyId: "" }]), { automationId: "aut_brief", confirm: true, ownerId: "usr_irfad", replaceKeys: [{ stepId: "brief", keyId: "key_nw_openai" }] });
  await assert.rejects(() => s.data.call("automations.promote", promoteInput("aut_brief", "usr_irfad", [])), /Choose a shared API key/);
  await assert.rejects(() => s.data.call("automations.promote", promoteInput("aut_brief", "usr_irfad", [{ stepId: "brief", keyId: "key_claude" }])), /subscription sign-in cannot be shared/);
  assert.equal(autoOf(s, "aut_brief")["kind"], "personal", "nothing changed by the refusals");
  const out = (await s.data.call("automations.promote", promoteInput("aut_brief", "usr_irfad", [{ stepId: "brief", keyId: "key_nw_openai" }]))) as { automation: { kind: string; definition: { nodes: { id: string; ai?: { keyId?: string } }[] } } };
  assert.equal(out.automation.kind, "space");
  assert.equal(out.automation.definition.nodes.find((n) => n.id === "brief")?.ai?.keyId, "key_nw_openai", "the AI step now runs on the shared key");
  assert.ok(has(config(s, "aut_brief", "settings"), "Space, owned by Irfad Imtiaz"));
});

/* ---------- the Journey designer ---------- */

test("the designer: where the records are, the stages in order with their counts, and the late ones", () => {
  const out = designer(nw());
  assert.ok(has(out, 'data-testid="journey-designer"') && has(out, "Client onboarding") && has(out, "14 records") && has(out, "1 late"));
  assert.ok(has(out, "Where the records are now") && has(out, 'data-testid="funnel-intake"') && has(out, "Records per stage"));
  const stages = ["consult", "intake", "letter", "kickoff", "onboarded"].map((k) => at(out, `data-testid="stage-${k}"`));
  assert.deepEqual([...stages].sort((a, b) => a - b), stages);
  for (const t of ["Consult booked", "Intake", "Engagement letter", "Kickoff", "Onboarded"]) assert.ok(has(out, t), t);
  assert.ok(has(out, ">3 records<") && has(out, ">4 records<") && has(out, ">1 late<"), "counts and the late ones");
  assert.ok(has(out, "Stages") && has(out, 'data-testid="open-records"') && has(out, "Open records in Records"));
  assert.ok(has(out, 'data-testid="add-stage"') && has(out, 'data-testid="subtab-settings"'));
});

test("each stage lists its tasks as shared rows with the three seats and when each is due, and the Automations that run on entering", () => {
  const out = designer(nw());
  for (const t of ["Confirm the consult time", "Send the intake form", "Review the intake answers", "Run the conflict check", "Collect the client", "Draft the engagement letter", "Sign engagement letter", "Note any special terms", "Book the kickoff call", "Prepare the kickoff notes", "Hand over to the client"]) assert.ok(has(out, t), t);
  assert.ok(has(out, 'data-testid="row-task-t_review"') && has(out, 'data-testid="seats-t_review"'));
  assert.ok(has(out, ">1 d<") && has(out, ">2 d<") && has(out, ">3 d<") && has(out, ">now<"), "due after entering");
  assert.ok(has(out, 'aria-label="Optional"') && has(out, 'aria-label="Required"'));
  assert.ok(has(out, 'data-testid="add-task-intake"') && has(out, 'data-testid="add-auto-intake"'));
  assert.ok(has(out, ">On entering<") && has(out, "Send intake form") && has(out, "Welcome and handover"));
  assert.ok(has(out, 'data-testid="row-auto-consult-aut_intake1"'));
});

test("a selected stage or task uses the quiet selection; a folded stage hides its tasks", () => {
  const s = nw();
  const stage = designer(s, "jrn_onboard", { selection: { stage: "intake" } });
  assert.match(tag(stage, "row-stage-intake"), /var\(--sel\)/);
  const task = designer(s, "jrn_onboard", { selection: { stage: "intake", task: "t_review" } });
  assert.match(tag(task, "row-task-t_review"), /var\(--sel\)/);
  assert.doesNotMatch(tag(task, "row-stage-intake"), /var\(--sel\)/);
  const folded = designer(s, "jrn_onboard", { initialFolded: ["intake"] });
  assert.ok(!has(folded, "Review the intake answers") && has(folded, "Draft the engagement letter"));
});

test("without the Design Journeys role the page is read-only: no edit controls, no Settings tab", () => {
  const out = designer(nw(), "jrn_onboard", { canDesign: false });
  assert.ok(has(out, 'data-testid="view-only"') && has(out, "View only") && has(out, "needs the Design Journeys role"));
  for (const id of ["add-stage", "add-task-intake", "add-auto-intake", "subtab-settings"]) assert.ok(!has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, "Review the intake answers"));
});

test("the Settings tab of a Journey: record type, Subject, start rule, name, version move and delete", () => {
  const out = designer(nw(), "jrn_onboard", { initialTab: "settings" });
  assert.ok(has(out, 'data-testid="journey-settings"') && has(out, "Record type") && has(out, "Its records live in Records.") && has(out, 'data-testid="subject"') && has(out, ">lead<"));
  assert.ok(has(out, "Starts when") && has(out, "lead.created") && has(out, 'data-testid="rule-enabled"'));
  assert.match(tag(out, "rule-enabled"), /aria-checked="true"/);
  assert.ok(has(out, 'aria-label="Journey name"') && has(out, "Move records to version 3") && has(out, 'data-testid="migrate"'));
  assert.ok(has(out, "14 records stay in Records as plain records") && has(out, 'data-testid="delete-journey"'));
  assert.ok(!has(designer(createConfigSample(harbor), "jrn_h", { initialTab: "settings" }), "Move records to version"), "version 1 has nothing to move");
  assert.ok(!has(out, "Give each record a channel"), "there is no per-type workspace setting");
});

test("the Journey list, the pane for no selection, a stage and a task", () => {
  const s = nw();
  const none = pane(s, null);
  assert.ok(has(none, 'data-testid="journey-pane"') && has(none, "14 active records") && has(none, "1. Consult booked") && has(none, "Automations on its stages") && has(none, "On entering Consult booked"));
  const st = pane(s, { stage: "intake" });
  assert.ok(has(st, 'data-testid="stage-pane"') && has(st, "Stage 2 of 5, 4 records") && has(st, "When every required task is done") && has(st, "3 (3 required)"), "tasks and the rule");
  assert.ok(has(st, "3 days") && has(st, "Lena Ortiz") && has(st, "1 record is over it") && has(st, "No automations on this stage."));
  assert.ok(has(st, 'aria-label="Stage name"'));
  const tk = pane(s, { stage: "intake", task: "t_review" });
  assert.ok(has(tk, 'data-testid="task-pane"') && has(tk, "Task in Intake") && has(tk, 'aria-label="Task name"'));
  for (const slot of ["assigned", "reviewer", "approver"]) assert.ok(has(tk, `data-testid="seat-${slot}"`), slot);
  assert.ok(has(tk, "Intake") && has(tk, "Lena Ortiz") && has(tk, "Nobody"), "seats");
  assert.ok(has(tk, "Agent key") && has(tk, "Your Claude sign-in") && has(tk, "Northwind OpenAI key") && has(tk, "For Intake"));
  assert.ok(has(tk, "Due after entering") && has(tk, "1 d") && has(tk, "The stage waits for it"));
  assert.match(tag(tk, "task-required"), /aria-checked="true"/);
  const human = pane(s, { stage: "intake", task: "t_id" });
  assert.ok(!has(human, "Agent key"), "no agent, no key");
  assert.ok(has(pane(s, { stage: "letter", task: "t_terms" }), "The stage does not wait"));
  const ro = pane(s, { stage: "intake", task: "t_review" }, "jrn_onboard", false);
  assert.ok(!has(ro, 'aria-label="Task name"') && !has(ro, 'data-testid="task-brief"'));
  assert.ok(has(pane(s, { stage: "nope" }), 'data-testid="journey-pane"'), "an unknown selection falls back to the Journey");
});

test("Harbor Studio draws the same designer over its own Journey", () => {
  const h = createConfigSample(harbor);
  const out = designer(h, "jrn_h");
  assert.ok(has(out, "Client project") && has(out, "2 records") && has(out, "Plan the shoot") && !has(out, "Client onboarding"));
  assert.ok(!has(out, ">Scheduler<"), "agent faces show their initial only, never the name as text");
  assert.ok(has(out, 'aria-label="Scheduler"'), "the shared Avatar (P-UI_05) still names the agent for assistive technology");
  assert.ok(has(designer(h, "jrn_none"), "This Journey is not available"));
});

/* ---------- designing: model edits and the version-checked write ---------- */

const stagesOf = (s: ConfigSample, id = "jrn_onboard"): Stage[] => journeyOf(s, id).stages;

test("stage and task edits return new lists; stages stay numbered, keys stay unique", () => {
  const s = nw();
  const st = stagesOf(s);
  const plus = addStage(st, "Review");
  assert.deepEqual(plus.map((x) => x.order), [0, 1, 2, 3, 4, 5]);
  assert.equal(new Set(plus.map((x) => x.key)).size, 6);
  assert.deepEqual(moveStage(st, "onboarded", 0).map((x) => x.key), ["onboarded", "consult", "intake", "letter", "kickoff"]);
  assert.deepEqual(moveStage(st, "onboarded", 0).map((x) => x.order), [0, 1, 2, 3, 4]);
  assert.deepEqual(removeStage(st, "kickoff").map((x) => x.key), ["consult", "intake", "letter", "onboarded"]);
  const withTask = addTask(st, "intake", "Call the client", { kind: "person", id: "usr_maya" });
  const added = withTask.find((x) => x.key === "intake")!.tasks.slice(-1)[0]!;
  assert.deepEqual([added.title, added.required, added.assigned.id], ["Call the client", true, "usr_maya"]);
  assert.equal(new Set(withTask.flatMap((x) => x.tasks.map((t) => t.key))).size, 12);
  assert.deepEqual(removeTask(withTask, "intake", added.key).find((x) => x.key === "intake")!.tasks.length, 3);
  assert.deepEqual(moveTask(st, "intake", "t_id", -1).find((x) => x.key === "intake")!.tasks.map((t) => t.key), ["t_review", "t_id", "t_conflict"]);
  assert.deepEqual(moveTask(st, "intake", "t_review", -1), st, "the first task cannot go up");
  assert.deepEqual(addAutomation(st, "intake", "aut_lead").find((x) => x.key === "intake")!.automations, ["aut_lead"]);
  assert.equal(st.find((x) => x.key === "intake")!.automations.length, 0, "the original is untouched");
});

test("the three seats: Assigned always has someone, Reviewer and Approver clear; the key goes when no agent is left", () => {
  const st = stagesOf(nw());
  const task = (stages: Stage[]) => stages.find((x) => x.key === "intake")!.tasks.find((t) => t.key === "t_review")!;
  assert.deepEqual(agentSeats(task(st)).map((a) => a.slot), ["assigned"]);
  const noReviewer = setSeat(st, "intake", "t_review", "reviewer", null);
  assert.equal(task(noReviewer).reviewer, undefined);
  assert.equal(task(setSeat(st, "intake", "t_review", "assigned", null)).assigned.id, "agt_intake", "Assigned cannot be cleared");
  const approver = setSeat(st, "intake", "t_review", "approver", { kind: "person", id: "usr_maya" });
  assert.equal(task(approver).approver?.id, "usr_maya");
  const noKey = clearTaskField(st, "intake", "t_review", "keyId");
  assert.equal(task(noKey).keyId, undefined);
  assert.equal(task(noKey).backupKeyId, "key_nw_openai");
  assert.equal(task(updateTask(st, "intake", "t_review", { required: false })).required, false);
  assert.equal(dueWords(undefined), "now");
  assert.equal(dueWords(24), "1 d");
  assert.equal(dueWords(36), "36 h");
  assert.equal(task(clearTaskField(updateTask(st, "intake", "t_review", { dueAfterHours: 8 }), "intake", "t_review", "dueAfterHours")).dueAfterHours, undefined);
});

test("rules and words: exit, time limit, escalation, initials, issues", () => {
  const st = stagesOf(nw());
  const intake = st.find((x) => x.key === "intake")!;
  assert.equal(exitWords(intake.exit), "When every required task is done");
  assert.equal(exitWords({ requireTasks: false, manualOnly: true }), "Only when someone moves it");
  assert.equal(limitWords(intake.timeLimit, (id) => id), "3 days, then usr_lena is told");
  assert.equal(limitWords({ hours: 48 }, (id) => id), "2 days");
  assert.equal(limitWords(undefined, (id) => id), "None");
  assert.equal(setTimeLimit(st, "intake", null).find((x) => x.key === "intake")!.timeLimit, undefined);
  assert.equal(setTimeLimit(st, "letter", { hours: 24 }).find((x) => x.key === "letter")!.timeLimit?.hours, 24);
  assert.equal(initials("Client onboarding"), "CO");
  assert.equal(initials("ATP"), "A");
  assert.deepEqual(designIssues(st), []);
  assert.deepEqual(designIssues([]), ["A Journey needs at least one stage"]);
  assert.deepEqual(designIssues([...st, { ...st[0]!, key: "dup", title: "intake" }]), ["Two stages are named intake"]);
  assert.deepEqual(designIssues([{ ...st[0]!, title: " " }]), ["A stage needs a name"]);
});

test("journeys.design is checked against the version it started from, refuses a stage with records, and the designer shows what was saved", async () => {
  const s = nw();
  const j = journeyOf(s, "jrn_onboard");
  const next = addTask(j.stages, "kickoff", "Order the welcome gift", { kind: "person", id: "usr_omar" });
  await s.data.call("journeys.design", { journeyId: j.id, stages: next, expectedVersion: j.version });
  assert.equal(journeyOf(s, "jrn_onboard").version, j.version + 1);
  assert.ok(has(designer(s), "Order the welcome gift"));
  await assert.rejects(() => s.data.call("journeys.design", { journeyId: j.id, stages: next, expectedVersion: j.version }), /Someone else changed this Journey/);
  await assert.rejects(() => s.data.call("journeys.design", { journeyId: j.id, stages: removeStage(next, "intake"), expectedVersion: j.version + 1 }), /Intake has records in it/);
  assert.equal(canDeleteStage([{ stage: "intake", count: 4, overLimit: 1 }], "intake"), false);
  assert.equal(canDeleteStage([{ stage: "intake", count: 4, overLimit: 1 }], "letter"), true);
  const fresh = addStage(journeyOf(s, "jrn_onboard").stages, "Review");
  await s.data.call("journeys.design", { journeyId: j.id, stages: fresh, expectedVersion: j.version + 1 });
  const key = journeyOf(s, "jrn_onboard").stages.at(-1)!.key;
  await s.data.call("journeys.design", { journeyId: j.id, stages: removeStage(journeyOf(s, "jrn_onboard").stages, key), expectedVersion: j.version + 2 });
  assert.equal(journeyOf(s, "jrn_onboard").stages.length, 5, "an empty stage can go");
});

test("rules, rename and the start rule save through their own capabilities", async () => {
  const s = nw();
  await s.data.call("journeys.rules.set", { journeyId: "jrn_onboard", stageKey: "letter", exit: { requireTasks: false, manualOnly: true }, timeLimit: { hours: 48 } });
  const letter = journeyOf(s, "jrn_onboard").stages.find((x) => x.key === "letter")!;
  assert.deepEqual([letter.exit.manualOnly, letter.timeLimit?.hours], [true, 48]);
  await s.data.call("journeys.rules.set", { journeyId: "jrn_onboard", stageKey: "letter", timeLimit: null });
  assert.equal(journeyOf(s, "jrn_onboard").stages.find((x) => x.key === "letter")!.timeLimit, undefined);
  await s.data.call("journeys.rename", { journeyId: "jrn_onboard", name: "Client intake" });
  assert.ok(has(designer(s), "Client intake"));
  const j = journeyOf(s, "jrn_onboard");
  await s.data.call("journeys.design", { journeyId: j.id, stages: j.stages, startRule: { event: "lead.created", enabled: false }, expectedVersion: j.version });
  assert.equal(journeyOf(s, "jrn_onboard").startRule?.enabled, false);
  assert.match(tag(designer(s, "jrn_onboard", { initialTab: "settings" }), "rule-enabled"), /aria-checked="false"/);
  await s.data.call("journeys.delete", { journeyId: "jrn_matter" });
  assert.ok(has(designer(s, "jrn_matter"), "This Journey is not available"));
});

/* ---------- migration preview ---------- */

const previewJ = async (s: ConfigSample, map?: Record<string, string>): Promise<Preview> => (await s.data.call("journeys.preview_migrate", { journeyId: "jrn_onboard", toVersion: 3, ...(map ? { stageMap: map } : {}) })) as Preview;

test("the migration preview names every old stage with its records and where it goes; a stage with no match must be mapped before anything moves", async () => {
  const s = nw();
  const p = await previewJ(s);
  assert.equal(p.recordsAffected, 14);
  assert.deepEqual(p.moves.map((m) => [m.from, m.records, m.to]), [["consult", 3, "consult"], ["paperwork", 4, null], ["letter", 3, "letter"], ["kickoff", 2, "kickoff"], ["onboarded", 2, "onboarded"]]);
  assert.deepEqual(p.unmapped, ["paperwork"]);
  assert.deepEqual(unmappedMoves(p).map((m) => m.from), ["paperwork"]);
  assert.equal(migrationLine(p), "14 records move from version 2 to version 3.");
  assert.equal(canMigrate(p, stageMapOf(p, {})), false);
  const map = stageMapOf(p, { paperwork: "intake" });
  assert.deepEqual(map, { consult: "consult", paperwork: "intake", letter: "letter", kickoff: "kickoff", onboarded: "onboarded" });
  assert.equal(canMigrate(p, map), true);
  assert.equal(canMigrate({ ...p, blockers: ["A stage in use has no mapping"] }, map), false);
  const again = await previewJ(s, { paperwork: "intake" });
  assert.deepEqual(again.unmapped, []);
  assert.equal(migrationLine({ ...p, recordsAffected: 0 }), "No records are in flight, so nothing moves.");
});

test("journeys.migrate refuses a map with a stage missing and returns the run that moves the records", async () => {
  const s = nw();
  await assert.rejects(() => s.data.call("journeys.migrate", { journeyId: "jrn_onboard", toVersion: 3, stageMap: { consult: "consult" } }), /Every stage needs a place to go/);
  const out = (await s.data.call("journeys.migrate", { journeyId: "jrn_onboard", toVersion: 3, stageMap: { consult: "consult", paperwork: "intake", letter: "letter", kickoff: "kickoff", onboarded: "onboarded" } })) as { runId: string };
  assert.ok(out.runId);
});

test("the migration sheet shows each stage's records and where they go, flags the one without a match, and keeps Move off until it is mapped", async () => {
  const s = nw();
  const j = journeyOf(s, "jrn_onboard");
  const noop = (): void => undefined;
  const render = (state: Parameters<typeof MigrateView>[0]["state"], overrides: Record<string, string> = {}, extra: Partial<Parameters<typeof MigrateView>[0]> = {}): string =>
    renderToStaticMarkup(<MigrateView journey={j} toVersion={3} state={state} overrides={overrides} busy={false} error={null} onMap={noop} onMove={noop} onClose={noop} {...extra} />).replaceAll("<!-- -->", "");
  const p = await previewJ(s);
  const before = render({ phase: "ready", preview: p });
  assert.ok(has(before, "Move records to version 3") && has(before, "14 records move from version 2 to version 3.") && has(before, "Nothing moves until you press the button."));
  for (const k of ["consult", "paperwork", "letter", "kickoff", "onboarded"]) assert.ok(has(before, `data-testid="move-${k}"`), k);
  assert.ok(has(before, "Choose a stage") && has(before, "Not mapped yet: paperwork."), "the stage without a match");
  assert.match(tag(before, "migrate-confirm"), /aria-disabled="true"/);
  const mapped = render({ phase: "ready", preview: await previewJ(s, { paperwork: "intake" }) }, { paperwork: "intake" });
  assert.ok(!has(mapped, "Not mapped yet") && has(mapped, "Move 14 records"));
  assert.doesNotMatch(tag(mapped, "migrate-confirm"), /aria-disabled="true"/);
  assert.ok(has(render({ phase: "loading" }), "Working out where the records would go"));
  assert.ok(has(render({ phase: "failed", message: "That did not load." }), 'data-testid="migrate-failed"'));
  assert.ok(has(render({ phase: "ready", preview: { ...p, blockers: ["Intake is in use and has no mapping"] } }, { paperwork: "intake" }), "Intake is in use and has no mapping"));
  assert.ok(has(render({ phase: "ready", preview: p }, {}, { error: "That did not work." }), "That did not work."));
});

/* ---------- a new Journey ---------- */

test("a new Journey needs a name, a Subject and stages; stages come one per line or comma and are made with the default rule", async () => {
  const stages = stagesFromText("Posted, Screening\nInterviews,, Offer ");
  assert.deepEqual(stages.map((x) => x.title), ["Posted", "Screening", "Interviews", "Offer"]);
  assert.deepEqual(stages.map((x) => x.order), [0, 1, 2, 3]);
  assert.deepEqual(stages[0]!.exit, { requireTasks: true });
  assert.equal(newJourneyIssue("", "person", stages), "Give it a name");
  assert.equal(newJourneyIssue("Hire", " ", stages), "A Journey needs a Subject");
  assert.equal(newJourneyIssue("Hire", "person", []), "Add at least one stage");
  assert.equal(newJourneyIssue("Hire", "person", stagesFromText("A, a")), "Two stages are named a");
  assert.equal(newJourneyIssue("Hire", "person", stages), null);
  const s = nw();
  const out = renderToStaticMarkup(<AutomationsDataProvider value={s.data}><JourneyNewSheet onClose={() => undefined} initialName="Hire" initialSubject="person" initialStages="Posted, Screening, Offer" /></AutomationsDataProvider>);
  assert.ok(has(out, "New Journey type") && has(out, "Records of this type move through the stages you list.") && has(out, "3 stages: Posted, Screening, Offer"));
  assert.doesNotMatch(tag(out, "new-create"), /aria-disabled="true"/);
  assert.match(tag(renderToStaticMarkup(<AutomationsDataProvider value={s.data}><JourneyNewSheet onClose={() => undefined} /></AutomationsDataProvider>), "new-create"), /aria-disabled="true"/);
  const made = (await s.data.call("journeys.create", { name: "Hire", subjectType: "person", stages, idempotencyKey: "k" })) as { journey: { id: string; stages: unknown[] } };
  assert.equal(made.journey.stages.length, 4);
  assert.ok(has(designer(s, made.journey.id), "Hire") && has(designer(s, made.journey.id), "0 records"));
});

/* ---------- copy ---------- */

test("no copy in the config pane or the designer uses an em dash or a section sign", async () => {
  const s = nw();
  const p = await previewOf(s, "aut_brief");
  const outs = [
    config(s, "aut_lead", "settings"), config(s, "aut_lead", "alerts"), config(s, "aut_lead", "runs"), config(s, "aut_brief", "settings"),
    page(s, <PromoteSheet automation={s.replica.rows("automations").find((r) => r.id === "aut_brief") as never} preview={p} onClose={() => undefined} />),
    designer(s), designer(s, "jrn_onboard", { initialTab: "settings" }), pane(s, null), pane(s, { stage: "intake" }), pane(s, { stage: "intake", task: "t_review" }),
  ];
  for (const out of outs) { assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash"); assert.ok(!has(out, String.fromCharCode(0xa7)), "no section sign"); }
});
