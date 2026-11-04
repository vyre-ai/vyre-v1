// The top bar's notifications slot (owner, 4 Nov): one place, right of the search field, for every notice the shell has. The most important current notice shows as a quiet line with its one action; several
// show the top one and "+N"; the popover lists them with their actions and the recent ones below. A notice that should persist (locked, offline, an update) stays until it is resolved and has no dismiss; a
// passing one (sent, copied) shows briefly and fades. Pure: the store takes its clock, so it is tested without a window.

export type NoticeKind = "locked" | "offline" | "update" | "machine" | "approval" | "reply" | "passing";

/** Most important first. A passing notice is the newest thing to say, so it shows while it lasts. */
export const PRIORITY: Readonly<Record<NoticeKind, number>> = { locked: 1, offline: 2, update: 3, machine: 4, approval: 5, reply: 6, passing: 0 };

export interface NoticeAction { label: string; run(): void }

export interface Notice {
  id: string;
  kind: NoticeKind;
  text: string;
  action?: NoticeAction;
  /** Persisting notices stay until resolved and cannot be dismissed. */
  persist: boolean;
  at: number;
  /** A passing notice's end. */
  until?: number;
}

export interface NoticeSnapshot {
  /** Live notices, the one to show first at index 0. */
  live: readonly Notice[];
  /** The latest that passed or were resolved, newest first. */
  recent: readonly Notice[];
}

export const PASSING_MS = 3500;
const RECENT_MAX = 8;

export interface NoticeStore {
  subscribe(l: () => void): () => void;
  getSnapshot(): NoticeSnapshot;
  /** Raise (or update) a persisting notice by id. */
  raise(n: { id: string; kind: Exclude<NoticeKind, "passing">; text: string; action?: NoticeAction }): void;
  /** The notice is no longer true (unlocked, back online, updated): it goes, and shows under recent. */
  resolve(id: string): void;
  /** Something that passed: shown briefly in place of a toast, then it fades into recent. */
  pass(text: string, action?: NoticeAction): void;
  /** Fade out what has run its time. Called on a timer by the slot. */
  tick(): void;
}

const order = (a: Notice, b: Notice): number => PRIORITY[a.kind] - PRIORITY[b.kind] || b.at - a.at;

export function createNoticeStore(now: () => number = Date.now): NoticeStore {
  let live: Notice[] = [];
  let recent: Notice[] = [];
  let snap: NoticeSnapshot = { live, recent };
  const listeners = new Set<() => void>();
  let seq = 0;
  const publish = (): void => { live = [...live].sort(order); snap = { live, recent }; for (const l of [...listeners]) l(); };
  const toRecent = (n: Notice): void => { recent = [{ ...n }, ...recent.filter((r) => r.id !== n.id)].slice(0, RECENT_MAX); };
  return {
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    getSnapshot: () => snap,
    raise(n) {
      const prior = live.find((x) => x.id === n.id);
      const next: Notice = { id: n.id, kind: n.kind, text: n.text, persist: true, at: prior?.at ?? now(), ...(n.action ? { action: n.action } : {}) };
      live = [...live.filter((x) => x.id !== n.id), next];
      publish();
    },
    resolve(id) {
      const was = live.find((x) => x.id === id);
      if (!was) return;
      live = live.filter((x) => x.id !== id);
      toRecent(was);
      publish();
    },
    pass(text, action) {
      const at = now();
      const n: Notice = { id: `pass-${++seq}`, kind: "passing", text, persist: false, at, until: at + PASSING_MS, ...(action ? { action } : {}) };
      live = [...live, n];
      publish();
    },
    tick() {
      const t = now();
      const gone = live.filter((x) => !x.persist && x.until !== undefined && x.until <= t);
      if (gone.length === 0) return;
      live = live.filter((x) => !gone.includes(x));
      for (const g of gone.reverse()) toRecent(g);
      publish();
    },
  };
}

/** What the slot draws: the top notice, how many more there are, and the popover's two lists. */
export function slotView(s: NoticeSnapshot): { top: Notice | null; more: number; live: readonly Notice[]; recent: readonly Notice[]; hasLocked: boolean } {
  return { top: s.live[0] ?? null, more: Math.max(0, s.live.length - 1), live: s.live, recent: s.recent, hasLocked: s.live.some((n) => n.kind === "locked") };
}

/** The one store the shell shares: the lock, the connection, the update line and the toasts all raise here. */
export const notices: NoticeStore = createNoticeStore();
