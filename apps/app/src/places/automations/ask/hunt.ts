// The host allowlist decides what can load. This set only decides when Ask asks the host.
import type { AskTurn } from "./plan.ts";

const HUNT_APPS = new Set(["stripe"]);

/** True when this turn should ask the host for one allowlisted official document. */
export function shouldHunt(turn: AskTurn): boolean {
  if (!HUNT_APPS.has(turn.app)) return false;
  if (turn.kind === "paste" || turn.kind === "sign_in") return false;
  if (turn.kind === "need_doc") return true;
  return turn.stepKey === null;
}
