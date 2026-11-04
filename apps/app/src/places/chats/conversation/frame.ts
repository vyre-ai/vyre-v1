// A conversation drawn inside another page's frame (a project's Chat tab): the page's own header is the only header, so the conversation draws none and hands its controls up (find, pane, helpers,
// stop, and the entries of its More menu) through this store. The page draws them in its header and appends the entries to its own More menu; nothing is copied, the entries are the conversation's.
import { createContext, useContext } from "react";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";

export interface FrameControls {
  find: { active: boolean; toggle(): void };
  pane: { toggle(): void };
  helpers: { label: string; badge: number; onPress(x: number, y: number): void } | null;
  stop: { label: string; onPress(x: number, y: number): void } | null;
  /** The conversation's More menu: Plan Mode, Open the agent's Page, Fork, Export, Stop All, Agents reply in threads... */
  chatEntries(): MenuEntry[];
}

export interface FrameStore {
  get(): FrameControls | null;
  set(c: FrameControls | null): void;
  subscribe(l: () => void): () => void;
  /** Moves when something the header draws changes, not on every render of the conversation. */
  version(): number;
}

export function createFrameStore(): FrameStore {
  let cur: FrameControls | null = null;
  let sig = "";
  let v = 0;
  const ls = new Set<() => void>();
  return {
    get: () => cur,
    set(c) {
      cur = c;
      const next = c === null ? "" : JSON.stringify([c.find.active, c.helpers?.label, c.helpers?.badge, c.stop?.label]);
      if (next === sig) return;
      sig = next; v += 1;
      for (const l of [...ls]) l();
    },
    subscribe(l) { ls.add(l); return () => { ls.delete(l); }; },
    version: () => v,
  };
}

const InProject = createContext<FrameStore | null>(null);
export const InProjectFrame = InProject.Provider;
export const useFrameStore = (): FrameStore | null => useContext(InProject);
