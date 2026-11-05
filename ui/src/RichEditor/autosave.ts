// Autosave for the Markdown editor: a pause after the last edit saves the text as a new version, one save at a time, the text that arrived meanwhile saved next.
// The save is the host's (files.save with the version the draft started from); this only decides when, never touches the network itself, and keeps the one thing the header shows:
// Saving, Saved with the version number, or the words of a refusal. Undo is the host's too: it restores the version before. Pure, so a test drives it with a clock.

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type SaveResult = { ok: true; version: number } | { ok: false; error: string };

export interface AutosaveOptions {
  /** Quiet time after an edit before the save starts. */
  delay: number;
  /** Saves `text` as a new version. Rejection is treated as an error line. */
  save: (text: string) => Promise<SaveResult>;
  /** The text the file has now and its version number: nothing to save until the text differs. */
  saved: { text: string; version: number };
  /** The clock; a test passes its own. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export interface AutosaveState {
  status: AutosaveStatus;
  /** The version the file is at (the last save's). */
  version: number;
  /** The words of the last refusal, when status is "error". */
  error: string | null;
  /** The version before the last save, for Undo; null when nothing was saved here yet. */
  undoTo: number | null;
}

export class Autosaver {
  private opts: AutosaveOptions;
  private text: string;
  private base: string;
  private timer: unknown = null;
  private running = false;
  private subs = new Set<(s: AutosaveState) => void>();
  state: AutosaveState;

  constructor(opts: AutosaveOptions) {
    this.opts = opts;
    this.text = opts.saved.text;
    this.base = opts.saved.text;
    this.state = { status: "idle", version: opts.saved.version, error: null, undoTo: null };
  }

  subscribe(fn: (s: AutosaveState) => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private set(p: Partial<AutosaveState>): void { this.state = { ...this.state, ...p }; for (const f of this.subs) f(this.state); }

  /** The text the host has been given from outside (a restore, an agent's change): the editor shows it, nothing is pending. */
  reset(saved: { text: string; version: number }): void {
    this.clear();
    this.text = saved.text;
    this.base = saved.text;
    this.set({ status: "idle", version: saved.version, error: null });
  }

  /** The editor's text changed. */
  edit(text: string): void {
    this.text = text;
    if (text === this.base && !this.running) { this.clear(); this.set({ status: this.state.undoTo !== null ? "saved" : "idle", error: null }); return; }
    this.set({ status: this.running ? "saving" : "dirty", error: null });
    this.clear();
    const set = this.opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.timer = set(() => { void this.flush(); }, this.opts.delay);
  }

  private clear(): void {
    if (this.timer === null) return;
    (this.opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  /** Save now (Cmd+S, leaving the page, closing the tab). Resolves when nothing is left to save or the save was refused. */
  async flush(): Promise<void> {
    this.clear();
    if (this.running) return;
    while (this.text !== this.base) {
      const sending = this.text;
      this.running = true;
      this.set({ status: "saving" });
      let r: SaveResult;
      try { r = await this.opts.save(sending); } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : "Could not save." }; }
      this.running = false;
      if (!r.ok) { this.set({ status: "error", error: r.error }); return; }
      const before = this.state.version;
      this.base = sending;
      this.set({ status: this.text === this.base ? "saved" : "dirty", version: r.version, error: null, undoTo: before });
    }
  }

  /** After an Undo the host restores the version before: the editor takes that text and the file is at that version. */
  undone(text: string, version: number): void { this.clear(); this.text = text; this.base = text; this.set({ status: "idle", version, error: null, undoTo: null }); }

  destroy(): void { this.clear(); this.subs.clear(); }
}
