// Onboarding flows (owner flowchart, 30 Oct 2026): the steps a person walks in a Personal Space, as the owner of a Team Space, and as a member who joined one.
// Pure data and rules, no screen. Every step can be skipped ("later") and reopened from the Home checklist or the Console. A step passed with "later" counts as passed
// for moving on, never as done, so the rail and the checklist keep showing it.
export type FlowKind = "personal" | "team" | "member";
export type StepState = "open" | "done" | "later";
/** The card a step shows in the chat. The scripted engine and the Assistant both speak through these, so the screen has one set of cards. */
export type CardKind =
  | "connect_ai" | "interview" | "import_sessions" | "local_folders" | "chrome" | "phone" | "first_win"
  | "org" | "space_ai" | "google_microsoft" | "sign_in_domain" | "directory" | "invites" | "agents" | "shared_data" | "team_win" | "computers"
  | "own_data" | "apps" | "meet_agents" | "optional_personal" | "bridge_team";

export interface StepDef { key: string; title: string; card: CardKind; /** one plain line under the title in the rail */ line: string }

const personal: StepDef[] = [
  { key: "ai", title: "Connect your AI", card: "connect_ai", line: "Claude, ChatGPT or Grok, or an API key" },
  { key: "interview", title: "How you work", card: "interview", line: "Saved to your memory" },
  { key: "sessions", title: "Bring your sessions", card: "import_sessions", line: "Claude Code and Codex on this computer" },
  { key: "folders", title: "Local folders", card: "local_folders", line: "Folders Vyre may read" },
  { key: "chrome", title: "Chrome extension", card: "chrome", line: "Fill from your Vault, drive Chrome" },
  { key: "phone", title: "Your phone", card: "phone", line: "Scan a code to pair" },
  { key: "win", title: "First win", card: "first_win", line: "One routine running" },
  { key: "team", title: "Add a team", card: "bridge_team", line: "Optional, any time" },
];

const team: StepDef[] = [
  { key: "org", title: "Your organisation", card: "org", line: "Name, logo, time zone, a Kit for your kind of work" },
  { key: "space_ai", title: "AI for the Space", card: "space_ai", line: "Your account here, optional shared key" },
  { key: "workspace", title: "Google or Microsoft", card: "google_microsoft", line: "Admin steps, secure fields, live test" },
  { key: "sign_in", title: "Sign in for your domain", card: "sign_in_domain", line: "Google or Microsoft, same app" },
  { key: "people", title: "Your team", card: "directory", line: "Import the directory, pick people and roles" },
  { key: "invites", title: "Invites", card: "invites", line: "Drafted for you, sent when you approve" },
  { key: "agents", title: "Agents and computers", card: "agents", line: "From the Kit, and where they run" },
  { key: "shared", title: "Shared data", card: "shared_data", line: "Folders, records from a sheet, shared logins" },
  { key: "win", title: "First team win", card: "team_win", line: "One thing your team now does" },
];

const member: StepDef[] = [
  { key: "mine", title: "Your mail, calendar, files", card: "own_data", line: "Already here, and only yours" },
  { key: "ai", title: "Your AI account", card: "connect_ai", line: "Kept in your own Mine Vault" },
  { key: "apps", title: "Apps", card: "apps", line: "Desktop, phone, Chrome" },
  { key: "interview", title: "How you work", card: "interview", line: "Saved to your memory" },
  { key: "agents", title: "Meet the team's agents", card: "meet_agents", line: "What each one does for you" },
  { key: "personal", title: "A Personal Space", card: "optional_personal", line: "Optional, on this computer" },
];

const FLOWS: Record<FlowKind, readonly StepDef[]> = { personal, team, member };
export const stepsOf = (flow: FlowKind): readonly StepDef[] => FLOWS[flow];
export const stepDef = (flow: FlowKind, key: string): StepDef | undefined => FLOWS[flow].find((s) => s.key === key);
export const isStepKey = (flow: FlowKind, key: string): boolean => stepDef(flow, key) !== undefined;

export type Progress = Readonly<Record<string, StepState>>;
export const stateOf = (progress: Progress, key: string): StepState => progress[key] ?? "open";

/** The step to open now: the first one still open, else the first one put off. Null when every step is done. */
export function resumeAt(flow: FlowKind, progress: Progress): string | null {
  const steps = FLOWS[flow];
  return steps.find((s) => stateOf(progress, s.key) === "open")?.key ?? steps.find((s) => stateOf(progress, s.key) === "later")?.key ?? null;
}

/** The step after `key` that is not done, wrapping to a put-off one before it; null when none is left. */
export function nextAfter(flow: FlowKind, progress: Progress, key: string): string | null {
  const steps = FLOWS[flow];
  const at = steps.findIndex((s) => s.key === key);
  const after = steps.slice(at + 1).find((s) => stateOf(progress, s.key) !== "done");
  if (after) return after.key;
  return steps.slice(0, Math.max(at, 0)).find((s) => stateOf(progress, s.key) !== "done")?.key ?? null;
}

export function counts(flow: FlowKind, progress: Progress): { done: number; later: number; total: number } {
  const steps = FLOWS[flow];
  return { done: steps.filter((s) => stateOf(progress, s.key) === "done").length, later: steps.filter((s) => stateOf(progress, s.key) === "later").length, total: steps.length };
}

/** Which flow a person walks: their own Personal Space, the owner of a Team Space, or any other member of one. */
export function flowFor(space: { kind: "personal" | "team" }, isOwner: boolean): FlowKind {
  return space.kind === "personal" ? "personal" : isOwner ? "team" : "member";
}

/** Opens by itself the first time into a Space, for the owner and for a member, until they have seen it once (dismissed) or finished every step. */
export function shouldAutoOpen(flow: FlowKind, progress: Progress, seen: boolean): boolean {
  return !seen && resumeAt(flow, progress) !== null;
}
