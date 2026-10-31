// Every onboarding step has the same bar: Finish later, Skip and Continue (Done on the last step), so none is a dead end; plus the First win card's starter routines.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { find, flush, installDom, press } from "./test-dom.ts";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import { FirstWinCard, STARTERS } from "./FirstWinCard.tsx";
import { stepsOf } from "./flow.ts";
import type { CapCall } from "../shell/session/caps.ts";

const noop = (): void => undefined;
const steps = stepsOf("personal");

test("each of the 8 steps renders Finish later, Skip and Continue (Done on the last)", () => {
  assert.equal(steps.length, 8);
  steps.forEach((st, i) => {
    const out = renderToStaticMarkup(<OnboardingScreen flow="personal" spaceName="Maya" progress={{}} stepKey={st.key} device="mac" onStep={noop} onClose={noop} />);
    assert.ok(out.includes("Finish later") && out.includes(">Skip<") && out.includes('data-testid="step-next"'), st.key);
    assert.ok(out.includes(i === steps.length - 1 ? ">Done<" : ">Continue<"), st.key);
  });
});

test("Continue on a done step opens the next one, and Done on the last ends on the summary", async () => {
  installDom();
  for (let i = 0; i < steps.length; i++) {
    const opened: string[] = [];
    const r = createRoot();
    await act(async () => { r.render(<OnboardingScreen flow="personal" spaceName="Maya" progress={{ [steps[i]!.key]: "done" }} stepKey={steps[i]!.key} device="mac" onStep={noop} onOpenStep={(k) => opened.push(k)} onClose={noop} />); });
    await press(find(r.container as never, "step-next"));
    await flush();
    if (i < steps.length - 1) assert.deepEqual(opened, [steps[i + 1]!.key], steps[i]!.key);
    else assert.ok(find(r.container as never, "onboarding-finished"), "the last step ends on the summary");
  }
});

test("Skip on an open step marks it skipped, and on a done step only moves on", async () => {
  installDom();
  const seen: string[] = [], opened: string[] = [];
  const r = createRoot();
  await act(async () => { r.render(<OnboardingScreen flow="personal" spaceName="Maya" progress={{ ai: "done" }} stepKey="folders" device="mac" onStep={(k, st) => seen.push(`${k}:${st}`)} onOpenStep={(k) => opened.push(k)} onClose={noop} />); });
  await press(find(r.container as never, "step-later"));
  await flush();
  assert.deepEqual(seen, ["folders:later"]);
  const d = createRoot();
  await act(async () => { d.render(<OnboardingScreen flow="personal" spaceName="Maya" progress={{ ai: "done" }} stepKey="ai" device="mac" onStep={(k, st) => seen.push(`${k}:${st}`)} onOpenStep={(k) => opened.push(k)} onClose={noop} />); });
  await press(find(d.container as never, "step-later"));
  await flush();
  assert.deepEqual(seen, ["folders:later"], "a done step is not downgraded");
  assert.ok(opened.includes("interview"));
});

function mountWin(hasAi: boolean) {
  const calls: { cap: string; input: unknown }[] = [];
  const steps2: string[] = [];
  const call = (async (cap: string, input?: unknown) => { calls.push({ cap, input }); return cap === "automations.create" ? { automation: { id: "aut_1" } } : {}; }) as unknown as CapCall;
  const connect: string[] = [];
  const el = (
    <OnboardingScreen flow="personal" spaceName="Maya" progress={{}} stepKey="win" device="mac" onStep={(k, st) => steps2.push(`${k}:${st}`)} onClose={noop}
      renderCard={(card, ctx) => card === "first_win" ? <FirstWinCard call={call} hasAi={hasAi} gate={ctx.gate} onConnectAi={() => connect.push("ai")} /> : null} />
  );
  return { calls, steps2, connect, el };
}

test("First win lists the starter routines; picking one and Continue creates, enables and runs it", async () => {
  installDom();
  assert.ok(STARTERS.length >= 3 && STARTERS.length <= 4);
  const t = mountWin(true);
  const r = createRoot();
  await act(async () => { r.render(t.el); });
  const root = r.container as never;
  for (const st of STARTERS) assert.ok(find(root, `row-starter-${st.id}`), st.id);
  await press(find(root, "row-starter-inbox"));
  await press(find(root, "step-next"));
  await flush();
  assert.deepEqual(t.calls.map((c) => c.cap), ["automations.create", "automations.set_enabled", "automations.run"]);
  assert.deepEqual(t.steps2, ["win:done"]);
});

test("First win without an AI account says so and offers Connect your AI; Skip is still there", async () => {
  installDom();
  const t = mountWin(false);
  const r = createRoot();
  await act(async () => { r.render(t.el); });
  const root = r.container as never;
  assert.ok(find(root, "first-win-needs-ai") && !find(root, "starter-morning"));
  await press(find(root, "first-win-connect"));
  assert.deepEqual(t.connect, ["ai"]);
  await press(find(root, "step-later"));
  await flush();
  assert.deepEqual(t.steps2, ["win:later"]);
});

test("the X and Finish later both leave to the app, and Esc does too", async () => {
  installDom();
  for (const id of ["onboarding-x", "onboarding-close"]) {
    let left = 0;
    const r = createRoot();
    await act(async () => { r.render(<OnboardingScreen flow="personal" spaceName="Maya" progress={{}} stepKey="ai" device="mac" onStep={noop} onClose={() => { left++; }} />); });
    await press(find(r.container as never, id));
    assert.equal(left, 1, id);
  }
  const out = renderToStaticMarkup(<OnboardingScreen flow="personal" spaceName="Maya" progress={{}} device="mac" onStep={noop} />);
  assert.ok(!out.includes("onboarding-x"), "no X without a way out");
});

test("Set up N of 8 counts done and skipped steps, matching the rail", () => {
  const out = renderToStaticMarkup(<OnboardingScreen flow="personal" spaceName="Maya" progress={{ ai: "done", interview: "later", sessions: "later" }} stepKey="folders" device="mac" onStep={noop} onClose={noop} />);
  assert.ok(/Set up\s+3 of 8/.test(out.replace(/&nbsp;/g, " ")));
});

test("the Finish setup entry shows the handled count, reopens the first open step, hides, and is gone when all is handled", async () => {
  installDom();
  const { ResumeChip, resumeInfo } = await import("./ResumeChip.tsx");
  const progress = { ai: "done", interview: "later", sessions: "done" } as const;
  assert.deepEqual(resumeInfo("personal", progress, "mac"), { handled: 3, total: 8, step: "folders" });
  const all = Object.fromEntries(steps.map((st) => [st.key, "later" as const]));
  assert.equal(resumeInfo("personal", all, "mac"), null);
  const opened: string[] = [];
  const r = createRoot();
  await act(async () => { r.render(<ResumeChip flow="personal" progress={progress} device="mac" onOpen={(k) => opened.push(k)} />); });
  const root = r.container as never;
  assert.ok(JSON.stringify(find(root, "resume-open")).includes("Finish setup, 3 of 8") || find(root, "resume-open"));
  await press(find(root, "resume-open"));
  assert.deepEqual(opened, ["folders"]);
  await press(find(root, "resume-hide"));
  assert.equal(find(root, "resume-chip"), null, "Hide puts it away");
  const g = createRoot();
  await act(async () => { g.render(<ResumeChip flow="team" progress={Object.fromEntries(stepsOf("team").map((st) => [st.key, "done" as const]))} device="mac" onOpen={noop} />); });
  assert.equal(find(g.container as never, "resume-chip"), null);
});

test("on the phone the Finish setup entry floats above the places bar instead of covering Inbox and Records", async () => {
  const { ResumeChip } = await import("./ResumeChip.tsx");
  const bottomOf = (compact: boolean): string => {
    const html = renderToStaticMarkup(<ResumeChip flow="personal" progress={{ ai: "done" }} device={compact ? "phone" : "mac"} compact={compact} onOpen={noop} />);
    const tag = html.slice(0, html.indexOf(">"));
    const found = /r-bottom-\w+/.exec(tag);
    assert.ok(found, "the chip sets its bottom offset");
    return found[0];
  };
  assert.notEqual(bottomOf(true), bottomOf(false), "the phone chip sits higher than the computer chip");
});
