// Local tool prompts (spec 4.17, 2.14). Ask, Allow and Auto govern only tools that run where the target lives (terminal, Chrome, screen, files on the agent computer or device).
// They never touch capability calls: the Gate decides those inside invoke, and Auto cannot loosen it. The owner's floor is the strictest mode anyone may pick.
import type { ToolDef } from "./types.ts";

export type SecurityMode = "ask" | "allow" | "auto";
const STRICT: Readonly<Record<SecurityMode, number>> = { ask: 0, allow: 1, auto: 2 };

/** The mode that applies: the stricter of the person's choice and the owner's floor. */
export function effectiveMode(person: SecurityMode, floor: SecurityMode): SecurityMode {
  return STRICT[person] <= STRICT[floor] ? person : floor;
}

export interface LocalFacts {
  /** The act reaches outside the work folder it is locked to. A hard wall in every mode. */
  outsideLockedFolder?: boolean;
  /** Deleting outside work/. Always asks. */
  deletesOutsideWork?: boolean;
  /** Sending money or submitting a card. Always asks. */
  movesMoney?: boolean;
  /** Anything the owner's floor marks. Always asks. */
  floorMarked?: boolean;
}

export type LocalDecision = { action: "run" | "prompt"; reason: string } | { action: "refuse"; reason: string };

export function decideLocal(t: ToolDef, mode: SecurityMode, floor: SecurityMode, facts: LocalFacts = {}): LocalDecision {
  if (t.local === "none") return { action: "run", reason: "not a local tool: the capability pipeline and the Gate decide" };
  if (facts.outsideLockedFolder === true) return { action: "refuse", reason: "outside the work folder" };
  if (facts.deletesOutsideWork === true || facts.movesMoney === true || facts.floorMarked === true) return { action: "prompt", reason: "always asks" };
  const m = effectiveMode(mode, floor);
  return m === "ask" ? { action: "prompt", reason: "ask mode" } : { action: "run", reason: `${m} mode` };
}
