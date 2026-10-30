// First launch has three doors: Just me, I was invited, Set up my team. "Set up my team" always makes the Personal Space first (so the founder has their own place), then
// offers the Team Space. Two small notes carry that across the claim screen and the shell: a wish to add a team once the Personal Space is open, and the name and username
// just claimed, so the Team claim can pre-fill them. The password is never kept, and each Space has its own recovery code.
export type Door = "me" | "invited" | "team";
export const DOORS: readonly { door: Door; title: string; help: string }[] = [
  { door: "me", title: "Just me", help: "A Personal Space on this computer" },
  { door: "invited", title: "I was invited", help: "Open an invite link or a Space address" },
  { door: "team", title: "My team", help: "Your Personal Space first, then a Team Space" },
];

export interface NoteStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
const defaultStore = (): NoteStore | undefined => { try { return (globalThis as { localStorage?: NoteStore }).localStorage; } catch { return undefined; } };
const TEAM = "vyre.onboarding.team-next.v1";
const PREFILL = "vyre.onboarding.prefill.v1";

export function wantTeamNext(on: boolean, store: NoteStore | undefined = defaultStore()): void {
  try { if (on) store?.setItem(TEAM, "1"); else store?.removeItem(TEAM); } catch { /* blocked storage: the bridge card is still on the rail */ }
}
/** True once; the note is spent when read. */
export function takeTeamNext(store: NoteStore | undefined = defaultStore()): boolean {
  try { const on = store?.getItem(TEAM) === "1"; if (on) store?.removeItem(TEAM); return on; } catch { return false; }
}

export interface Prefill { name: string; username: string; address: string }
const PREFILL_TTL_MS = 2 * 60 * 60 * 1000;
export function rememberClaimed(p: Prefill, store: NoteStore | undefined = defaultStore(), now: number = Date.now()): void {
  try { store?.setItem(PREFILL, JSON.stringify({ name: p.name, username: p.username, address: p.address, at: now })); } catch { /* optional */ }
}
/** The name and username from an earlier claim on another Space, for this address; null when none or when it is the same Space. */
export function prefillFor(address: string, store: NoteStore | undefined = defaultStore(), now: number = Date.now()): { name: string; username: string } | null {
  try {
    const p = JSON.parse(store?.getItem(PREFILL) ?? "null") as (Prefill & { at?: number }) | null;
    return p && typeof p.at === "number" && now - p.at < PREFILL_TTL_MS && typeof p.name === "string" && typeof p.username === "string" && p.address !== address ? { name: p.name, username: p.username } : null;
  } catch { return null; }
}
