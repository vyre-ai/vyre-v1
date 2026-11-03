// Space AI accounts in the resolver (owner ruling 9): each use pays only for its kind of turn (team chats, automations, goals, agent work), the person's own account comes first for their own
// chats, the cheapest Space account that fits the turn's model pays, a capped one is passed over, and a pin (the chat's account, the agent's key, the step's key) is honoured or passed over with a reason.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveAccount } from "../../../agent/src/accounts/index.ts";
import type { AccountRow, ResolveRequest } from "../../../agent/src/accounts/index.ts";

const row = (o: Partial<AccountRow> & { ref: string }): AccountRow => ({
  driver: "anthropic", provider: "anthropic", kind: "api_key", title: o.ref, mine: false, ownerId: null, status: "ok", lastProbeAt: null, spaceMayUse: true, cost: 3, ...o,
});
const OWN = row({ ref: "#Dana_Anthropic", mine: true, ownerId: "usr_dana", spaceMayUse: false });
const OWN_SUB = row({ ref: "sub_dana", kind: "subscription", driver: "claude_code", provider: "claude-code", mine: true, ownerId: "usr_dana", spaceMayUse: false });
/** Anthropic credits kept for automations (the owner's example). */
const CREDITS = row({ ref: "#Anthropic_Team_credits", uses: { automations: true }, models: ["claude-sonnet-5-5", "claude-haiku-5-5"] });
/** The Space AI key from before, moved over: team chats, everyone. */
const TEAM = row({ ref: "#OpenCode_Go_for_everyone", driver: "opencode_go", provider: "opencode-go", cost: 1, uses: { teamChats: { who: "everyone" } }, teamChatsForMe: true, models: ["glm-5.3", "kimi-k3"] });
const GOALS = row({ ref: "#Goals_Key", uses: { goals: true }, models: ["claude-sonnet-5-5"] });
const WORK_ALL = row({ ref: "#Agent_Work", uses: { agentWork: { which: "all" } }, models: ["claude-sonnet-5-5"] });
const WORK_SCOUT = row({ ref: "#Scout_Work", uses: { agentWork: { which: ["agt_scout"] } }, models: ["claude-sonnet-5-5"] });

const base = (over: Partial<ResolveRequest> = {}): ResolveRequest => ({
  starter: "usr_dana", trigger: "message", agent: { accountPolicy: "asker", agentId: "agt_spark" }, backupRefs: [], policy: "any", accounts: [], onServer: true, ...over,
});
const ref = (r: ReturnType<typeof resolveAccount>) => r.accountRef;

test("teamChats: a member with no account of her own runs on it; one with her own runs on her own; the switch-off sign-in still counts as her own", () => {
  assert.equal(ref(resolveAccount(base({ starter: "usr_mia", accounts: [OWN, TEAM, CREDITS] }))), "#OpenCode_Go_for_everyone");
  assert.equal(ref(resolveAccount(base({ accounts: [OWN, TEAM, CREDITS] }))), "#Dana_Anthropic", "own first: team chats is only a fallback");
  assert.equal(ref(resolveAccount(base({ accounts: [OWN_SUB, TEAM] }))), "sub_dana");
  // kept for some groups: a person outside them does not reach it
  const groups = { ...TEAM, uses: { teamChats: { who: ["grp_sales"] } }, teamChatsForMe: false };
  assert.equal(resolveAccount(base({ starter: "usr_mia", accounts: [groups] })).allowed, false);
  assert.equal(ref(resolveAccount(base({ starter: "usr_mia", accounts: [{ ...groups, teamChatsForMe: true }] }))), "#OpenCode_Go_for_everyone");
  // an account kept for automations only never pays for a chat
  assert.equal(resolveAccount(base({ starter: "usr_mia", accounts: [CREDITS] })).allowed, false);
});

test("automations: an automation step runs on the Space account kept for automations even when its person has an account of her own; a chat of hers stays on her own", () => {
  const accounts = [OWN, TEAM, CREDITS];
  assert.equal(ref(resolveAccount(base({ trigger: "task", accounts, model: "claude-sonnet-5-5" }))), "#Anthropic_Team_credits");
  assert.equal(ref(resolveAccount(base({ trigger: "message", accounts, model: "claude-sonnet-5-5" }))), "#Dana_Anthropic");
  // the team-chats account is not for automations: with no automations account the step runs on her own
  assert.equal(ref(resolveAccount(base({ trigger: "task", accounts: [OWN, TEAM] }))), "#Dana_Anthropic");
  // her sign-in with the switch off is not for automations
  assert.equal(resolveAccount(base({ trigger: "task", accounts: [OWN_SUB, TEAM] })).allowed, false);
});

test("goals: a goal's turn runs on the goals account; a wake-up of her chat runs on her own first, then the goals account, never the team-chats one", () => {
  assert.equal(ref(resolveAccount(base({ trigger: "goal", accounts: [OWN, TEAM, GOALS] }))), "#Goals_Key");
  assert.equal(ref(resolveAccount(base({ trigger: "wake", accounts: [OWN, TEAM, GOALS] }))), "#Dana_Anthropic");
  assert.equal(ref(resolveAccount(base({ trigger: "wake", starter: "usr_mia", accounts: [OWN, TEAM, GOALS] }))), "#Goals_Key");
  assert.equal(resolveAccount(base({ trigger: "wake", starter: "usr_mia", accounts: [TEAM] })).allowed, false);
});

test("agentWork: a routine or watcher runs on an account kept for every agent, or for its agent only", () => {
  assert.equal(ref(resolveAccount(base({ trigger: "routine", routineOwner: "usr_mia", accounts: [TEAM, WORK_ALL] }))), "#Agent_Work");
  assert.equal(ref(resolveAccount(base({ trigger: "routine", routineOwner: "usr_mia", accounts: [TEAM, WORK_SCOUT] }))), null, "kept for Scout, not Spark");
  assert.equal(ref(resolveAccount(base({ trigger: "routine", routineOwner: "usr_mia", agent: { accountPolicy: "asker", agentId: "agt_scout" }, accounts: [TEAM, WORK_SCOUT] }))), "#Scout_Work");
});

test("the cheapest Space account that fits pays; one whose provider does not list the model does not fit; any fits an Automatic turn", () => {
  const dear = row({ ref: "#Dear", uses: { teamChats: { who: "everyone" } }, teamChatsForMe: true, cost: 3, models: ["claude-sonnet-5-5", "glm-5.3"] });
  const cheap = row({ ref: "#Cheap", driver: "opencode_go", uses: { teamChats: { who: "everyone" } }, teamChatsForMe: true, cost: 1, models: ["glm-5.3"] });
  const mia = (model?: string) => resolveAccount(base({ starter: "usr_mia", accounts: [dear, cheap], ...(model ? { model } : {}) }));
  assert.equal(ref(mia("glm-5.3")), "#Cheap", "both serve it: the cheaper");
  assert.equal(ref(mia("claude-sonnet-5-5")), "#Dear", "only one serves it");
  assert.deepEqual(mia("claude-sonnet-5-5").tried[0], { ref: "#Cheap", used: false, why: "no_model" }, "the cheaper one is looked at first and passed over: it does not serve the model");
  assert.equal(ref(mia()), "#Cheap", "Automatic: each runs its default, the cheaper pays");
  // neither serves it: a team chat runs on the cheapest one's default model, marked so the chat can say it (owner, 3 Nov)
  const swapped = mia("gpt-5");
  assert.deepEqual([swapped.accountRef, swapped.modelFallback], ["#Cheap", true]);
  assert.deepEqual(swapped.tried.slice(0, 2).map((t) => t.why), ["no_model", "no_model"]);
});

test("the default-model swap is for team chats, wakes and agent work; goals and automations keep to their model; an account and a model the person pinned together fail with no_model", () => {
  const glm = { ...TEAM, uses: { teamChats: { who: "everyone" as const }, goals: true as const, automations: true as const, agentWork: { which: "all" as const } } };
  const at = (o: Partial<ResolveRequest>) => resolveAccount(base({ starter: "usr_mia", accounts: [glm], model: "claude-sonnet-5-5", ...o }));
  assert.equal(at({}).modelFallback, true);
  assert.equal(at({ trigger: "wake" }).modelFallback, true);
  assert.equal(at({ trigger: "routine", routineOwner: "usr_mia" }).modelFallback, true);
  assert.equal(at({ trigger: "goal" }).allowed, false);
  assert.equal(at({ trigger: "task" }).allowed, false);
  // the chat pinned to the team key and to Claude, together: it does not serve Claude, so the chat fails and says why
  const pinned = at({ threadAccountRef: "#OpenCode_Go_for_everyone", modelPinned: true });
  assert.deepEqual([pinned.allowed, pinned.pin], [false, { ref: "#OpenCode_Go_for_everyone", used: false, why: "no_model" }]);
  // the account pinned without a model of its own choosing: it pays, on its default
  assert.equal(at({ threadAccountRef: "#OpenCode_Go_for_everyone" }).accountRef, "#OpenCode_Go_for_everyone");
});

test("a capped Space account is passed over and the next one pays; capped alone, nothing runs and the Unblock says no account", () => {
  const capped = { ...CREDITS, capped: true, cost: 1 };
  const other = { ...CREDITS, ref: "#Anthropic_More_credits" };
  const r = resolveAccount(base({ trigger: "task", accounts: [capped, other] }));
  assert.equal(ref(r), "#Anthropic_More_credits");
  assert.deepEqual(r.tried[0], { ref: "#Anthropic_Team_credits", used: false, why: "capped" });
  const alone = resolveAccount(base({ trigger: "task", accounts: [capped] }));
  assert.deepEqual([alone.allowed, alone.unblock?.why], [false, "no_account"]);
});

test("a pin is honoured: the step's key, the agent's key and the chat's account pay even where uses would not reach; an unusable pin is passed over with its reason", () => {
  // an automation pinned to the team-chats account (not kept for automations): the pin decides
  const step = resolveAccount(base({ trigger: "task", stepKey: "#OpenCode_Go_for_everyone", accounts: [OWN, TEAM, CREDITS] }));
  assert.deepEqual([step.accountRef, step.reason, step.pin], ["#OpenCode_Go_for_everyone", "step_key", { ref: "#OpenCode_Go_for_everyone", used: true }]);
  // "Runs on: Anthropic API, Team credits" on an agent: its chats run there, not on the asker's own
  const agent = resolveAccount(base({ agent: { accountPolicy: "key", accountKey: "#Anthropic_Team_credits", agentId: "agt_spark" }, accounts: [OWN, TEAM, CREDITS] }));
  assert.deepEqual([agent.accountRef, agent.pin?.used], ["#Anthropic_Team_credits", true]);
  // and in an automation step that names that agent
  assert.equal(ref(resolveAccount(base({ trigger: "task", agent: { accountPolicy: "key", accountKey: "#Anthropic_Team_credits" }, accounts: [OWN, TEAM, CREDITS] }))), "#Anthropic_Team_credits");
  // a capped pin: the turn falls back, and says why
  const capped = resolveAccount(base({ agent: { accountPolicy: "key", accountKey: "#Anthropic_Team_credits" }, accounts: [OWN, TEAM, { ...CREDITS, capped: true }] }));
  assert.deepEqual([capped.accountRef, capped.pin], ["#OpenCode_Go_for_everyone", { ref: "#Anthropic_Team_credits", used: false, why: "capped" }]);
  const gone = resolveAccount(base({ threadAccountRef: "#Removed", accounts: [OWN] }));
  assert.deepEqual([gone.accountRef, gone.pin], ["#Dana_Anthropic", { ref: "#Removed", used: false, why: "unknown" }]);
});

test("the Space AI key from before has every use on: it pays for a chat, an automation, a goal and agent work, as it did", () => {
  const legacy = row({ ref: "#OpenCode_Go_for_everyone", driver: "opencode_go", spaceKey: true });
  for (const trigger of ["message", "wake", "goal", "task", "routine"] as const) assert.equal(ref(resolveAccount(base({ trigger, starter: "usr_mia", routineOwner: "usr_mia", accounts: [legacy] }))), "#OpenCode_Go_for_everyone", trigger);
  // a Mine row that claims uses is never a Space account
  assert.equal(resolveAccount(base({ starter: "usr_mia", accounts: [row({ ref: "#Rob", mine: true, ownerId: "usr_rob", uses: { teamChats: { who: "everyone" } }, teamChatsForMe: true })] })).allowed, false);
});

test("an agent pinned to a key goes down its own ordered fallback list as configured, before Space accounts, and every configured fallback (its list, the Space's backups) carries backup_key so moving on never stops to ask", () => {
  const key = (r: string, cost = 3) => row({ ref: r, cost, uses: { teamChats: { who: "everyone" } }, teamChatsForMe: true, models: ["claude-sonnet-5-5"] });
  const A = key("#A"), B = key("#B", 1), C = key("#C"), D = key("#D"), E = key("#E", 0), F = key("#F", 0);
  const agent = { accountPolicy: "key" as const, agentId: "agt_keeper", accountKey: "#A", accountFallback: ["#C", "#B", "#D"] };
  const at = (unavailable: string[]) => resolveAccount(base({ agent, accounts: [A, B, C, D, E, F], backupRefs: ["#E"], unavailable }));
  assert.equal(ref(at([])), "#A", "the pin");
  for (const [gone, next] of [[["#A"], "#C"], [["#A", "#C"], "#B"], [["#A", "#C", "#B"], "#D"]] as const) {
    const r = at([...gone]);
    assert.deepEqual([r.accountRef, r.reason], [next, "backup_key"], `after ${gone.join(", ")}: the agent's list, in its order (a cheaper Space account does not jump ahead)`);
  }
  const space = at(["#A", "#C", "#B", "#D"]);
  assert.equal(space.accountRef, "#E", "then the cheapest Space account");
  assert.equal(space.reason, "backup_key", "#E is also one of the Space's backups: it keeps that reason");
  const last = at(["#A", "#C", "#B", "#D", "#E"]);
  assert.equal(last.accountRef, "#F");
  assert.notEqual(last.reason, "backup_key", "a Space account nobody listed as a fallback is not one");
});

test("an agent's AI account pick pays for its own work (routines, watchers, helpers) and only where the Space kept that account for this agent; a chat stays on the asker's own account", () => {
  const accounts = [OWN, WORK_ALL, WORK_SCOUT, CREDITS];
  const scout = { accountPolicy: "asker" as const, agentId: "agt_scout", workKey: "#Scout_Work" };
  // the pick pays, even though a cheaper account that covers the work exists
  const cheap = row({ ref: "#Cheap_Work", cost: 1, uses: { agentWork: { which: "all" } }, models: ["claude-sonnet-5-5"] });
  const picked = resolveAccount(base({ trigger: "routine", agent: { ...scout, workKey: "#Agent_Work" }, accounts: [OWN, cheap, WORK_ALL] }));
  assert.deepEqual([picked.accountRef, picked.pin], ["#Agent_Work", { ref: "#Agent_Work", used: true }]);
  // Automatic (no pick) is the cheapest that covers it
  assert.equal(ref(resolveAccount(base({ trigger: "routine", agent: { accountPolicy: "asker", agentId: "agt_scout" }, accounts: [OWN, cheap, WORK_ALL] }))), "#Cheap_Work");
  // the same pick in a chat does nothing: the asker's own account answers
  assert.equal(ref(resolveAccount(base({ trigger: "message", agent: scout, accounts }))), "#Dana_Anthropic");
  // an account kept for another agent's work is passed over with its reason, and the work falls to the account that does cover it
  const other = resolveAccount(base({ trigger: "routine", agent: { accountPolicy: "asker", agentId: "agt_spark", workKey: "#Scout_Work" }, accounts: [OWN, WORK_SCOUT, WORK_ALL] }));
  assert.deepEqual([other.accountRef, other.pin], ["#Agent_Work", { ref: "#Scout_Work", used: false, why: "not_used_for" }]);
  // an account kept for automations only is not for agent work
  const wrong = resolveAccount(base({ trigger: "routine", agent: { ...scout, workKey: "#Anthropic_Team_credits" }, accounts: [OWN, CREDITS, WORK_ALL] }));
  assert.deepEqual([wrong.accountRef, wrong.pin?.why], ["#Agent_Work", "not_used_for"]);
  // a capped pick is passed over with its reason
  const capped = resolveAccount(base({ trigger: "routine", agent: { ...scout, workKey: "#Agent_Work" }, accounts: [{ ...WORK_ALL, capped: true }, WORK_SCOUT] }));
  assert.deepEqual([capped.accountRef, capped.pin], ["#Scout_Work", { ref: "#Agent_Work", used: false, why: "capped" }]);
  // nothing else could pay: the run waits and says no account
  assert.equal(resolveAccount(base({ trigger: "routine", agent: { accountPolicy: "asker", agentId: "agt_spark", workKey: "#Scout_Work" }, accounts: [WORK_SCOUT] })).allowed, false);
});

test("an automation's AI account and backup pay only when kept for automations; Automatic is the cheapest that is; a step's own key keeps the old rule", () => {
  const OC = row({ ref: "#OpenCode_Go_for_everyone", cost: 1, uses: { teamChats: { who: "everyone" } }, models: ["glm-5.3"] });
  const AUTO_B = row({ ref: "#Backup_Credits", cost: 4, uses: { automations: true }, models: ["claude-sonnet-5-5"] });
  const run = (o: Partial<ResolveRequest>) => resolveAccount(base({ trigger: "task", accounts: [CREDITS, AUTO_B, OC], ...o }));
  assert.equal(ref(run({})), "#Anthropic_Team_credits", "Automatic: the cheapest kept for automations");
  const picked = run({ stepKey: "#Backup_Credits", useChecked: ["#Backup_Credits"] });
  assert.deepEqual([picked.accountRef, picked.pin], ["#Backup_Credits", { ref: "#Backup_Credits", used: true }]);
  // the pick is kept for team chats only: passed over with its reason, and Automatic takes the step
  const notFor = run({ stepKey: "#OpenCode_Go_for_everyone", useChecked: ["#OpenCode_Go_for_everyone"] });
  assert.deepEqual([notFor.accountRef, notFor.pin], ["#Anthropic_Team_credits", { ref: "#OpenCode_Go_for_everyone", used: false, why: "not_used_for" }]);
  // a capped main hands the step to the backup first
  const cap = run({ stepKey: "#Anthropic_Team_credits", backupRefs: ["#Backup_Credits"], useChecked: ["#Anthropic_Team_credits", "#Backup_Credits"], accounts: [{ ...CREDITS, capped: true }, AUTO_B] });
  assert.deepEqual([cap.accountRef, cap.pin], ["#Backup_Credits", { ref: "#Anthropic_Team_credits", used: false, why: "capped" }]);
  // a backup that is not kept for automations does not pay either
  assert.equal(run({ stepKey: "#Anthropic_Team_credits", backupRefs: ["#OpenCode_Go_for_everyone"], useChecked: ["#Anthropic_Team_credits", "#OpenCode_Go_for_everyone"], accounts: [{ ...CREDITS, capped: true }, OC] }).allowed, false);
  // a key named on the step itself keeps the old rule: the pin decides
  assert.equal(ref(run({ stepKey: "#OpenCode_Go_for_everyone" })), "#OpenCode_Go_for_everyone");
});
