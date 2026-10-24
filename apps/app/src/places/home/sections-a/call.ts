// Screen actions use the same /state pointers as the generated screen index.

import { resolveInput } from "../../../../../../client/src/index.ts";
import type { Face } from "./faces.ts";
import { HOME_SCREEN_INDEX } from "./screens.ts";
import type { HomeCall, HomeSession } from "./session.ts";

export function callAction(session: HomeSession, screenId: string, action: string, state: Record<string, unknown>): HomeCall {
  const spec = HOME_SCREEN_INDEX.get(screenId)?.actions[action];
  if (!spec) throw new Error(`${screenId} has no ${action} action`);
  const input = resolveInput(spec.input, state);
  const call: HomeCall = { cap: spec.cap, input };
  session.calls.push(call);
  return call;
}

/** Click a face, then pick a person, agent, group, or role. Slot is Assigned. */
export function assignFromFace(session: HomeSession, taskId: string, face: Face): HomeCall {
  return callAction(session, "tasks.my-work", "assign", {
    taskId,
    slot: "assigned",
    to: { kind: face.kind, id: face.id },
  });
}

export function actOnNeed(session: HomeSession, taskId: string, action: string, note?: string): HomeCall {
  const state: Record<string, unknown> = { taskId, action };
  if (note !== undefined) state.note = note;
  return callAction(session, "home.needs-you-top3", "act", state);
}

export function undoFromDigest(session: HomeSession, runId: string): HomeCall {
  return callAction(session, "home.away-digest", "undo", { runId });
}
