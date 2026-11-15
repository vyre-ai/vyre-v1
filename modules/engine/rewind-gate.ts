// A rewind and a turn of the same agent in the same chat must never run together: the turn writes into the folder the rewind is putting back, and two rewinds of one folder write over each other.
//   - one rewind at a time per (chat, agent): a second "go back" (or an Undo) is refused while one is going back;
//   - while a rewind is going back, that agent's turn starts WAIT here (the turn start already awaits its checkpoint). The wait has no end of its own: the person's message stays where it is, one plain line says so,
//     and the turn starts by itself when the gate opens;
//   - the only other way the gate opens is that the rewind made no progress for HUNG_MS: it is given up on (its row stays "going back", which the chat lists as interrupted with Undo) and the turn starts.
interface Hold {
  done: Promise<void>;
  open: () => void;
  progressAt: number;
}
const held = new Map<string, Hold>();
const key = (threadId: string, agentId: string): string => `${threadId}|${agentId}`;

/** No step of a rewind for this long and it is taken to have hung. */
export const HUNG_MS = 5 * 60_000;
/** How long a waiting turn waits before it says so (and again looks whether the rewind hung). */
export const SLICE_MS = 20_000;

export interface Rewinding {
  /** The rewind did something: it is not hung. */
  progress(): void;
  release(): void;
}

/** The rewind is going back for this agent in this chat. Null when another one is: there is one at a time. A hold that made no progress for HUNG_MS is taken over. */
export function holdTurns(threadId: string, agentId: string, now: () => number = Date.now): Rewinding | null {
  const k = key(threadId, agentId);
  const cur = held.get(k);
  if (cur) {
    if (now() - cur.progressAt <= HUNG_MS) return null;
    cur.open();
    held.delete(k);
  }
  let open = (): void => undefined;
  const done = new Promise<void>((r) => (open = r));
  const mine: Hold = { done, open, progressAt: now() };
  held.set(k, mine);
  return {
    progress: () => void (mine.progressAt = now()),
    release: () => {
      mine.open();
      if (held.get(k) === mine) held.delete(k);
    },
  };
}

/** Whether a rewind is going back for this agent here now. */
export const isHeld = (threadId: string, agentId: string): boolean => held.has(key(threadId, agentId));

/**
 * A turn about to start: waits while a rewind holds this agent in this chat. "free" when nothing held it, "waited" when the rewind finished, "gave_up" when the rewind made no progress for HUNG_MS and was given up on.
 * `onWait` is called once, the first time a slice passes with the rewind still going: the caller says the one plain line.
 */
export async function turnMayStart(
  threadId: string,
  agentId: string,
  o: { sliceMs?: number; onWait?: () => void; now?: () => number } = {},
): Promise<"free" | "waited" | "gave_up"> {
  const now = o.now ?? Date.now;
  let told = false;
  let waited = false;
  for (;;) {
    const h = held.get(key(threadId, agentId));
    if (!h) return waited ? "waited" : "free";
    waited = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      h.done.then(() => "done" as const),
      new Promise<"slice">((res) => {
        timer = setTimeout(() => res("slice"), o.sliceMs ?? SLICE_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (r === "done") continue;
    if (now() - h.progressAt > HUNG_MS) {
      h.open();
      if (held.get(key(threadId, agentId)) === h) held.delete(key(threadId, agentId));
      return "gave_up";
    }
    if (!told) {
      told = true;
      o.onWait?.();
    }
  }
}
