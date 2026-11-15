// The setup steps as rows for the Home checklist, as plain data (no component, so a .ts test can import it): one row per step of the person's flow with its state.
import type { FlowKind, Progress, StepState } from "./flow.ts";
import { stateOn, visibleSteps } from "./device.ts";
import type { Device } from "./device.ts";

export interface SetupRow {
  key: string;
  title: string;
  note: string;
  state: StepState;
}

/** The quiet line under a step's row: Skipped for a step put off, else its own line. */
export const setupNote = (row: SetupRow): string => (row.state === "later" ? "Skipped" : row.note);

/** What the new chat shows on the first day: the top three steps still to do, the ones not put off first, and how many more wait. Done steps have left. */
export function setupTop(rows: readonly SetupRow[], most = 3): { rows: SetupRow[]; more: number } {
  const left = [...rows.filter((r) => r.state === "open"), ...rows.filter((r) => r.state === "later")];
  return { rows: left.slice(0, most), more: Math.max(0, left.length - most) };
}

/** What is true here and now, so a row that cannot be done is not shown (prototype amendment 3): each fact is true unless it says otherwise. */
export interface RowFacts {
  /** an AI account exists: a routine needs one, so a first-win row waits for it */ ai?: boolean;
  /** this browser can install the extension (a desktop Chrome or Edge) */ chrome?: boolean;
  /** a phone can open this Space's address, so pairing can start */ phone?: boolean;
  /** a company connection (Google Workspace or Microsoft 365) is set up, so a member's own mail, calendar and files are there */ company?: boolean;
}
const NEEDS: Readonly<Record<string, keyof RowFacts>> = {
  first_win: "ai",
  team_win: "ai",
  chrome: "chrome",
  phone: "phone",
  own_data: "company",
};

/** The steps this device shows (a browser has no sessions or folders, a phone no Chrome and its own step is done); the Mac app shows all. A step whose fact is false is not shown. */
export function setupRows(
  flow: FlowKind,
  progress: Progress,
  device: Device = "mac",
  facts: RowFacts = {},
): SetupRow[] {
  return visibleSteps(flow, device)
    .filter((s) => facts[NEEDS[s.card] as keyof RowFacts] !== false)
    .map((s) => ({
      key: s.key,
      title: s.title,
      note: s.line,
      state: stateOn(progress, s, device),
    }));
}
