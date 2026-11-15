// "Vyre knows": the three lines, what each says before and after an answer, and the way out when the Assistant cannot answer.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { InterviewKnows } from "./InterviewKnows.tsx";
import type { CapCall } from "../shell/session/caps.ts";

const call = (async () => ({})) as unknown as CapCall;
const noop = async (): Promise<void> => undefined;

test("with nothing saved every line says Not yet, nothing can be changed, and the form is one press away", () => {
  const out = renderToStaticMarkup(<InterviewKnows call={call} saved={{}} refresh={noop} onByHand={() => undefined} />);
  for (const id of ["interview-knows", "knows-work", "knows-tools", "knows-style", "interview-by-hand"])
    assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.equal((out.match(/Not yet/g) ?? []).length, 3);
  assert.ok(!out.includes('data-testid="knows-change-work"'), "nothing to change yet");
  for (const label of ["What you do", "Tools you use", "How you like updates"]) assert.ok(out.includes(label), label);
});

test("a saved line shows its words with Change and Remove; with all three saved the form link is gone", () => {
  const saved = {
    work: { factId: "fct_1", text: "planner" },
    tools: { factId: "fct_2", text: "Gmail, Sheets" },
    style: { factId: "fct_3", text: "Full detail" },
  };
  const out = renderToStaticMarkup(
    <InterviewKnows call={call} saved={saved} refresh={noop} onByHand={() => undefined} />,
  );
  assert.ok(out.includes("planner") && out.includes("Gmail, Sheets") && out.includes("Full detail"));
  for (const k of ["work", "tools", "style"]) {
    assert.ok(out.includes(`data-testid="knows-change-${k}"`) && out.includes(`data-testid="knows-remove-${k}"`), k);
  }
  assert.ok(!out.includes("Not yet"));
  assert.ok(!out.includes('data-testid="interview-by-hand"'), "done, so no way out is needed");
});
