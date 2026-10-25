// The Report a problem sheet's store (spec 5, 3.0). Opening it freezes the capture: the bundle shown in "What is sent" is the bundle Send submits,
// with only the optional note added. Offline, Send queues a pending reports.submit op and the sheet says so; on reconnect the queue sends in order.
import { buildBundle } from "./bundle.ts";
import type { Bundle, ReportContext, SubmitIn } from "./bundle.ts";
import type { Outbox, PendingOp } from "./outbox.ts";
import { previewRows } from "./rows.ts";
import type { PreviewRow } from "./rows.ts";
import type { Snapshot } from "./ring.ts";

export type Policy = "on" | "ask" | "off";
export type Status = "idle" | "sending" | "queued" | "sent" | "error";

export interface SubmitResult { reportId: string; taskId: string; sentToVyre: boolean }

export interface ReportDeps {
  snapshot(): Snapshot;
  versions(): Bundle["versions"];
  online(): boolean;
  /** Space policy reports.vyre. */
  policy(): Policy;
  /** reports.submit. */
  submit(input: SubmitIn): Promise<SubmitResult>;
  /** reports.send_to_vyre, used when the policy is Ask and the person said yes. */
  sendToVyre?(reportId: string): Promise<{ issueNumber?: number }>;
  /** The GitHub issue number once the report reached the Vyre team. */
  issueNumber?(reportId: string): Promise<number | undefined>;
  /** A screenshot of this window, stored as a file; returns its id. */
  captureScreenshot?(): Promise<string | undefined>;
  /** The local ring-buffer log, stored as a file; returns its id. */
  uploadLog?(lines: Snapshot["log"]): Promise<string | undefined>;
  placeName(place: string): string;
  windowSize?(): { width: number; height: number };
  outbox: Outbox;
  now?(): number;
  newId?(): string;
}

export interface ReportState {
  open: boolean;
  context: ReportContext;
  note: string;
  expanded: boolean;
  status: Status;
  bundle: Bundle | null;
  redactions: number;
  rows: readonly PreviewRow[];
  policy: Policy;
  /** Policy Ask: the person's choice to also send to the Vyre team. */
  shareWithVyre: boolean;
  reportId: string | null;
  issueNumber: number | null;
  error: string | null;
  /** Changes waiting in the outbox (title bar: "Offline, N changes waiting"). */
  waiting: number;
}

const EMPTY_CONTEXT: ReportContext = { place: "home" };

export class ReportController {
  private s: ReportState;
  private listeners = new Set<() => void>();
  private pending: Promise<unknown>[] = [];
  private screenshotFileId: string | undefined;
  private clientLogFileId: string | undefined;
  private base: { snapshot: Snapshot; versions: Bundle["versions"] } | null = null;
  private flushing: Promise<void> | null = null;

  constructor(private readonly deps: ReportDeps) {
    this.s = {
      open: false, context: EMPTY_CONTEXT, note: "", expanded: false, status: "idle", bundle: null, redactions: 0, rows: [], policy: deps.policy(),
      shareWithVyre: false, reportId: null, issueNumber: null, error: null, waiting: deps.outbox.list().length,
    };
  }

  getState = (): ReportState => this.s;
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(): void { for (const l of this.listeners) l(); }
  private set(p: Partial<ReportState>): void { this.s = { ...this.s, ...p }; }

  /** Cmd-Shift-/, the Help menu, a right-click menu's last item, or a "Report a problem" button on an error. */
  open(context: ReportContext = EMPTY_CONTEXT): void {
    this.screenshotFileId = undefined;
    this.clientLogFileId = undefined;
    // Freeze what is captured now: the screenshot of the window as it is under the sheet, the rings as they are at this moment.
    this.base = { snapshot: this.deps.snapshot(), versions: this.deps.versions() };
    this.pending = [];
    this.set({ open: true, context, note: "", expanded: false, status: "idle", reportId: null, issueNumber: null, error: null, policy: this.deps.policy(), shareWithVyre: false, waiting: this.deps.outbox.list().length });
    this.rebuild();
    if (this.deps.captureScreenshot) {
      this.pending.push(this.deps.captureScreenshot().then((id) => { this.screenshotFileId = id; this.rebuild(); this.emit(); }, () => undefined));
    }
    if (this.deps.uploadLog) {
      this.pending.push(this.deps.uploadLog(this.base.snapshot.log).then((id) => { this.clientLogFileId = id; this.rebuild(); this.emit(); }, () => undefined));
    }
    this.emit();
  }

  private rebuild(): void {
    if (!this.base) return;
    const built = buildBundle({
      context: this.s.context, snapshot: this.base.snapshot, versions: this.base.versions, note: this.s.note,
      ...(this.screenshotFileId ? { screenshotFileId: this.screenshotFileId } : {}),
      ...(this.clientLogFileId ? { clientLogFileId: this.clientLogFileId } : {}),
    });
    const win = this.deps.windowSize?.() ?? null;
    this.set({ bundle: built.bundle, redactions: built.redactions, rows: previewRows(built.bundle, this.deps.placeName(this.s.context.place), win) });
  }

  setNote(note: string): void { this.set({ note: note.slice(0, 500) }); this.rebuild(); this.emit(); }
  toggleExpanded(): void { this.set({ expanded: !this.s.expanded }); this.emit(); }
  setShare(v: boolean): void { this.set({ shareWithVyre: v }); this.emit(); }

  async send(): Promise<void> {
    if (!this.s.open || !this.s.bundle || this.s.status === "sending") return;
    await Promise.allSettled(this.pending);
    this.rebuild();
    const bundle = this.s.bundle;
    if (!bundle) return;
    const now = this.deps.now?.() ?? Date.now();
    const idem = `rpt_${this.deps.newId?.() ?? `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`}`;
    const input: SubmitIn = { bundle, idempotencyKey: idem };
    if (!this.deps.online()) {
      const op: PendingOp = { id: idem, cap: "reports.submit", input, traceId: bundle.traceIds[bundle.traceIds.length - 1] ?? null, at: now };
      this.deps.outbox.enqueue(op);
      this.set({ status: "queued", waiting: this.deps.outbox.list().length, reportId: null });
      this.emit();
      return;
    }
    this.set({ status: "sending", error: null });
    this.emit();
    try {
      const res = await this.deps.submit(input);
      const issue = await this.afterSubmit(res);
      this.set({ status: "sent", reportId: res.reportId, issueNumber: issue ?? null });
    } catch (e) {
      this.set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
    this.emit();
  }

  private async afterSubmit(res: SubmitResult): Promise<number | undefined> {
    let issue: number | undefined;
    if (this.s.policy === "ask" && this.s.shareWithVyre && !res.sentToVyre && this.deps.sendToVyre) {
      issue = (await this.deps.sendToVyre(res.reportId)).issueNumber;
    } else if (res.sentToVyre && this.deps.issueNumber) {
      issue = await this.deps.issueNumber(res.reportId).catch(() => undefined);
    }
    return issue;
  }

  /** The connection came back: send what queued, oldest first, with the bundles as they were. One failure stops the run and keeps the rest. */
  reconnect(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      for (const op of this.deps.outbox.list()) {
        try {
          const res = await this.deps.submit(op.input);
          this.deps.outbox.remove(op.id);
          if (this.s.open && this.s.status === "queued" && this.s.bundle === op.input.bundle) {
            const issue = await this.afterSubmit(res);
            this.set({ status: "sent", reportId: res.reportId, issueNumber: issue ?? null });
          }
        } catch {
          break;
        }
      }
      this.set({ waiting: this.deps.outbox.list().length });
      this.emit();
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  /** Esc, a press outside, Cancel or Done. */
  close(): void {
    if (!this.s.open) return;
    this.set({ open: false });
    this.emit();
  }

  /** The text under "Sent": who has it. */
  destination(): string {
    if (this.s.policy === "off") return "your admins have it";
    if (this.s.policy === "ask") return this.s.shareWithVyre ? "the Vyre team and your admins have it" : "your admins have it";
    return "the Vyre team and your admins have it";
  }
}
