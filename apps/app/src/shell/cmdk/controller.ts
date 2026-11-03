// The Cmd-K controller: one small store the sheet and the new-tab search share (screens shell.cmdk and shell.new-tab).
// Local results are computed in the same task as the keystroke. The server request starts after a short pause, and its hits merge
// in when they arrive; a late answer for an older query is dropped. Everything the sheet does (move, choose, skin preview, filters,
// Esc) is a method here, so it is tested in node without a DOM.
import {
  SKIN_ACTION, actionRows, answerParts, answerText, askable, effectiveTypes, filterCounts, groupRows, isQuestion, isSelectable, isSkinQuery, mergeHits, parseQuery, plainLength, searchText, stepActive,
} from "./model.ts";
import type { AskAnswer, AskSource, CmdAction, Hit, HitKind, ParsedQuery, RowModel } from "./model.ts";

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
  /** Ask the Space (search.ask): the question answered from what the person may read, on their own AI account. Absent: the search offers no Ask row (a device with no Space to ask). */
  ask?(question: string): Promise<AskAnswer>;
  /** Continue in a chat: a real chat with the assistant, seeded with the question and the answer, opened where the person is. */
  continueInChat?(chat: { question: string; answer: string }): void;
  /** Copy the answer's text. */
  copyText?(text: string): void;
}

export type ServerStatus = "idle" | "loading" | "done" | "offline" | "error";

export interface Timings {
  /** Keystroke to local rows drawn, ms. Budget 50. */
  localMs: number | null;
  /** Keystroke to server hits merged, ms. Budget 300. */
  mergedMs: number | null;
}

/** The answer view (Ask the Space). "working": the question is out; "streaming": the answer is being written onto the page; then it stands. */
export interface AskState {
  question: string;
  phase: "working" | "streaming" | "answered" | "no_access" | "no_account" | "failed";
  text: string;
  /** Characters of the text shown so far. */
  shown: number;
  sources: readonly AskSource[];
  cited: readonly number[];
  account?: { title: string; mine: boolean };
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
  /** Set while the answer view is showing; null in the ordinary results. */
  ask: AskState | null;
}

export interface CmdKOptions {
  pauseMs?: number;
  now?: () => number;
  /** Called when the sheet closes (a choice, Esc, or a press outside). */
  onClose?: () => void;
  /** Called with each timing as it is measured (the perf proof reads this). */
  onTiming?: (name: "local" | "merged", ms: number) => void;
  /** Milliseconds between steps of the answer being written onto the page; 0 shows it whole at once. */
  revealMs?: number;
}

const defaultNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const SERVER_PAUSE_MS = 40;
/** The answer is written onto the page a few characters at a time, so it reads as it arrives. */
export const REVEAL_MS = 24;
const REVEAL_STEP = 2;

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
  private reveal: ReturnType<typeof setInterval> | null = null;
  private askSeq = 0;

  constructor(private readonly data: CmdKData, private readonly opts: CmdKOptions = {}) {
    this.now = opts.now ?? defaultNow;
    this.pause = opts.pauseMs ?? SERVER_PAUSE_MS;
    this.s = {
      raw: "", parsed: parseQuery(""), filter: [], rows: [], active: -1, counts: {}, serverStatus: "idle",
      scope: data.scope(), timings: { localMs: null, mergedMs: null }, open: true, ask: null,
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
    if (this.s.ask) {
      // the answer view lists the sources once the answer has been written (the arrows move through them, Enter opens one)
      const a = this.s.ask;
      const settled = a.phase === "answered" || a.phase === "no_account" || a.phase === "failed";
      rows = settled && a.sources.length > 0 ? [{ type: "head", key: "h-sources", title: "Sources" }, ...a.sources.map((source): RowModel => ({ type: "source", key: `src-${source.n}`, source }))] : [];
      const keep0 = prevKey ? rows.findIndex((r) => r.key === prevKey) : -1;
      this.set({ rows, active: keep0 >= 0 ? keep0 : stepActive(rows, -1, "first"), counts: {} });
      return;
    }
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
      // Ask the Space sits with the hits: first, and the highlighted row, for a question; last for a plain phrase. Never with a type filter or without a Space to ask.
      if (this.data.ask && filter.length === 0 && askable(parsed) && this.data.scope() === "space" && this.data.online()) {
        const ask: RowModel[] = [{ type: "head", key: "h-ask", title: "Ask" }, { type: "ask", key: "ask", question: parsed.text.trim() }];
        rows = isQuestion(parsed.text) || rows.length === 0 ? [...ask, ...rows] : [...rows, ...ask];
      }
    }
    // Nothing typed and nothing recent is not a search with no results: the field stands alone until there is something to say.
    const asked = parsed.prefix !== null || parsed.text !== "" || filter.length > 0;
    if (!rows.length && asked) rows = [{ type: "empty", key: "empty", title: "No results" }];
    // the Ask row is not a place to stay: the highlight starts again at the top, where Ask is for a question and the best hit is not
    const keep = prevKey && prevKey !== "ask" ? rows.findIndex((r) => r.key === prevKey) : -1;
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
    if (this.s.ask) this.endAsk();
    const t0 = this.now();
    this.started = t0;
    this.seq += 1;
    if (this.timer) clearTimeout(this.timer);
    const parsed = parseQuery(raw);
    const types = parsed.types;
    this.local = parsed.prefix === ">" || (parsed.prefix === null && parsed.text === "") ? [] : this.data.local(searchText(parsed), types);
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
      this.data.server(searchText(parsed), parsed.types).then((hits) => {
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
    if (r.type === "ask") { void this.startAsk(r.question); return; }
    if (r.type === "source") {
      this.close();
      this.data.recordOpened(r.source);
      this.data.open(r.source, { newTab });
      return;
    }
    if (r.type === "hit") {
      this.close();
      this.data.recordOpened(r.hit);
      this.data.open(r.hit, { newTab });
    }
  }

  /** Enter on the Ask the Space row: the question goes out, and the view turns into the answer. */
  async startAsk(question: string): Promise<void> {
    const ask = this.data.ask;
    if (!ask || this.s.ask) return;
    const mine = ++this.askSeq;
    this.set({ ask: { question, phase: "working", text: "", shown: 0, sources: [], cited: [] } });
    this.rebuild();
    this.emit();
    let out: AskAnswer;
    try { out = await ask(question); } catch { out = { state: "failed", sources: [], cited: [] }; }
    if (mine !== this.askSeq || !this.s.ask) return;
    const text = out.answer ?? "";
    const base = { question, text, shown: 0, sources: out.sources, cited: out.cited, ...(out.account ? { account: out.account } : {}) };
    if (out.state !== "answered") {
      this.set({ ask: { ...base, phase: out.state, shown: text.length } });
    } else if ((this.opts.revealMs ?? REVEAL_MS) === 0) {
      this.set({ ask: { ...base, phase: "answered", shown: plainLength(answerParts(text)) } });
    } else {
      this.set({ ask: { ...base, phase: "streaming" } });
      const total = plainLength(answerParts(text));
      this.reveal = setInterval(() => {
        const a = this.s.ask;
        if (!a || mine !== this.askSeq) { this.stopReveal(); return; }
        const shown = Math.min(total, a.shown + REVEAL_STEP);
        this.set({ ask: shown >= total ? { ...a, phase: "answered", shown } : { ...a, shown } });
        if (shown >= total) { this.stopReveal(); this.rebuild(); }
        this.emit();
      }, this.opts.revealMs ?? REVEAL_MS);
    }
    this.rebuild();
    this.emit();
  }

  private stopReveal(): void { if (this.reveal) { clearInterval(this.reveal); this.reveal = null; } }

  private endAsk(): void {
    this.askSeq += 1;
    this.stopReveal();
    this.set({ ask: null });
  }

  /** Esc: from the answer back to the results with the question still in the field; from the results, close. */
  escape(): void {
    if (!this.s.ask) { this.close(); return; }
    this.endAsk();
    this.rebuild();
    this.emit();
  }

  /** The number on a citation: open that source. */
  openCitation(n: number): void {
    const i = this.s.rows.findIndex((r) => r.type === "source" && r.source.n === n);
    if (i >= 0) this.choose(i, false);
    else { const src = this.s.ask?.sources.find((x) => x.n === n); if (src) { this.close(); this.data.recordOpened(src); this.data.open(src, { newTab: false }); } }
  }

  copyAnswer(): void {
    const a = this.s.ask;
    if (a && a.phase === "answered") this.data.copyText?.(answerText({ answer: a.text, sources: [...a.sources], cited: [...a.cited] }));
  }

  /** Continue in a chat: the question and the answer open as a real chat with the assistant. */
  continueInChat(): void {
    const a = this.s.ask;
    if (!a || a.phase !== "answered" || !this.data.continueInChat) return;
    const chat = { question: a.question, answer: answerText({ answer: a.text, sources: [...a.sources], cited: [...a.cited] }) };
    this.close();
    this.data.continueInChat(chat);
  }

  hitAt(index: number): Hit | null {
    const r = this.s.rows[index];
    return r?.type === "hit" ? r.hit : r?.type === "source" ? r.source : null;
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
    this.endAsk();
    this.set({ open: false });
    this.opts.onClose?.();
    this.emit();
  }

  dispose(): void {
    this.stopReveal();
    if (this.timer) clearTimeout(this.timer);
    this.seq += 1;
    this.endPreview();
    this.listeners.clear();
  }
}
