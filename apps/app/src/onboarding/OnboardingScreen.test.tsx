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
