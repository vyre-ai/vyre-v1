// Where onboarding runs, because the steps differ by device (journey table D): the Mac and Windows apps do everything; a browser cannot read the disk, so sessions and folders are
// hidden; a phone also has no Chrome extension, and its own step ("Your phone") is already done.
import { stepsOf } from "./flow.ts";
import type { FlowKind, Progress, StepDef, StepState } from "./flow.ts";
import { stateOf } from "./flow.ts";
import { phoneCanReach } from "../shell/session/reach.ts";

export type Device = "mac" | "win" | "web" | "phone";

const HIDDEN: Record<Device, readonly string[]> = {
  mac: [],
  win: [],
  web: ["import_sessions", "local_folders"],
  phone: ["import_sessions", "local_folders", "chrome"],
};

/** The device this page runs on: a phone by width, the desktop app by its Tauri bridge (Mac or Windows by platform), otherwise a browser. */
export function detectDevice(width?: number): Device {
  const g = globalThis as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    navigator?: { platform?: string; userAgent?: string };
  };
  if (width !== undefined && width > 0 && width <= 520) return "phone";
  if (g.__TAURI__ !== undefined || g.__TAURI_INTERNALS__ !== undefined)
    return /win/i.test(g.navigator?.platform ?? g.navigator?.userAgent ?? "") ? "win" : "mac";
  return "web";
}

/** What is true here and now, so a step that cannot be done is not shown (rows, count and chip all read one list): each fact is true unless it says otherwise. */
export interface RowFacts {
  /** an AI account exists: a routine needs one, so a first-win row waits for it */ ai?: boolean;
  /** this browser can install the extension (a desktop Chrome or Edge) */ chrome?: boolean;
  /** a phone can open this Space's address, so pairing can start */ phone?: boolean;
  /** a mailbox of the person's is connected, so a member's own mail, calendar and files are there */ company?: boolean;
  /** the Space has no name yet; once it has one (typed on the owner's first card) the "name your Space" row is done and not shown */ unnamed?: boolean;
}
const NEEDS: Readonly<Record<string, keyof RowFacts>> = {
  first_win: "ai",
  team_win: "ai",
  chrome: "chrome",
  phone: "phone",
  own_data: "company",
  org: "unnamed",
};

/** The one list of steps a person sees on this device in this state: the device's own steps, minus the ones whose fact is false. */
export const visibleSteps = (flow: FlowKind, device: Device, facts: RowFacts = {}): readonly StepDef[] =>
  stepsOf(flow).filter((s) => !HIDDEN[device].includes(s.card) && facts[NEEDS[s.card] as keyof RowFacts] !== false);

/** What the page itself can tell: the AI step is done, the browser can install the extension, a phone can open this address; `company` and `unnamed` come from the caller, which reads them. */
export function rowFacts(
  progress: Readonly<Record<string, string>>,
  device: string,
  more: Pick<RowFacts, "company" | "unnamed"> = {},
): RowFacts {
  const g = globalThis as { navigator?: { userAgent?: string }; location?: { origin?: string } };
  const ua = g.navigator?.userAgent ?? "";
  return {
    ai: progress["ai"] === "done",
    chrome: device === "mac" || device === "win" || (device === "web" && /Chrome\//.test(ua) && !/Mobile/.test(ua)),
    phone: g.location?.origin ? phoneCanReach(g.location.origin) : true,
    ...(more.company === undefined ? {} : { company: more.company }),
    ...(more.unnamed === undefined ? {} : { unnamed: more.unnamed }),
  };
}

/** A step's state on this device: "Your phone" is done on the phone itself. */
export function stateOn(progress: Progress, step: StepDef, device: Device): StepState {
  return step.card === "phone" && device === "phone" ? "done" : stateOf(progress, step.key);
}

export function countsOn(
  flow: FlowKind,
  progress: Progress,
  device: Device,
  facts: RowFacts = {},
): { done: number; later: number; total: number } {
  const steps = visibleSteps(flow, device, facts);
  return {
    done: steps.filter((s) => stateOn(progress, s, device) === "done").length,
    later: steps.filter((s) => stateOn(progress, s, device) === "later").length,
    total: steps.length,
  };
}

/** The step after `key` that is not done on this device, wrapping to one put off before it; null when none is left. */
export function nextOn(flow: FlowKind, progress: Progress, key: string, device: Device): string | null {
  const steps = visibleSteps(flow, device),
    at = steps.findIndex((s) => s.key === key);
  const open = (s: StepDef): boolean => stateOn(progress, s, device) !== "done";
  return steps.slice(at + 1).find(open)?.key ?? steps.slice(0, Math.max(at, 0)).find(open)?.key ?? null;
}

export function resumeOn(flow: FlowKind, progress: Progress, device: Device): string | null {
  const steps = visibleSteps(flow, device);
  return (
    steps.find((s) => stateOn(progress, s, device) === "open")?.key ??
    steps.find((s) => stateOn(progress, s, device) === "later")?.key ??
    null
  );
}
