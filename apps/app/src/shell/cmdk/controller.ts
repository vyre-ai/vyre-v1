// The Cmd-K controller: one small store the sheet and the new-tab search share (screens shell.cmdk and shell.new-tab).
// Local results are computed in the same task as the keystroke. The server request starts after a short pause, and its hits merge
// in when they arrive; a late answer for an older query is dropped. Everything the sheet does (move, choose, skin preview, filters,
// Esc) is a method here, so it is tested in node without a DOM.
import {
  SKIN_ACTION, actionRows, effectiveTypes, filterCounts, groupRows, isSelectable, isSkinQuery, mergeHits, parseQuery, stepActive,
} from "./model.ts";
import type { CmdAction, Hit, HitKind, ParsedQuery, RowModel } from "./model.ts";

export interface SkinChoice {
  id: string;
  name: string;
  /** The skin's accent, drawn as a dot before its name. */
  swatch?: string;
}

/** What the shell gives the search: the replica, the server, navigation and the theme. */
export interface CmdKData {
  /** The open Space's name: the sheet asks "Search <name>". */
  spaceName?(): string;
  /** "device": a phone, or any window offline, searches only what its replica holds and says so. */
  scope(): "space" | "device";
  online(): boolean;
  /** Replica search. Synchronous: it never waits on the network. text may be empty (browse a kind after a prefix). */
  local(text: string, types: readonly HitKind[] | null): readonly Hit[];
  /** search.query on the Space server. */
  server(text: string, types: readonly HitKind[] | null): Promise<readonly Hit[]>;
  recent(): readonly Hit[];
  actions(text: string): readonly CmdAction[];
  skins(): readonly SkinChoice[];
  currentSkin(): string;
  previewSkin(id: string | null): void;
  setSkin(id: string): void;
  open(hit: Hit, opts: { newTab: boolean }): void;
  copyLink(hit: Hit): void;
  runAction(action: CmdAction): void;
  /** search.recent.record */
  recordOpened(hit: Hit): void;
}

export type ServerStatus = "idle" | "loading" | "done" | "offline" | "error";

export interface Timings {
  /** Keystroke to local rows drawn, ms. Budget 50. */
  localMs: number | null;
  /** Keystroke to server hits merged, ms. Budget 300. */
  mergedMs: number | null;
}

export interface CmdKState {
  raw: string;
  parsed: ParsedQuery;
  filter: readonly string[];
  rows: readonly RowModel[];
  active: number;
  counts: Record<string, number>;
  serverStatus: ServerStatus;
  scope: "space" | "device";
  timings: Timings;
  open: boolean;
}

export interface CmdKOptions {
  pauseMs?: number;
  now?: () => number;
  /** Called when the sheet closes (a choice, Esc, or a press outside). */
  onClose?: () => void;
  /** Called with each timing as it is measured (the perf proof reads this). */
  onTiming?: (name: "local" | "merged", ms: number) => void;
}

const defaultNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const SERVER_PAUSE_MS = 40;

export class CmdKController {
  private s: CmdKState;
  private listeners = new Set<() => void>();
  private local: readonly Hit[] = [];
  private server: readonly Hit[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private started = 0;
  private previewing = false;
  private readonly now: () => number;
  private readonly pause: number;

  constructor(private readonly data: CmdKData, private readonly opts: CmdKOptions = {}) {
    this.now = opts.now ?? defaultNow;
    this.pause = opts.pauseMs ?? SERVER_PAUSE_MS;
    this.s = {
      raw: "", parsed: parseQuery(""), filter: [], rows: [], active: -1, counts: {}, serverStatus: "idle",
      scope: data.scope(), timings: { localMs: null, mergedMs: null }, open: true,
    };
    this.rebuild(true);
  }

  getState = (): CmdKState => this.s;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private emit(): void { for (const l of this.listeners) l(); }

  private set(patch: Partial<CmdKState>): void { this.s = { ...this.s, ...patch }; }

  /** Rebuild the rows from what is held now. Keeps the highlighted row when it is still there. */
  private rebuild(first = false): void {
    const { parsed, filter } = this.s;
    const prevKey = this.s.rows[this.s.active]?.key;
    let rows: RowModel[] = [];
    let counts: Record<string, number> = {};
    if (parsed.prefix === ">") {
      if (isSkinQuery(parsed.text)) {
        const cur = this.data.currentSkin();
        rows = [{ type: "head", key: "h-skins", title: "Skins" }, ...this.data.skins().map((k): RowModel => ({ type: "skin", key: `skin-${k.id}`, id: k.id, name: k.name, ...(k.swatch ? { swatch: k.swatch } : {}), current: k.id === cur }))];
      } else rows = actionRows(this.data.actions(parsed.text), parsed.text);
    } else if (parsed.prefix === null && parsed.text === "" && filter.length === 0) {
      const recent = this.data.recent();
      rows = recent.length ? [{ type: "head", key: "h-recent", title: "Recent" }, ...recent.slice(0, 8).map((hit): RowModel => ({ type: "hit", key: `rec-${hit.kind}:${hit.id}`, hit }))] : [];
    } else {
      const merged = mergeHits(this.local, this.server);
      counts = filterCounts(merged);
      const kinds = effectiveTypes({ ...parsed, types: null }, filter);
      const shown = kinds ? merged.filter((h) => kinds.includes(h.kind)) : merged;
      rows = groupRows(shown, parsed.prefix || filter.length ? 20 : 6);
    }
    if (!rows.length) rows = [{ type: "empty", key: "empty", title: "No results" }];
    const keep = prevKey ? rows.findIndex((r) => r.key === prevKey) : -1;
    const active = keep >= 0 ? keep : stepActive(rows, -1, "first");
    this.set({ rows, active, counts });
    if (!first) this.syncPreview();
  }

  private syncPreview(): void {
    const row = this.s.rows[this.s.active];
    if (row?.type === "skin") { this.previewing = true; this.data.previewSkin(row.id); } else this.endPreview();
  }

  private endPreview(): void {
    if (!this.previewing) return;
    this.previewing = false;
    this.data.previewSkin(null);
  }

  setRaw(raw: string): void {
    const t0 = this.now();
    this.started = t0;
    this.seq += 1;
    if (this.timer) clearTimeout(this.timer);
    const parsed = parseQuery(raw);
    const types = parsed.types;
    this.local = parsed.prefix === ">" || (parsed.prefix === null && parsed.text === "") ? [] : this.data.local(parsed.text, types);
    this.server = [];
    this.set({ raw, parsed, serverStatus: "idle", timings: { localMs: null, mergedMs: null } });
    this.rebuild();
    const localMs = this.now() - t0;
    this.set({ timings: { localMs, mergedMs: null } });
    this.opts.onTiming?.("local", localMs);
    this.mark("cmdk.local");
    this.scheduleServer(parsed);
    this.emit();
  }

  private scheduleServer(parsed: ParsedQuery): void {
    const wants = parsed.prefix !== ">" && (parsed.text !== "" || parsed.prefix !== null);
    if (!wants) return;
    if (!this.data.online() || this.data.scope() === "device") { this.set({ serverStatus: "offline" }); return; }
    const mine = this.seq;
    this.set({ serverStatus: "loading" });
    this.timer = setTimeout(() => {
      this.data.server(parsed.text, parsed.types).then((hits) => {
        if (mine !== this.seq || !this.s.open) return;
        this.server = hits;
        const mergedMs = this.now() - this.started;
        this.set({ serverStatus: "done", timings: { ...this.s.timings, mergedMs } });
        this.rebuild();
        this.opts.onTiming?.("merged", mergedMs);
        this.mark("cmdk.merged");
        this.emit();
      }, () => {
        if (mine !== this.seq) return;
        this.set({ serverStatus: "error" });
        this.emit();
      });
    }, this.pause);
  }

  private mark(name: string): void {
    const p = (globalThis as { performance?: { mark?: (n: string) => void } }).performance;
    try { p?.mark?.(name); } catch { /* marks are optional */ }
  }

  toggleFilter(id: string): void {
    const f = this.s.filter.includes(id) ? this.s.filter.filter((x) => x !== id) : [...this.s.filter, id];
    this.set({ filter: f });
    // A filter on an empty box browses that kind from the replica.
    if (this.s.parsed.prefix === null && this.s.parsed.text === "") this.local = f.length ? this.data.local("", effectiveTypes({ ...this.s.parsed, types: null }, f)) : [];
    this.rebuild();
    this.emit();
  }

  clearFilter(): void {
    this.set({ filter: [] });
    this.local = this.s.parsed.text === "" && this.s.parsed.prefix === null ? [] : this.local;
    this.rebuild();
    this.emit();
  }

  move(dir: 1 | -1 | "first" | "last"): void {
    this.set({ active: stepActive(this.s.rows, this.s.active, dir) });
    this.syncPreview();
    this.emit();
  }

  hover(index: number): void {
    const r = this.s.rows[index];
    if (!r || !isSelectable(r) || index === this.s.active) return;
    this.set({ active: index });
    this.syncPreview();
    this.emit();
  }

  /** Enter (newTab false) or Cmd-Enter (newTab true) on the highlighted row, or a click on a row. */
  choose(index: number = this.s.active, newTab = false): void {
    const r = this.s.rows[index];
    if (!r || !isSelectable(r)) return;
    if (r.type === "skin") {
      this.endPreview();
      this.data.setSkin(r.id);
      this.close();
      return;
    }
    if (r.type === "action") {
      if (r.action.key === SKIN_ACTION) { this.setRaw("> skin "); return; }
      this.close();
      this.data.runAction(r.action);
      return;
    }
    if (r.type === "hit") {
      this.close();
      this.data.recordOpened(r.hit);
      this.data.open(r.hit, { newTab });
    }
  }

  hitAt(index: number): Hit | null {
    const r = this.s.rows[index];
    return r?.type === "hit" ? r.hit : null;
  }

  copyLink(index: number): void {
    const h = this.hitAt(index);
    if (h) this.data.copyLink(h);
  }

  /** Esc, a press outside, or a choice. A skin being previewed goes back to the person's own. */
  close(): void {
    if (!this.s.open) return;
    this.endPreview();
    if (this.timer) clearTimeout(this.timer);
    this.seq += 1;
    this.set({ open: false });
    this.opts.onClose?.();
    this.emit();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.seq += 1;
    this.endPreview();
    this.listeners.clear();
  }
}
