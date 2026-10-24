// Where the service keeps things. Object storage holds each report's bundle and screenshot; a small database holds the Spaces that are
// registered, one row per report, and the replay guard. Both are interfaces with a directory-backed version (a Railway volume) and an
// in-memory one for tests. A Postgres version is a drop-in for ReportDb when the service outgrows one volume.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

const KEY = /^[a-z0-9][a-z0-9_./-]{0,200}$/;
const safeKey = (key: string): string => {
  if (!KEY.test(key) || key.includes("..") || key.includes("//") || key.endsWith("/")) throw new Error("bad object key");
  return key;
};

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> { this.objects.set(safeKey(key), { bytes: bytes.slice(), contentType }); }
  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const o = this.objects.get(safeKey(key));
    return o ? { bytes: o.bytes.slice(), contentType: o.contentType } : null;
  }
}

/** Objects as files under a directory; the content type rides in a sidecar file. */
export class DirObjectStore implements ObjectStore {
  private readonly dir: string;
  constructor(dir: string) { this.dir = dir; }
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const path = join(this.dir, safeKey(key));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, bytes);
    await rename(`${path}.tmp`, path);
    await writeFile(`${path}.type`, contentType);
  }
  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const path = join(this.dir, safeKey(key));
    try {
      const bytes = new Uint8Array(await readFile(path));
      const contentType = await readFile(`${path}.type`, "utf8").catch(() => "application/octet-stream");
      return { bytes, contentType };
    } catch {
      return null;
    }
  }
}

export type Status = "stored" | "sent" | "resolved";

export interface SpaceRow { spaceId: string; publicKey: string; webhook: string; registeredAt: number }

export interface ReportRow {
  reportId: string;
  spaceId: string;
  status: Status;
  title: string;
  traceIds: string[];
  issueNumber: number | null;
  issueUrl: string | null;
  /** the record id in the Vyre team's Space, or null while it is still to be filed */
  teamRecordId: string | null;
  /** the secret in the screenshot and bundle links an issue carries */
  viewToken: string;
  createdAt: number;
  resolvedAt: number | null;
  fixedIn: string | null;
  /** the resolved notice has reached the reporter Space */
  notified: boolean;
}

export interface ReportDb {
  getSpace(spaceId: string): Promise<SpaceRow | null>;
  putSpace(row: SpaceRow): Promise<void>;
  getReport(reportId: string): Promise<ReportRow | null>;
  putReport(row: ReportRow): Promise<void>;
  byIssue(issueNumber: number): Promise<ReportRow | null>;
  /** reports still owing the team record, the issue or the resolved notice */
  pending(): Promise<ReportRow[]>;
  /** true the first time a signature is seen inside its window */
  firstSight(sig: string, until: number, now: number): Promise<boolean>;
}

interface Doc { spaces: Record<string, SpaceRow>; reports: Record<string, ReportRow>; seen: Record<string, number> }

export class MemoryDb implements ReportDb {
  protected doc: Doc = { spaces: {}, reports: {}, seen: {} };
  protected async save(): Promise<void> { /* memory only */ }
  async getSpace(spaceId: string): Promise<SpaceRow | null> { const r = this.doc.spaces[spaceId]; return r ? { ...r } : null; }
  async putSpace(row: SpaceRow): Promise<void> { this.doc.spaces[row.spaceId] = { ...row }; await this.save(); }
  async getReport(reportId: string): Promise<ReportRow | null> { const r = this.doc.reports[reportId]; return r ? { ...r, traceIds: [...r.traceIds] } : null; }
  async putReport(row: ReportRow): Promise<void> { this.doc.reports[row.reportId] = { ...row, traceIds: [...row.traceIds] }; await this.save(); }
  async byIssue(issueNumber: number): Promise<ReportRow | null> {
    const r = Object.values(this.doc.reports).find((x) => x.issueNumber === issueNumber);
    return r ? { ...r, traceIds: [...r.traceIds] } : null;
  }
  async pending(): Promise<ReportRow[]> {
    return Object.values(this.doc.reports)
      .filter((r) => r.issueNumber === null || r.teamRecordId === null || (r.status === "resolved" && !r.notified))
      .map((r) => ({ ...r, traceIds: [...r.traceIds] }));
  }
  async firstSight(sig: string, until: number, now: number): Promise<boolean> {
    for (const [k, v] of Object.entries(this.doc.seen)) if (v <= now) delete this.doc.seen[k];
    if (this.doc.seen[sig] !== undefined) return false;
    this.doc.seen[sig] = until;
    await this.save();
    return true;
  }
}

/** The same rows in one JSON file, written whole through a temp file and a rename so a crash leaves the old file or the new one. */
export class FileDb extends MemoryDb {
  private readonly path: string;
  private constructor(path: string) { super(); this.path = path; }
  static async open(path: string): Promise<FileDb> {
    const db = new FileDb(path);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<Doc>;
      db.doc = { spaces: parsed.spaces ?? {}, reports: parsed.reports ?? {}, seen: parsed.seen ?? {} };
    } catch { /* a new file */ }
    return db;
  }
  protected override async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(`${this.path}.tmp`, JSON.stringify(this.doc));
    await rename(`${this.path}.tmp`, this.path);
  }
}
