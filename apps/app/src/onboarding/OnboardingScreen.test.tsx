import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import { stepsOf } from "./flow.ts";

const noop = (): void => undefined;
const html = (props: Partial<Parameters<typeof OnboardingScreen>[0]> = {}): string => renderToStaticMarkup(<OnboardingScreen flow="personal" spaceName="Personal" progress={{}} onStep={noop} {...props} />);

test("the screen has a rail, a chat and a preview, and opens on the first open step", () => {
  const out = html();
  for (const id of ["onboarding", "onboarding-rail", "onboarding-chat", "onboarding-preview", "onboarding-card", "step-later"]) assert.ok(out.includes(`data-testid="${id}"`), id);
  for (const st of stepsOf("personal")) assert.ok(out.includes(`data-testid="step-${st.key}"`), st.key);
  assert.ok(out.includes("Connect your AI"));
  assert.ok(out.includes("Set up  0 of 8") || out.includes("Set up&nbsp;&nbsp;0 of 8") || /Set up\s+0 of 8/.test(out));
});

test("the scripted Assistant says so and never claims to be live without an AI account", () => {
  assert.ok(html({ stepKey: "interview" }).includes("Connect an AI account to talk to me"));
  assert.ok(!html({ stepKey: "interview", live: true, lines: [] }).includes("scripted-note"));
});

test("done steps tick, put-off steps say Later, and a finished flow says all set", () => {
  const out = html({ progress: { ai: "done", interview: "later" }, stepKey: "sessions" });
  assert.ok(out.includes('data-testid="mark-done"') && out.includes('data-testid="mark-later"') && out.includes(">Later<"));
  const all = Object.fromEntries(stepsOf("member").map((st) => [st.key, "done" as const]));
  assert.ok(renderToStaticMarkup(<OnboardingScreen flow="member" spaceName="Acme" progress={all} onStep={noop} onClose={noop} />).includes("You are all set."));
});

test("a member and a Team owner get their own steps and greeting", () => {
  assert.ok(html({ flow: "member", spaceName: "Acme" }).includes("Your mail, calendar, files"));
  const team = html({ flow: "team", spaceName: "Acme" });
  assert.ok(team.includes("Your organisation") && team.includes("You own it"));
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
  assert.ok(out.includes("Just me") && out.includes("I was invited") && out.includes("Set up my team"));
});

test("the team bridge card warns about a sleeping Mac in plain words, only on a Mac", async () => {
  const { TeamBridgeCard, MAC_WARNING } = await import("./TeamBridgeCard.tsx");
  assert.equal(MAC_WARNING, "This Mac must be on and Vyre open for your team to connect. For always-on, install on a server.");
  assert.ok(renderToStaticMarkup(<TeamBridgeCard mac onCreate={noop} />).includes("mac-warning"));
  assert.ok(!renderToStaticMarkup(<TeamBridgeCard mac={false} onCreate={noop} />).includes("mac-warning"));
});
