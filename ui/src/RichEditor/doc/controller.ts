// The link between a document page and anything beside it that lists its suggestions (the side pane): the page tells the controller what is waiting, the pane tells it what to do.
import type { Change } from "./track.ts";

export interface DocActions {
  accept(c: Change): void;
  reject(c: Change): void;
  acceptAll(): void;
  rejectAll(): void;
  /** Put the caret on a change and bring it into view. */
  goTo(c: Change): void;
}

export class DocController {
  changes: Change[] = [];
  actions: DocActions | null = null;
  private subs = new Set<() => void>();
  set(list: Change[]): void {
    this.changes = list;
    for (const f of this.subs) f();
  }
  subscribe(f: () => void): () => void {
    this.subs.add(f);
    return () => {
      this.subs.delete(f);
    };
  }
}
