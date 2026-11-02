// The bar on every step of every flow: Continue moves on from a done step (Done ends on the summary), Skip for now marks the step skipped and moves on, Back opens the step before
// without marking anything, and Escape leaves with progress kept, the same on every step, unless a menu or popup took it. The counter follows the step on show; a skipped step says
// Skipped in the step list and stays one press away there and on the first Chats screen.
import test from "node:test";
import assert from "node:assert/strict";
import { act, useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf } from "./test-dom.ts";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import { stepsOf } from "./flow.ts";
import type { FlowKind, Progress, StepState } from "./flow.ts";
import { setupNote, setupRows, setupTop } from "./setup-rows.ts";

const FLOWS: FlowKind[] = ["personal", "team", "member"];

interface Seen { marks: string[]; opened: string[]; left: number }

/** The screen as the host holds it: the step on show and the progress follow what the person does. */
function Host({ flow, start, progress0 }: { flow: FlowKind; start: string; progress0: Progress }): ReactElement {
  const [step, setStep] = useState<string>(start);
  const [progress, setProgress] = useState<Progress>(progress0);
  return <OnboardingScreen flow={flow} spaceName="Acme" progress={progress} stepKey={step} device="mac" onStep={(k, st) => setProgress((p) => ({ ...p, [k]: st }))} onOpenStep={setStep} onClose={() => undefined} />;
}
async function hosted(flow: FlowKind, start: string, progress0: Progress = {}): Promise<never> {
  const r = createRoot();
  await act(async () => { r.render(<Host flow={flow} start={start} progress0={progress0} />); });
  return r.container as never;
}
async function mount(flow: FlowKind, stepKey: string, progress: Progress = {}): Promise<{ root: never; seen: Seen }> {
  const seen: Seen = { marks: [], opened: [], left: 0 };
  const r = createRoot();
  await act(async () => {
    r.render(<OnboardingScreen flow={flow} spaceName="Acme" progress={progress} stepKey={stepKey} device="mac" onStep={(k: string, st: StepState) => seen.marks.push(`${k}:${st}`)} onOpenStep={(k) => seen.opened.push(k)} onClose={() => { seen.left++; }} />);
  });
  return { root: r.container as never, seen };
}

test("Continue on a done step opens the next one in every flow, and Done on the last step ends on the summary", async () => {
  installDom();
  for (const flow of FLOWS) {
    const steps = stepsOf(flow);
    for (let i = 0; i < steps.length; i++) {
      const key = steps[i]!.key;
      const { root, seen } = await mount(flow, key, { [key]: "done" });
      await press(find(root, "step-next"));
      await flush();
      if (i < steps.length - 1) assert.deepEqual(seen.opened, [steps[i + 1]!.key], `${flow}/${key}`);
      else assert.ok(find(root, "onboarding-finished"), `${flow}: the last step ends on the summary`);
      assert.deepEqual(seen.marks, [], `${flow}/${key}: Continue on a done step marks nothing`);
    }
  }
});

test("Skip for now on every step of every flow marks it skipped and moves on; the last step ends on the summary", async () => {
  installDom();
  for (const flow of FLOWS) {
    const steps = stepsOf(flow);
    for (let i = 0; i < steps.length; i++) {
      const key = steps[i]!.key;
      const { root, seen } = await mount(flow, key);
      assert.ok(textOf(find(root, "step-later")).includes("Skip for now"), `${flow}/${key}`);
      assert.ok(textOf(find(root, "step-why")).trim().length > 0, `${flow}/${key}: a Continue that waits says why`);
      await press(find(root, "step-later"));
      await flush();
      assert.deepEqual(seen.marks, [`${key}:later`], `${flow}/${key}`);
      if (i < steps.length - 1) assert.deepEqual(seen.opened, [steps[i + 1]!.key], `${flow}/${key} moves on`);
      else assert.ok(find(root, "onboarding-finished"), `${flow}/${key} ends on the summary`);
    }
  }
});

test("Back on every step after the first opens the one before and marks nothing", async () => {
  installDom();
  for (const flow of FLOWS) {
    const steps = stepsOf(flow);
    const first = await mount(flow, steps[0]!.key);
    assert.equal(find(first.root, "step-back"), null, `${flow}: no Back on the first step`);
    for (let i = 1; i < steps.length; i++) {
      const { root, seen } = await mount(flow, steps[i]!.key, { [steps[i - 1]!.key]: "done" });
      await press(find(root, "step-back"));
      await flush();
      assert.deepEqual(seen.opened, [steps[i - 1]!.key], `${flow}/${steps[i]!.key}`);
      assert.deepEqual(seen.marks, []);
    }
  }
});

test("Escape leaves the same way on every step and on the summary, and a menu or popup that took the key keeps it", async () => {
  installDom();
  const doc = (globalThis as unknown as { document: { addEventListener: unknown; removeEventListener: unknown } }).document;
  const keep = { add: doc.addEventListener, remove: doc.removeEventListener };
  const listeners = new Set<(e: { key: string; defaultPrevented?: boolean }) => void>();
  doc.addEventListener = (t: string, f: (e: { key: string }) => void): void => { if (t === "keydown") listeners.add(f); };
  doc.removeEventListener = (t: string, f: (e: { key: string }) => void): void => { if (t === "keydown") listeners.delete(f); };
  try {
    for (const flow of FLOWS) {
      for (const st of stepsOf(flow)) {
        listeners.clear();
        const { seen } = await mount(flow, st.key);
        for (const l of [...listeners]) l({ key: "Escape", defaultPrevented: true });
        assert.equal(seen.left, 0, `${flow}/${st.key}: a menu that closed on Escape keeps it`);
        for (const l of [...listeners]) l({ key: "Escape", defaultPrevented: false });
        assert.equal(seen.left, 1, `${flow}/${st.key}: Escape leaves`);
      }
    }
    listeners.clear();
    const { seen } = await mount("member", "summary", Object.fromEntries(stepsOf("member").map((s) => [s.key, "done" as const])));
    for (const l of [...listeners]) l({ key: "Escape" });
    assert.equal(seen.left, 1, "the summary leaves on Escape too");
  } finally { doc.addEventListener = keep.add; doc.removeEventListener = keep.remove; }
});

test("the counter and the bar move with the step on show, not with what is done", async () => {
  installDom();
  const steps = stepsOf("personal");
  for (let i = 0; i < steps.length; i++) {
    const { root } = await mount("personal", steps[i]!.key, { ai: "done", interview: "done" });
    assert.ok(textOf(find(root, "onboarding-progress")).includes(`Step ${i + 1} of 8`), steps[i]!.key);
    assert.equal((find(root, "onboarding-bar")?.props["aria-valuenow"] as number | undefined), i + 1, steps[i]!.key);
  }
  // Skip for now moves the counter on with the step, and Back moves it back
  const root = await hosted("personal", "sessions", { ai: "done", interview: "done" });
  assert.ok(textOf(find(root, "onboarding-progress")).includes("Step 3 of 8"));
  await press(find(root, "step-later"));
  await flush();
  assert.ok(textOf(find(root, "onboarding-progress")).includes("Step 4 of 8"), "skipping step 3 opens step 4, and the counter says so");
  assert.ok(textOf(find(root, "row-step-sessions")).includes("Skipped"));
  await press(find(root, "step-back"));
  await flush();
  assert.ok(textOf(find(root, "onboarding-progress")).includes("Step 3 of 8"), "Back moves it back");
});

test("a skipped step says Skipped in the step list, stays one press away there, and the first Chats screen offers it with Skipped", async () => {
  installDom();
  const root = await hosted("personal", "chrome", { ai: "done", interview: "done", sessions: "later", folders: "later" });
  assert.ok(textOf(find(root, "row-step-sessions")).includes("Skipped") && textOf(find(root, "row-step-folders")).includes("Skipped"));
  assert.ok(!textOf(find(root, "row-step-ai")).includes("Skipped"));
  await press(find(root, "row-step-folders"));
  await flush();
  assert.ok(textOf(find(root, "onboarding-progress")).includes("Step 4 of 8"));
  assert.ok(find(root, "step-later"), "a skipped step can still be skipped again or done");
  const top = setupTop(setupRows("personal", { ai: "done", interview: "done", sessions: "later", folders: "later", chrome: "done", phone: "done", win: "done", team: "done" }, "mac"));
  assert.deepEqual(top.rows.map((r) => [r.key, r.state]), [["sessions", "later"], ["folders", "later"]], "the first Chats screen lists the skipped steps");
  assert.deepEqual(top.rows.map(setupNote), ["Skipped", "Skipped"], "and its rows say Skipped");
  assert.equal(setupNote(setupRows("personal", {}, "mac")[0]!), "Claude, ChatGPT, Grok", "an open step keeps its own line");
});

test("a step whose screen lives elsewhere has one button to open it, and Continue ticks it done", async () => {
  installDom();
  const { OpenCard } = await import("./OpenCard.tsx");
  const marks: string[] = [];
  let opened = 0;
  const r = createRoot();
  await act(async () => {
    r.render(<OnboardingScreen flow="member" spaceName="Acme" progress={{}} stepKey="mine" device="mac" onStep={(k, st) => marks.push(`${k}:${st}`)} onClose={() => undefined}
      renderCard={(_card, ctx) => <OpenCard text="" action="Open Inbox" onOpen={() => { opened++; }} onDone={ctx.done} gate={ctx.gate} />} />);
  });
  await flush();
  const root = r.container as never;
  assert.equal(find(root, "open-card-done"), null, "no second Done beside Continue");
  await press(find(root, "open-card-go"));
  assert.equal(opened, 1);
  assert.notEqual(find(root, "step-next")?.props["aria-disabled"], true, "Continue is live");
  await press(find(root, "step-next"));
  await flush();
  assert.deepEqual(marks, ["mine:done"]);
});

test("How you work runs on the bar: Next, Next, then Save, with Previous question in the card and no second primary button", async () => {
  installDom();
  const { InterviewCard } = await import("./InterviewCard.tsx");
  const caps: string[] = [], marks: string[] = [];
  const call = (async (cap: string) => { caps.push(cap); return { fact: { factId: "f1", status: "accepted" } }; }) as never;
  const r = createRoot();
  await act(async () => {
    r.render(<OnboardingScreen flow="personal" spaceName="Maya" progress={{ ai: "done" }} stepKey="interview" device="mac" onStep={(k, st) => marks.push(`${k}:${st}`)} onClose={() => undefined}
      renderCard={(_card, ctx) => <InterviewCard call={call} onSaved={ctx.done} gate={ctx.gate} />} />);
  });
  await flush();
  const root = r.container as never;
  assert.equal(find(root, "interview-next"), null);
  assert.ok(textOf(find(root, "step-why")).includes("Answer the three questions first"));
  await press(find(root, "interview-suggest-0"));
  assert.ok(textOf(find(root, "step-next")).includes("Next"));
  await press(find(root, "step-next"));
  await flush();
  assert.ok(find(root, "interview-back"), "Previous question");
  await press(find(root, "interview-suggest-0"));
  await press(find(root, "step-next"));
  await flush();
  await press(find(root, "interview-style-short"));
  assert.ok(textOf(find(root, "step-next")).includes("Save"));
  await press(find(root, "step-next"));
  await flush();
  assert.ok(caps.includes("memory.propose_fact"), "saved to memory");
  assert.deepEqual(marks, ["interview:done"]);
});
