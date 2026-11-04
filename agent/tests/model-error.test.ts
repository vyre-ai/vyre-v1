// What a model reads of a failed tool (owner, 4 Nov): a code and a plain sentence, no trace and no internal id; the code's own reason word stays, because a caller tells refusals apart by it.
import test from "node:test";
import assert from "node:assert/strict";
import { modelError } from "../src/tools/model-error.ts";

const err = (details: Record<string, unknown>) => ({ code: "permission.no_grant", message: "No.", traceId: "t", details }) as never;

test("a reason word stays, even one as long as agent_settings, and a reason that is an id does not", () => {
  assert.equal(modelError(err({ reason: "agent_settings" })).details?.reason, "agent_settings");
  assert.equal(modelError(err({ reason: "placeholder" })).details?.reason, "placeholder");
  assert.equal(modelError(err({ reason: "tsk_a1b2c3d4e5f6" })).details?.reason, undefined);
  assert.equal(modelError(err({ reason: "vault_locked", tool: "files_save" })).details?.tool, "files_save");
});

test("it reads the same every time: no state carries from one error to the next", () => {
  for (let i = 0; i < 4; i++) assert.equal(modelError(err({ reason: "agent_settings" })).details?.reason, "agent_settings");
});

test("ids and traces are taken out of the words", () => {
  const e = modelError({ code: "validation.not_found", message: "No file fil_a1b2c3d4e5f6 (trace 14d3abcd14d3abcd).", traceId: "14d3abcd14d3abcd" } as never);
  assert.ok(!/fil_a1b2|14d3abcd/.test(e.message), e.message);
});
