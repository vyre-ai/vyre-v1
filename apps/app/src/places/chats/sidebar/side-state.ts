// What the sidebar keeps per person (design 2.4, lead's ruling 13 Nov): which sections are folded, the pins and their manual order, the last Notes / Artifacts tab. None of it lives here: the `state` module (lane b-state) owns it
// as a pin flag with a manual order and a small layout store with registered keys (`chats.sidebar.folds`, `chats.notes_tab`). This file is the typed port the sidebar is built against, a test double with the
// same rules, and the pure order rules. When b-state clears review, a port backed by the module replaces `memorySideState` at one place; nothing else changes.
import type { SectionId } from "./layout.ts";

export type NotesTab = "notes" | "artifacts";
export const FOLDABLE: readonly SectionId[] = ["needs", "goals", "pinned", "chats", "channels", "team"];

export interface SideStatePort {
  folds(): ReadonlySet<SectionId>;
  setFold(section: SectionId, folded: boolean): void;
  /** Pinned item keys in the person's order. */
  pins(): readonly string[];
  /** Pin at the end, or at an index. A key already pinned stays where it is unless an index is given, then it moves there. */
  pin(key: string, at?: number): void;
  unpin(key: string): void;
  unpinAll(): void;
  /** Reorder inside Pinned only. */
  move(key: string, to: number): void;
  notesTab(): NotesTab;
  setNotesTab(tab: NotesTab): void;
  subscribe(f: () => void): () => void;
}

/** The new order after moving `key` to index `to` of the list (clamped); a key not in the list is left out of the change. */
export function moved(list: readonly string[], key: string, to: number): string[] {
  const i = list.indexOf(key);
  if (i < 0) return [...list];
  const out = list.filter((k) => k !== key);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, key);
  return out;
}

/** The test double: same rules as the module will have, in memory. */
export function memorySideState(
  init: { folds?: readonly SectionId[]; pins?: readonly string[]; notesTab?: NotesTab } = {},
): SideStatePort {
  let folds = new Set<SectionId>(init.folds ?? []);
  let pins = [...(init.pins ?? [])];
  let tab: NotesTab = init.notesTab ?? "notes";
  const ls = new Set<() => void>();
  const tell = (): void => {
    for (const f of [...ls]) f();
  };
  return {
    folds: () => folds,
    setFold(section, folded) {
      if (folds.has(section) === folded) return;
      folds = new Set(folded ? [...folds, section] : [...folds].filter((s) => s !== section));
      tell();
    },
    pins: () => pins,
    pin(key, at) {
      pins =
        at === undefined && pins.includes(key)
          ? pins
          : moved([...pins.filter((k) => k !== key), key], key, at ?? pins.length);
      tell();
    },
    unpin(key) {
      if (!pins.includes(key)) return;
      pins = pins.filter((k) => k !== key);
      tell();
    },
    unpinAll() {
      if (pins.length === 0) return;
      pins = [];
      tell();
    },
    move(key, to) {
      const next = moved(pins, key, to);
      if (next.join("\n") === pins.join("\n")) return;
      pins = next;
      tell();
    },
    notesTab: () => tab,
    setNotesTab(t) {
      if (t === tab) return;
      tab = t;
      tell();
    },
    subscribe(f) {
      ls.add(f);
      return () => void ls.delete(f);
    },
  };
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
const FOLD_KEY = (space: string): string => `vyre.sidebar.v2.${space}`;

/**
 * Today's source behind the port: folds and the notes tab are kept on this device, per Space (the per-person state module replaces this one line when it is on main). Pins are not here: they are the server's answer (the caller's own
 * pins in order, read through chats.sidebar) and a pin is written through the sidebar's actions. Without storage it is the in-memory double.
 */
export function deviceSideState(space: string, store: Store | null): SideStatePort {
  if (!store) return memorySideState();
  let raw: { folds?: string[]; tab?: string } = {};
  try {
    raw = JSON.parse(store.getItem(FOLD_KEY(space)) ?? "{}") as typeof raw;
  } catch {
    raw = {};
  }
  const inner = memorySideState({
    folds: (raw.folds ?? []).filter((x): x is SectionId => (FOLDABLE as readonly string[]).includes(x)),
    notesTab: raw.tab === "artifacts" ? "artifacts" : "notes",
  });
  inner.subscribe(() => {
    try {
      store.setItem(FOLD_KEY(space), JSON.stringify({ folds: [...inner.folds()], tab: inner.notesTab() }));
    } catch {
      /* a full or blocked store keeps the in-memory state */
    }
  });
  return inner;
}
