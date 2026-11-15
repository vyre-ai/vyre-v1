// Which chats have an agent at work (owner, rc.28 report, 16 Nov 2026): a chat's tab shows the working mark while its agent, or the helpers and jobs it left running in the background, work. One store
// for the whole app: the session fills it from engine.now (read when the Space changes, and every 15 s while anything works), the tab strip reads it. The mark is still under reduced motion.
import { parseHash, subjectOf } from "../hash/hash.ts";

type Listener = () => void;
let working: ReadonlySet<string> = new Set();
const listeners = new Set<Listener>();

export const workingThreads = (): ReadonlySet<string> => working;
export const subscribeWorking = (l: Listener): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export function setWorkingThreads(next: Iterable<string>): void {
  const set = new Set(next);
  if (set.size === working.size && [...set].every((x) => working.has(x))) return;
  working = set;
  for (const l of [...listeners]) l();
}

/** The chat a tab shows, from its hash (`screen=chats.conversation&threadId=` or a thread subject); undefined for any other tab. */
export function threadOfTab(tab: { hash?: string }): string | undefined {
  if (tab.hash === undefined || tab.hash === "") return undefined;
  const s = subjectOf(parseHash(tab.hash));
  return s !== undefined && s.type === "thread" ? s.id : undefined;
}

export const WORKING_REFRESH_MS = 15_000;
export const WORKING_QUIET_MS = 1_000;

/** Fill the store from engine.now: once, again a second after the Space changes, and every 15 s. Returns how to stop. */
export function watchWorking(src: {
  call(cap: string, input: unknown): Promise<unknown>;
  onInvalidate(l: () => void): () => void;
}): () => void {
  let stopped = false;
  let wait: ReturnType<typeof setTimeout> | null = null;
  const read = (): void => {
    void src.call("engine.now", {}).then(
      (out) => {
        if (stopped) return;
        const rows = (out as { working?: Array<{ threadId?: string }> } | null)?.working ?? [];
        setWorkingThreads(rows.flatMap((r) => (typeof r.threadId === "string" ? [r.threadId] : [])));
      },
      () => undefined,
    );
  };
  read();
  const every = setInterval(read, WORKING_REFRESH_MS);
  (every as { unref?: () => void }).unref?.();
  const off = src.onInvalidate(() => {
    if (wait === null)
      wait = setTimeout(() => {
        wait = null;
        read();
      }, WORKING_QUIET_MS);
  });
  return () => {
    stopped = true;
    clearInterval(every);
    if (wait !== null) clearTimeout(wait);
    off();
    setWorkingThreads([]);
  };
}
