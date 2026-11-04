// The refusal for a picked model nothing can serve (modules/engine/tests/model-picked.runtime.test.ts makes the block): the chat shows the engine's own sentence and two ways forward.
import test from "node:test";
import assert from "node:assert/strict";
import { statusView } from "./status.ts";

test("engine.model_unavailable reads as the error row with the engine's sentence, Choose another model and Run it on my computer", () => {
  const detail = "Claude Sonnet 5.5 cannot run here: none of the AI accounts you can use on this server serve it. Models that can: GLM 5.3, Kimi K3. Pick another model, or run this chat on the computer where your own sign-in is.";
  const view = statusView({ type: "turn_status", v: 1, id: "b", data: { state: "failed", code: "engine.model_unavailable", detail } } as never);
  assert.equal(view.kind, "error");
  const data = (view as { block: { data: { message: string; next: Array<{ key: string }> } } }).block.data;
  assert.equal(data.message, detail);
  assert.deepEqual(data.next.map((n) => n.key), ["pick_model", "run_on_my_computer"]);
});
