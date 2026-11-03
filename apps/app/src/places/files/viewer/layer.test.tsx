// Redaction for AI in the Viewer: where marks sit block by block (a chosen match counted across the whole file, as the server counts it), the runs a block draws (a redaction inside a highlight),
// what Preview as agent shows, and the Activity lines and credits of the Files Viewer.
import test from "node:test";
import assert from "node:assert/strict";
import { layerRuns, layerSpans, previewRuns } from "../../../../../../ui/src/Viewer/layer.tsx";
import type { ViewerMark } from "../../../../../../ui/src/Viewer/layer.tsx";
import { activityOf, creditOf, viewerMarks } from "./redact.tsx";

const m = (id: string, kind: "redact" | "highlight", text: string, occurrence?: number): ViewerMark => ({ id, kind, shape: "span", text, ...(occurrence !== undefined ? { occurrence } : {}), by: "Irfad Imtiaz", when: "9:41 am today" });

test("a chosen match is counted across blocks; no occurrence covers every match", () => {
  const texts = ["Name: Elena Rivera", "Signed: Elena Rivera, Oct 23"];
  assert.deepEqual(layerSpans(texts, [m("a", "redact", "Elena Rivera", 1)]).map((b) => b.map((s) => [s.s, s.e])), [[], [[8, 20]]]);
  assert.deepEqual(layerSpans(texts, [m("a", "redact", "Elena Rivera")]).map((b) => b.length), [1, 1]);
});

test("a redaction inside a highlight is one run under both, the outer first", () => {
  const t = "diagnosed with a torn meniscus in her right knee";
  const spans = layerSpans([t], [m("h", "highlight", t), m("r", "redact", "torn meniscus")])[0]!;
  const runs = layerRuns(t, spans);
  assert.deepEqual(runs.map((r) => [r.text, r.marks.map((x) => x.id)]), [["diagnosed with a ", ["h"]], ["torn meniscus", ["h", "r"]], [" in her right knee", ["h"]]]);
});

test("Preview as agent: [REDACTED] chips and ==highlight== tints, nothing else", () => {
  assert.deepEqual(previewRuns("Name: [REDACTED]. ==Slipped near [REDACTED]== today"), [
    { text: "Name: " }, { text: "[REDACTED]", tok: true }, { text: ". " }, { text: "Slipped near ", hl: true }, { text: "[REDACTED]", tok: true, hl: true }, { text: " today" },
  ]);
});

test("the Activity reads who did what, and an agent's work carries the (Agent) credit", () => {
  const name = (id: string): string => ({ usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", agt_intake: "Intake" })[id] ?? id;
  assert.equal(activityOf({ id: "1", type: "file.agent_read", actor: "svc_host", at: 1, payload: { agentId: "agt_intake", redacted: true } }, name)?.who, "Intake (Agent)");
  assert.equal(activityOf({ id: "1", type: "file.agent_read", actor: "svc_host", at: 1, payload: { agentId: "agt_intake", redacted: true } }, name)?.text, "read the redacted version");
  const byAgent = activityOf({ id: "2", type: "file.redacted", actor: "usr_irfad", at: 1, payload: { by: "usr_irfad", byAgent: "assistant", label: "Phone" } }, name)!;
  assert.deepEqual([byAgent.who, byAgent.text], ["Irfad Imtiaz (Agent)", "redacted a phone"]);
  assert.equal(activityOf({ id: "3", type: "file.unredacted", actor: "usr_maya", at: 1, payload: { by: "usr_maya", label: "Date" } }, name)?.text, "un-redacted a date");
  assert.equal(activityOf({ id: "4", type: "file.reviewed", actor: "usr_irfad", at: 1, payload: { by: "usr_irfad" } }, name)?.who, "Irfad");
  assert.equal(activityOf({ id: "5", type: "file.moved", actor: "usr_irfad", at: 1, payload: {} }, name), null);
  assert.equal(creditOf({ by: "usr_irfad", byAgent: "assistant" }, name), "Irfad Imtiaz (Agent)");
  const vm = viewerMarks({ state: "reviewed", version: 1, access: { value: "redact", own: false, inherited: "redact" }, marks: [{ markId: "m1", kind: "redact", shape: "name", text: "Rivera", by: "usr_irfad", at: 1, unplaced: false }, { markId: "m2", kind: "redact", shape: "span", text: "512-44-8391", label: "SSN", by: "usr_irfad", at: 1, unplaced: false }], unplaced: [], names: [], requests: [] }, name, 2);
  assert.deepEqual(vm.map((x) => x.id), ["m2"], "a name piece is not drawn in the body");
});
