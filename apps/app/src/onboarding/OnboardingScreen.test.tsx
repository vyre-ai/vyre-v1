import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import { stepsOf } from "./flow.ts";

const noop = (): void => undefined;
const html = (props: Partial<Parameters<typeof OnboardingScreen>[0]> = {}): string => renderToStaticMarkup(<OnboardingScreen flow="personal" spaceName="Personal" progress={{}} onStep={noop} device="mac" {...props} />);

test("the screen has a rail, a chat and a preview, and opens on the first open step", () => {
  const out = html();
  for (const id of ["onboarding", "onboarding-rail", "onboarding-chat", "onboarding-preview", "onboarding-card", "step-later"]) assert.ok(out.includes(`data-testid="${id}"`), id);
  for (const st of stepsOf("personal")) assert.ok(out.includes(`data-testid="row-step-${st.key}"`), st.key);
  assert.ok(out.includes("Connect your AI"));
  assert.ok(out.includes(">Step 1 of 8<"), "the counter names the step on show");
});

test("the Assistant says one short sentence per step, and never claims to be live without an AI account", () => {
  const out = html({ stepKey: "interview" });
  assert.ok(out.includes("Three quick ones.") && out.includes('data-testid="assistant-said"'));
  assert.equal((out.match(/data-testid="line-/g) ?? []).length, 1, "one line, not three boxes");
  assert.ok(!out.includes("scripted-note") && !out.includes("Connect an AI account to talk to me"));
});

test("done steps tick, skipped steps say Skipped, and a finished flow shows the summary with Open Vyre", () => {
  const out = html({ progress: { ai: "done", interview: "later" }, stepKey: "sessions" });
  assert.ok(out.includes('data-testid="mark-done"') && out.includes('data-testid="mark-later"') && out.includes(">Skipped<"));
  const all = Object.fromEntries(stepsOf("member").map((st) => [st.key, "done" as const]));
  const end = renderToStaticMarkup(<OnboardingScreen flow="member" spaceName="Acme" progress={all} onStep={noop} onClose={noop} device="mac" />);
  assert.ok(end.includes("You are set up") && end.includes("All done") && end.includes("Open Vyre") && !end.includes("Home") && end.includes('data-testid="onboarding-finished"'));
  const some = renderToStaticMarkup(<OnboardingScreen flow="member" spaceName="Acme" progress={{ ...all, apps: "later" }} stepKey="summary" onStep={noop} onClose={noop} device="mac" />);
  assert.ok(some.includes('data-testid="onboarding-finished"') && some.includes('data-testid="done-set-apps"') && some.includes("1 left for later") && some.includes(">Skipped<"), "the summary names what was put off, with Set up");
  assert.ok(!some.includes('data-testid="done-set-mine"'), "a done step has no Set up");
});

test("the steps follow the device: a browser has no sessions or folders, a phone also no Chrome and its own step is done", () => {
  const web = html({ device: "web" });
  assert.ok(!web.includes('row-step-sessions') && !web.includes('row-step-folders') && web.includes("row-step-chrome"));
  const phone = html({ device: "phone" });
  assert.ok(!phone.includes("row-step-chrome") && !phone.includes('data-testid="onboarding-rail"'), "one column, no rail");
  assert.ok(phone.includes(">Step 1 of 5<"), "five steps on a phone, and the first is on show");
});

test("a member and a Team owner get their own steps", () => {
  assert.ok(html({ flow: "member", spaceName: "Acme" }).includes("Your mail, calendar, files"));
  const team = html({ flow: "team", spaceName: "Acme" });
  assert.ok(team.includes("Your organisation") && team.includes("Name your Space."));
});

test("a card from the host replaces the placeholder", () => {
  assert.ok(html({ renderCard: (c) => <span data-card={c}>real card</span> }).includes('data-card="connect_ai"'));
});

test("the Connect AI card shows three subscription tiles and a secure key field", async () => {
  const { ConnectAiCard } = await import("./ConnectAiCard.tsx");
  const out = renderToStaticMarkup(<ConnectAiCard call={(async () => ({})) as never} onConnected={noop} />);
  for (const id of ["ai-sub-claude-code", "ai-sub-codex", "ai-sub-grok", "ai-use-key"]) assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.ok(renderToStaticMarkup(<ConnectAiCard call={(async () => ({})) as never} connected onConnected={noop} />).includes("ai-connected"));
});

test("the host keeps the shell mounted and shows nothing extra before the session opens", async () => {
  const { OnboardingHost } = await import("./OnboardingHost.tsx");
  const out = renderToStaticMarkup(<OnboardingHost call={null} space={{ kind: "personal", name: "Personal" }}><span data-shell="1">shell</span></OnboardingHost>);
  assert.ok(out.includes('data-shell="1"') && !out.includes('data-testid="onboarding"'));
});

test("first launch shows the three doors and a way in for people who already have a Space", async () => {
  const { FirstLaunch } = await import("./FirstLaunch.tsx");
  const out = renderToStaticMarkup(<FirstLaunch onDoor={async () => undefined} existing={<span>sign in</span>} />);
  for (const id of ["door-me", "door-invited", "door-team", "door-existing"]) assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.ok(out.includes("Just me") && out.includes("I was invited") && out.includes("My team") && out.includes("Welcome to Vyre") && out.includes(">Sign in<"));
});

test("a browser offers two doors and no Just me, a phone offers to join or to email the app, a PC offers all three (journeys, table D)", async () => {
  const { FirstLaunch } = await import("./FirstLaunch.tsx");
  const at = (device: "mac" | "win" | "web" | "phone") => renderToStaticMarkup(<FirstLaunch device={device} onDoor={async () => undefined} existing={<span>sign in</span>} />);
  const web = at("web");
  assert.ok(web.includes('data-testid="door-invited"') && web.includes('data-testid="door-server"') && !web.includes('data-testid="door-me"') && web.includes("Set up a team server"));
  const phone = at("phone");
  assert.ok(phone.includes('data-testid="door-invited"') && phone.includes('data-testid="door-app"') && !phone.includes('data-testid="door-me"') && !phone.includes('data-testid="door-team"'));
  const win = at("win");
  for (const id of ["door-me", "door-invited", "door-team"]) assert.ok(win.includes(`data-testid="${id}"`), id);
});

test("the team bridge card warns about a sleeping Mac in plain words, only on a Mac", async () => {
  const { TeamBridgeCard, MAC_WARNING } = await import("./TeamBridgeCard.tsx");
  assert.equal(MAC_WARNING, "This Mac must be on and Vyre open for your team to connect. For always-on, install on a server.");
  assert.ok(renderToStaticMarkup(<TeamBridgeCard mac onCreate={noop} />).includes("mac-warning"));
  assert.ok(!renderToStaticMarkup(<TeamBridgeCard mac={false} onCreate={noop} />).includes("mac-warning"));
});

test("the phone card makes a one-time link on the Space address and the open cards point at real places", async () => {
  const { makePairLink } = await import("./PairPhoneCard.tsx");
  const { OPEN_TARGETS } = await import("./OpenCard.tsx");
  const { pairFromUrl, pairLink } = await import("../shell/session/desktop.ts");
  const calls: unknown[] = [];
  const made = await makePairLink((async (cap: string, input: unknown) => { calls.push([cap, input]); return { code: "AB12-CD34", expiresAt: 5 }; }) as never, "https://team.example/", "k");
  assert.equal(made.link, "https://team.example/chat?pair=AB12-CD34");
  assert.deepEqual(calls, [["identity.pair_create", { purpose: "phone", idempotencyKey: "k" }]]);
  assert.deepEqual(pairFromUrl(made.link, "https://team.example"), { kind: "pair", address: "https://team.example", code: "AB12-CD34", phone: true });
  assert.equal(pairFromUrl("https://team.example/chat?pair=<script>", "https://team.example"), null);
  assert.equal(pairFromUrl("https://team.example/home", "https://team.example"), null);
  assert.equal(pairLink("https://a.example", "x y"), "https://a.example/chat?pair=x%20y");
  for (const k of ["import_sessions", "local_folders", "chrome", "first_win"]) assert.ok(OPEN_TARGETS[k], k);
});

test("the same-account offer asks first, names the account, and shows nothing when there is no key to copy", async () => {
  const { SameAccountOffer } = await import("./SameAccountOffer.tsx");
  const none = (async () => ({})) as never;
  const acct = [{ providerId: "prv_1", providerKey: "anthropic", name: "Anthropic", itemId: "itm_1" }];
  const out = renderToStaticMarkup(<SameAccountOffer personal={none} team={none} accounts={acct} onCopied={noop} />);
  assert.ok(out.includes("Use the same AI account here?") && out.includes("Anthropic") && out.includes('data-testid="same-account-yes"') && out.includes('data-testid="same-account-no"'));
  assert.equal(renderToStaticMarkup(<SameAccountOffer personal={none} team={none} accounts={[]} onCopied={noop} />), "");
});

test("the Home checklist shows one row per step with its state, from what the host published", async () => {
  const { setupRows } = await import("./SetupRows.tsx");
  const { publishProgress, readProgress, watchProgress } = await import("./store.ts");
  const rows = setupRows("personal", { ai: "done", sessions: "later" });
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.key, r.state]), [["ai", "done"], ["interview", "open"], ["sessions", "later"]]);
  let heard = 0;
  const off = watchProgress(() => { heard++; });
  publishProgress({ flow: "member", progress: { mine: "done" } });
  assert.deepEqual(readProgress(), { flow: "member", progress: { mine: "done" } });
  off();
  publishProgress(null);
  assert.equal(heard, 1);
});

test("the suite cards draw their first frame with the buttons the owner needs", async () => {
  const { WorkspaceCard, SignInDomainCard, DirectoryCard, InvitesCard } = await import("./SuiteCards.tsx");
  const call = (async () => ({})) as never;
  const w = renderToStaticMarkup(<WorkspaceCard call={call} onOpenConsole={noop} onDone={noop} />);
  assert.ok(w.includes('data-testid="workspace-open"') && w.includes("Open the setup in the Console"));
  assert.ok(renderToStaticMarkup(<SignInDomainCard call={call} onOpenConsole={noop} onDone={noop} />).includes('data-testid="signin-open"'));
  assert.ok(renderToStaticMarkup(<DirectoryCard call={call} by="Dana" space="Northwind" onOpenConsole={noop} onDone={noop} />).includes('data-testid="directory-open"'));
  const inv = renderToStaticMarkup(<InvitesCard call={call} onDone={noop} />);
  assert.ok(inv.includes('data-testid="invite-make"') && inv.includes("Nothing is sent until you share it or approve it."));
});

test("with an AI account the Assistant chat sits under the card on a step with something to ask, keeps the bar, and is hidden where it adds nothing", async () => {
  const { findAssistant } = await import("./AssistantThread.tsx");
  const out = renderToStaticMarkup(<OnboardingScreen flow="personal" spaceName="Personal" progress={{}} stepKey="folders" device="mac" live liveChat={<span data-thread="1">thread</span>} onStep={noop} onClose={noop} renderCard={() => <span data-card="1">card</span>} />);
  assert.ok(out.includes('data-testid="onboarding-live"') && out.includes('data-thread="1"') && !out.includes("scripted-note") && !out.includes("line-hello"));
  assert.ok(out.indexOf('data-card="1"') < out.indexOf('data-thread="1"'));
  for (const id of ["step-back", "step-later", "step-next", "onboarding-close"]) assert.ok(out.includes(`data-testid="${id}"`), `live, the bar keeps ${id}`);
  for (const key of ["ai", "interview", "phone"]) {
    const quiet = renderToStaticMarkup(<OnboardingScreen flow="personal" spaceName="Personal" progress={{}} stepKey={key} device="mac" live liveChat={<span data-thread="1">thread</span>} onStep={noop} renderCard={() => <span data-card="1">card</span>} />);
    assert.ok(!quiet.includes('data-testid="onboarding-live"') && quiet.includes('data-testid="step-next"'), `${key}: the card says it all, so no chat`);
  }
  const drawn: string[] = [];
  renderToStaticMarkup(<OnboardingScreen flow="personal" spaceName="Personal" progress={{}} stepKey="sessions" device="mac" live renderLive={(st, ask) => { drawn.push(`${st.key}:${ask.prompt}`); return <span>t</span>; }} onStep={noop} />);
  assert.deepEqual(drawn, ["sessions:Ask me which sessions to bring in."], "the host draws the chat for the step on show, with its own prompt");
  const rt = { call: async () => ({ agents: [{ agentId: "agt_other", ownerId: "usr_b", role: "assistant" }, { agentId: "agt_mine", ownerId: "usr_a", role: "assistant" }] }) };
  assert.equal(await findAssistant(rt as never, "usr_a"), "agt_mine");
  assert.equal(await findAssistant(rt as never, "usr_zzz"), null);
});

test("the bottom bar is Back (from the second step), Skip for now, Continue (disabled until there is something to do, Done on the last step), and Finish later in the rail", () => {
  const out = html({ stepKey: "ai", onClose: noop });
  assert.ok(out.includes(">Skip for now<") && out.includes('data-testid="step-next"') && out.includes(">Continue<") && out.includes("Finish later"));
  assert.ok(!out.includes('data-testid="step-back"'), "the first step has nothing to go back to");
  assert.ok(html({ stepKey: "interview", onClose: noop }).includes('data-testid="step-back"'));
  assert.ok(/aria-disabled="true"|disabled=""/.test(out), "not done: Continue is disabled");
  const done = html({ stepKey: "ai", progress: { ai: "done" }, onClose: noop });
  assert.ok(!/aria-disabled="true"|disabled=""/.test(done), "done: nothing is disabled");
  assert.ok(!done.includes(">Skip for now<"), "a done step has nothing to skip; Continue moves on");
  assert.ok(html({ stepKey: "team", onClose: noop }).includes(">Done<"), "the last step says Done");
  assert.ok(!/>Skip</.test(out) && !out.includes("Ask pane") && !out.includes("Say something to start"), "no bare Skip and no placeholder labels");
});

test("the preview pane shows chips, or Not yet with its hint, and draws nothing when it has nothing to say", async () => {
  const { PreviewView } = await import("./PreviewPane.tsx");
  const full = renderToStaticMarkup(<PreviewView preview={{ heading: "Your AI account", items: [{ id: "1", label: "Claude · subscription · in your Vault" }], hint: "x" }} fallback="f" />);
  assert.ok(full.includes('data-testid="preview-item"') && full.includes("in your Vault"));
  const empty = renderToStaticMarkup(<PreviewView preview={{ heading: "h", items: [], hint: "Not yet. Something appears here." }} fallback="f" />);
  assert.ok(empty.includes('data-testid="preview-empty"') && empty.includes("Not yet."));
  assert.equal(renderToStaticMarkup(<PreviewView preview={{ heading: "Your folders", items: [], hint: "" }} fallback="" />), "", "no folder yet: no frame at all");
  const folders = renderToStaticMarkup(<PreviewView preview={{ heading: "Your folders", items: [{ id: "m", label: "Vyre", note: "~/Claude/Orgs/Vyre" }], hint: "" }} fallback="" />);
  assert.ok(folders.includes(">Vyre<") && folders.includes("~/Claude/Orgs/Vyre") && !folders.includes(">local<"));
});

test("Team AI offers a key for everyone first and your own account as a separate, labelled choice, with no trip to the Console", async () => {
  const { SpaceAiCard } = await import("./SpaceAiCard.tsx");
  const call = (async () => ({ providers: [] })) as never;
  const first = renderToStaticMarkup(<SpaceAiCard team={call} personal={null} onConnected={noop} />);
  assert.ok(first.includes('data-testid="space-ai-key"') && first.includes("A key for everyone") && first.includes("Your own account") && !first.includes("Open it") && !first.includes("Console"));
  const mine = renderToStaticMarkup(<SpaceAiCard team={call} personal={null} onConnected={noop} initial="mine" />);
  assert.ok(mine.includes('data-testid="ai-tiles"') && mine.includes("Claude, ChatGPT or Grok subscription"), "no Personal key to copy: the sign-ins are the choice");
});

function GatedCard({ card, gate, ran }: { card: string; gate(save: (() => Promise<boolean>) | null, label?: string): void; ran: string[] }): ReactElement {
  useEffect(() => { gate(async () => { ran.push(card); return true; }, "Save"); return () => gate(null); }, [gate, card, ran]);
  return <Text testID={`card-${card}`}>{card}</Text>;
}

test("with every step done, any step in the rail reopens and shows its card; Continue on a reopened step runs the card's own action first", async () => {
  const { act } = await import("react");
  const { createRoot } = await import("test-renderer");
  const { find, flush, installDom, press } = await import("./test-dom.ts");
  installDom();
  const done = Object.fromEntries(stepsOf("personal").map((x) => [x.key, "done" as const]));
  const ran: string[] = [];
  const opened: string[] = [];
  const r = createRoot();
  const Host = (): ReactElement => {
    const [step, setStep] = useState("ai");
    return <OnboardingScreen flow="personal" spaceName="Maya" progress={done} stepKey={step} device="mac" onStep={() => undefined} onOpenStep={(k) => { opened.push(k); setStep(k); }} onClose={() => undefined} renderCard={(card, ctx) => <GatedCard card={card} gate={ctx.gate} ran={ran} />} />;
  };
  await act(async () => { r.render(<Host />); });
  await flush();
  const root = r.container as never;
  assert.ok(find(root, "card-connect_ai"), "the first step opens with its card though it is done");
  await press(find(root, "row-step-interview")); await flush();
  assert.ok(find(root, "card-interview"), "clicking any step in the rail opens it");
  await press(find(root, "step-back")); await flush();
  assert.ok(find(root, "card-connect_ai"), "Back goes to the step before, whatever its state");
  await press(find(root, "step-next")); await flush();
  assert.deepEqual(ran, ["connect_ai"], "Continue on a done step ran the card's action before moving on");
  assert.ok(find(root, "card-interview"), "then it moved on");
});
