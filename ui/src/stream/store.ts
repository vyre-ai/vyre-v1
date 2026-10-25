// One streaming message as a store: deltas in, a snapshot of its blocks out, one change notification per frame. The pieces are the coalescer (many deltas, one append per frame) and the
// incremental markdown (only the open block is parsed again). React reads it with useSyncExternalStore (useStream), so a change is committed in the same task as the frame that carried it.
import { createCoalescer, frameScheduler } from "./coalesce.ts";
import type { CoalescerStats, FrameScheduler } from "./coalesce.ts";
import { createIncrementalMarkdown } from "./markdown.ts";
import type { Block, MarkdownStats } from "./markdown.ts";

export interface StreamSnapshot {
  /** Final blocks first, then the open ones. The final ones keep their identity from one snapshot to the next. */
  blocks: readonly Block[];
  closedCount: number;
  /** The message is complete: no caret, nothing open. */
  done: boolean;
  /** Counts snapshots; changes once per notification. */
  version: number;
}

export interface StreamStats {
  deltas: number;
  /** Appends handed to the document: at most one per frame. */
  appends: number;
  /** Notifications sent to readers: equal to appends, plus one for end and one for reset. */
  notifications: number;
  coalescer: Readonly<CoalescerStats>;
  markdown: Readonly<MarkdownStats>;
}

export interface StreamStore {
  /** A delta of the message (any size). Shown on the next frame. */
  push(delta: string): void;
  /** The message is complete. What is waiting is shown now and the last block becomes final. */
  end(): void;
  /** Start a new message in the same store. */
  reset(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): StreamSnapshot;
  stats(): StreamStats;
}

export function createStreamStore(scheduler: FrameScheduler = frameScheduler): StreamStore {
  const md = createIncrementalMarkdown();
  const listeners = new Set<() => void>();
  let version = 0;
  let done = false;
  let appends = 0;
  let notifications = 0;
  let snapshot: StreamSnapshot = { blocks: [], closedCount: 0, done: false, version: 0 };

  function publish(): void {
    const view = md.view();
    snapshot = { blocks: view.blocks, closedCount: view.closedCount, done, version: ++version };
    notifications++;
    for (const l of [...listeners]) l();
  }

  const coalescer = createCoalescer((text) => {
    appends++;
    md.append(text);
    publish();
  }, scheduler);

  return {
    push(delta) {
      if (done) return;
      coalescer.push(delta);
    },
    end() {
      if (done) return;
      coalescer.flush();
      md.finish();
      done = true;
      publish();
    },
    reset() {
      coalescer.cancel();
      md.reset();
      done = false;
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    stats: () => ({ deltas: coalescer.stats.deltas, appends, notifications, coalescer: { ...coalescer.stats }, markdown: { ...md.stats } }),
  };
}
