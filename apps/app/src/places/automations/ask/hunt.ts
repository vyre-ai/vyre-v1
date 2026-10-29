// The host directory decides which document loads. Ask asks whenever the catalog has no step yet.
import type { AskTurn } from "./plan.ts";

/** True when this turn should ask the host for one official document. */
export function shouldHunt(turn: AskTurn): boolean {
  if (turn.app.trim() === "") return false;
  if (turn.kind === "paste" || turn.kind === "sign_in") return false;
  if (turn.kind === "need_doc") return true;
  return turn.stepKey === null;
}
