// The ask-first rule is held to the Gate's own table and to the step catalogue (rc.41): every outward act the Gate marks high risk asks first unless the step turned asking off, and every outward
// step either calls a capability that declares a Gate or is one the steps module asks about itself. A new outward step or a new high-risk act fails here until the rule covers it.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../generated/registry.ts";
import { ASK_FIRST_ACTS, asksFirst } from "../lib/ask-first.ts";
import { OUTWARD_ACTS } from "../lib/grants.ts";

type Step = { key: string; effects?: string; cap?: string; gateAct?: string };
type Cap = { name: string; gate?: { act?: string; reason?: string } };
const STEPS = registry.steps as unknown as Step[];
const CAPS = new Map((registry.capabilities as unknown as Cap[]).map((c) => [c.name, c] as const));

test("what the step says wins; a step that says nothing asks only for an ask-first act", () => {
  assert.equal(asksFirst(true, "send"), true);
  assert.equal(asksFirst(false, "signature_send"), false);
  assert.equal(asksFirst(undefined, "signature_send"), true);
  assert.equal(asksFirst(undefined, "send"), false);
  assert.equal(asksFirst(undefined, "post"), false);
  assert.equal(asksFirst(undefined, undefined), false);
});

test("every outward act the Gate marks high risk that a person does not do by hand is an ask-first act", () => {
  const acts = registry.gateActs as unknown as { key: string; risk: string; appliesTo?: { humanToo?: boolean } }[];
  for (const a of acts) {
    if (!OUTWARD_ACTS.has(a.key) || a.risk !== "high" || a.appliesTo?.humanToo === true) continue;
    assert.ok(
      ASK_FIRST_ACTS.has(a.key),
      `${a.key} is a high-risk outward act: add it to ASK_FIRST_ACTS (lib/ask-first.ts)`,
    );
  }
  assert.ok(ASK_FIRST_ACTS.has("signature_send"));
});

test("the signature step is an ask-first step", () => {
  const sign = STEPS.find((s) => s.key === "sign")!;
  assert.equal(sign.effects, "outward");
  assert.equal(asksFirst(undefined, sign.gateAct), true);
});

test("every outward step can be held: its capability declares a Gate, or it is a chat post, which the steps module asks about itself", () => {
  const selfAsked = new Set(["post_message"]);
  for (const s of STEPS) {
    if (s.effects !== "outward") continue;
    const gate = s.cap ? CAPS.get(s.cap)?.gate : undefined;
    // a Gate of "none" counts only when it says why (a draft stays in the mailbox and nothing is sent)
    const gated = gate?.act !== undefined && (gate.act !== "none" || Boolean(gate.reason));
    assert.ok(gated || selfAsked.has(s.key), `${s.key} is outward but ${s.cap} declares no Gate: nothing can hold it`);
    if (selfAsked.has(s.key)) assert.equal(s.gateAct, "post", `${s.key} is asked about as a post`);
  }
  assert.equal(CAPS.get("automations.step_ask")?.gate?.act, "post");
});

test("a draft step is the only outward step with a Gate of none, and it says why; every send, post or sign step holds", () => {
  const none: string[] = [];
  for (const s of STEPS) {
    if (s.effects !== "outward" || !s.cap) continue;
    const gate = CAPS.get(s.cap)?.gate;
    if (gate?.act === "none") {
      none.push(s.key);
      assert.ok(gate.reason, `${s.key} has a Gate of none with no reason`);
    }
    if (/send|sign|post|create_event|comment/.test(s.key)) assert.notEqual(gate?.act, "none", `${s.key} must hold`);
  }
  assert.deepEqual(none.sort(), ["google.gmail.create_draft", "ms.mail.create_draft"]);
});
