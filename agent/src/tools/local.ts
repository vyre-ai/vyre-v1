// Local tool prompts (spec 4.17, 2.14): tools that run where the target lives (terminal, Chrome, screen, files on the agent computer or device). The chat's mode is the one dial: an Auto chat runs them, an Ask
// first chat parks them, and the person's own setting is read only where there is no chat (a step, a one-shot job). The owner's floor is a cap on all of it. None of this touches capability calls: the Gate decides those.
import type { ToolDef } from "./types.ts";

export type SecurityMode = "ask" | "allow" | "auto";
const STRICT: Readonly<Record<SecurityMode, number>> = { ask: 0, allow: 1, auto: 2 };

/** The mode that applies: the stricter of the person's choice and the owner's floor. */
export function effectiveMode(person: SecurityMode, floor: SecurityMode): SecurityMode {
  return STRICT[person] <= STRICT[floor] ? person : floor;
}

export interface ModePair { person: SecurityMode; floor: SecurityMode }
const MODES: readonly string[] = ["ask", "allow", "auto"];
const asMode = (v: unknown): SecurityMode | undefined => (typeof v === "string" && MODES.includes(v) ? (v as SecurityMode) : undefined);
/** A mode setting is { base, spaces: { <space>: mode } } (or a bare mode, as a floor may be). The person's mode here is this Space's entry, else the base; no floor means anyone may pick Auto; nothing readable means Ask. */
export function modePair(row: { value?: unknown; floor?: unknown } | undefined, space: string): ModePair {
  if (!row) return { person: "ask", floor: "ask" };
  const pick = (v: unknown): SecurityMode | undefined => {
    if (asMode(v)) return asMode(v);
    const o = (v !== null && typeof v === "object" ? v : {}) as { base?: unknown; spaces?: Record<string, unknown> };
    return asMode(o.spaces?.[space]) ?? asMode(o.base);
  };
  return { person: pick(row.value) ?? "ask", floor: row.floor === undefined ? "auto" : pick(row.floor) ?? "ask" };
}

/** The mode a local tool runs at in this chat: the chat's dial when there is one, held to the owner's floor. A setting that could not be read keeps its floor of Ask. */
export function dialFor(chat: "ask" | "auto" | "plan" | undefined, pair: ModePair | undefined): ModePair {
  return { person: chat === "auto" ? "auto" : chat === undefined ? pair?.person ?? "ask" : "ask", floor: pair?.floor ?? "ask" };
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
