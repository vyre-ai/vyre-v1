// Join logic with no rendering: the stage machine, the validity of each step, username and password rules (spec 3.13).
// The screens only dispatch actions and paint the state, so every rule here is tested without a renderer.

export type Stage = "connect" | "accept" | "steps" | "run" | "done" | "signin" | "expired";
export type AiChoice = "sub" | "key" | "admin" | "none";
export type SignInMode = "pw" | "totp";
export type ConnectIntent = "signin" | "onboarding";

export interface JoinInvite {
  space: string;
  /** the address label shown after the username, e.g. northwind in @dana.northwind */
  host: string;
  by: string;
  role: string;
  email?: string;
  /** server-supplied display marker, shown only as a continuity hint and never used to authenticate a Space */
  fingerprint?: string;
  /** names a person starts with, when the invite carries them */
  names?: { first: string; last: string };
  deviceName?: string;
  /** the agents and projects the person starts in; the section is left out when none are given */
  starting?: { agents: string[]; projects: string[] };
  sso: string[];
  github: boolean;
  /** an admin has provided a shared AI key */
  adminKey: boolean;
}

export interface FlowState {
  stage: Stage;
  step: 0 | 1 | 2 | 3;
  first: string;
  last: string;
  photo: string;
  user: string;
  pw: string;
  pw2: string;
  device: string;
  trust: boolean;
  /** false: none, "new": being made in the sheet, true: made and saved */
  rec: false | "new" | true;
  code: string;
  saved: boolean;
  sheet: boolean;
  ai: AiChoice;
  key: string;
  aiProvider: "openrouter" | "anthropic" | "openai";
  /** "subok": the subscription sign-in finished */
  note: "" | "subok" | "dl";
  si: SignInMode;
  siUser: string;
  siPw: string;
  siCode: string;
  spaceAddress: string;
  spaceIntent: ConnectIntent;
  spaceResolving: boolean;
  spaceError: string;
  run: number;
  dir: 1 | -1;
  error: string;
}

export const RUN_STEPS = (space: string): string[] => ["Securing your keys", `Joining ${space}`, "Syncing your projects", "Waking your assistant"];

export function initialState(invite: JoinInvite, over: Partial<FlowState> = {}): FlowState {
  return {
    stage: "accept", step: 0, first: invite.names?.first ?? "", last: invite.names?.last ?? "", photo: "", user: "", pw: "", pw2: "",
    device: invite.deviceName ?? "", trust: true, rec: false, code: "", saved: false, sheet: false, ai: invite.adminKey ? "admin" : "sub", key: "",
    aiProvider: "openrouter", note: "", si: "pw", siUser: "", siPw: "", siCode: "", spaceAddress: "", spaceIntent: "signin", spaceResolving: false, spaceError: "", run: 0, dir: 1, error: "", ...over,
  };
}

// ---- rules

/** 0 to 4: length 8 and 12, mixed case or letters with digits, a symbol or 16 characters. */
export function strength(p: string): number {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if ((/[A-Z]/.test(p) && /[a-z]/.test(p)) || (/\d/.test(p) && /[a-z]/i.test(p))) s++;
  if (/[^A-Za-z0-9]/.test(p) || p.length >= 16) s++;
  return Math.min(4, s);
}
/** The meter has three segments. */
export const meter = (s: number): 0 | 1 | 2 | 3 => (s >= 3 ? 3 : (s as 0 | 1 | 2));
export const usernameOk = (u: string): boolean => /^[a-z][a-z0-9._-]{2,23}$/.test(u);
export const cleanUsername = (raw: string): string => raw.toLowerCase().replace(/\s/g, "");

/** A Space is always reached through an explicit HTTP(S) address, never through the Tauri device daemon. */
export function normalizeSpaceAddress(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if ((url.protocol !== "https:" && (url.protocol !== "http:" || !local)) || !url.hostname) return null;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

/** The greeting is intentionally deterministic for testable, calm first-run copy. */
export const welcomeGreeting = (hour: number): "Good morning" | "Good afternoon" | "Good evening" => hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

/** Resolving is the boundary between a typed address and a verified Space identity. */
export async function resolveSpaceInvite(address: string, resolve: (normalizedAddress: string) => Promise<JoinInvite>): Promise<JoinInvite> {
  const normalized = normalizeSpaceAddress(address);
  if (!normalized) throw new Error("Enter a valid HTTPS Space address, or a local development address.");
  return resolve(normalized);
}

/** Keeps late network responses from replacing a newer Space or touching an unmounted flow. */
export interface SpaceResolutionGate {
  begin(): number;
  invalidate(): void;
  isCurrent(request: number): boolean;
  dispose(): void;
}
export function createSpaceResolutionGate(): SpaceResolutionGate {
  let latest = 0;
  let mounted = true;
  return {
    begin: () => ++latest,
    invalidate: () => { latest++; },
    isCurrent: (request) => mounted && request === latest,
    dispose: () => { mounted = false; },
  };
}

export function suggestions(first: string, last: string, current: string, ok: (u: string) => boolean): string[] {
  const f = first.trim().toLowerCase().replace(/[^a-z]/g, "");
  const l = last.trim().toLowerCase().replace(/[^a-z]/g, "");
  const all = [f && l ? `${f}.${l}` : "", f && l ? `${f}${l[0]}` : "", f ? `${f}-ops` : ""];
  return all.filter((x) => x && x !== current && usernameOk(x) && ok(x)).slice(0, 3);
}

export const fullName = (s: Pick<FlowState, "first" | "last">): string => `${s.first.trim()} ${s.last.trim()}`.trim();
export const initials = (s: Pick<FlowState, "first" | "last">): string => (((s.first.trim()[0] ?? "") + (s.last.trim()[0] ?? "")) || "?").toUpperCase();

export interface Rules { isTaken: (username: string) => boolean }

/** Whether Continue is enabled on the current step. */
export function valid(s: FlowState, r: Rules): boolean {
  if (s.stage !== "steps") return false;
  if (s.step === 0) return !!s.first.trim() && !!s.last.trim();
  if (s.step === 1) return usernameOk(s.user) && !r.isTaken(s.user) && strength(s.pw) >= 2 && s.pw2 === s.pw;
  if (s.step === 2) return !!s.device.trim() && (!s.rec || s.saved);
  return s.ai === "none" || s.ai === "admin" || (s.ai === "key" && s.key.trim().length >= 8) || s.ai === "sub";
}

export function signInValid(s: FlowState): boolean {
  return s.si === "totp" ? /^\d{6}$/.test(s.siCode) : !!s.siUser.trim() && !!s.siPw;
}

// ---- actions

export type Action =
  | { t: "set"; patch: Partial<FlowState> }
  | { t: "web" } | { t: "signin" } | { t: "back" } | { t: "next" }
  | { t: "recovery_open"; code: string } | { t: "recovery_close" } | { t: "recovery_done" }
  | { t: "pick_ai"; ai: AiChoice }
  | { t: "space_resolving"; intent: ConnectIntent } | { t: "space_resolved" } | { t: "space_failed"; message: string }
  | { t: "run_tick"; total: number } | { t: "run_done" }
  | { t: "failed"; message: string };

/** The one transition function. `next` on the last step starts the run; on sign-in it moves to the second factor or finishes. */
export function reduce(s: FlowState, a: Action, r: Rules): FlowState {
  switch (a.t) {
    case "set": return { ...s, ...a.patch };
    case "web": return { ...s, stage: "steps", step: 0, dir: 1 };
    case "signin": return { ...s, stage: "signin", si: "pw", dir: 1 };
    case "back": {
      if (s.stage === "signin") return s.si === "totp" ? { ...s, si: "pw", dir: -1 } : { ...s, stage: "accept", dir: -1 };
      if (s.stage !== "steps") return s;
      if (s.step === 0) return { ...s, stage: "accept", dir: -1 };
      return { ...s, step: (s.step - 1) as FlowState["step"], dir: -1, error: "" };
    }
    case "next": {
      if (s.stage === "signin") {
        if (!signInValid(s)) return s;
        return s.si === "pw" ? { ...s, si: "totp", dir: 1 } : { ...s, stage: "done", dir: 1 };
      }
      if (s.stage !== "steps" || s.sheet || !valid(s, r)) return s;
      if (s.step === 3) return { ...s, stage: "run", run: 0, dir: 1, error: "" };
      return { ...s, step: (s.step + 1) as FlowState["step"], dir: 1 };
    }
    case "recovery_open": return { ...s, sheet: true, rec: s.rec || "new", code: s.code || a.code };
    case "recovery_close": return s.rec === "new" ? { ...s, sheet: false, rec: false, saved: false, code: "" } : { ...s, sheet: false };
    case "recovery_done": return s.saved ? { ...s, sheet: false, rec: true } : s;
    case "pick_ai": return { ...s, ai: a.ai };
    case "space_resolving": return s.stage === "connect" ? { ...s, spaceIntent: a.intent, spaceResolving: true, spaceError: "" } : s;
    case "space_resolved": return s.stage === "connect" ? { ...s, stage: s.spaceIntent === "signin" ? "signin" : "accept", si: "pw", siUser: "", siPw: "", siCode: "", spaceResolving: false, spaceError: "", error: "" } : s;
    case "space_failed": return s.stage === "connect" ? { ...s, spaceResolving: false, spaceError: a.message } : s;
    case "run_tick": return s.stage === "run" ? { ...s, run: Math.min(a.total, s.run + 1) } : s;
    case "run_done": return s.stage === "run" ? { ...s, stage: "done", dir: 1 } : s;
    case "failed": return { ...s, stage: "steps", step: 3, error: a.message, run: 0, dir: -1 };
  }
}
