// A hand-built Ctx for the mounts tests: MemoryDb over the real migration, a fake files module (folders, files, versions, Trash), a fake Google Drive and Microsoft Graph that serve the recorded
// pages in fixtures/drive and fixtures/graph, a fake git module and a scripted settings module.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx, Decision, ResourceRef } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName } from "../../../packages/contracts/src/types.ts";
import { MemoryDb } from "./db.ts";
/**
 * The capabilities the host refuses without an idempotency key (host/src/invoke.ts: a "key" capability needs the key), read from the real manifests. The fake provider and Files calls refuse the
 * same way, so a write the engine sends without a key fails here as it does on a booted daemon (15 Nov 2026: every Drive and Graph write the engine made was refused there and passed here).
 */
function capDoc(cap: string): string {
  try {
    return readFileSync(join(here, "../../../generated/docs/capabilities", `${cap}.md`), "utf8");
  } catch {
    return "";
  }
}
const keyedCache = new Map<string, boolean>();
/** Whether the host demands an idempotency key for the capability (its generated page says `Idempotency | key`). */
export function needsKey(cap: string): boolean {
  let v = keyedCache.get(cap);
  if (v === undefined) {
    v = /\| Idempotency \| key \|/.test(capDoc(cap));
    keyedCache.set(cap, v);
  }
  return v;
}
/** The events a capability declares it may emit (its generated page). */
export function emitsOf(cap: string): string[] {
  const m = /\| Emits \| ([^|\n]*) \|/.exec(capDoc(cap));
  return m?.[1] ? m[1].split(",").map((x) => x.trim()) : [];
}

export const NOW = 1_760_000_000_000;
/** the work address the person who makes a mount is matched to; every Drive and Graph call is made as it */
export const ME = "noah@firm.test";
export const TRACE = "0123456789abcdef0123456789abcdef";
const here = dirname(fileURLToPath(import.meta.url));

type Row = Record<string, unknown>;
export interface Emitted {
  name: string;
  subject: string;
  payload: unknown;
}
export interface Scheduled {
  at: number | string;
  cap: string;
  input: unknown;
}

export const recorded = (file: string): Row => JSON.parse(readFileSync(join(here, file), "utf8")) as Row;

export function vyreErr(code: string, message: string, retryable = false): VyreErr {
  return new VyreErr({
    code: code as never,
    message,
    retryable,
    traceId: TRACE,
    next: [{ kind: "report", label: "Report a problem" }],
  });
}

// ---- the files module ---------------------------------------------------------------------------------------

export interface FFolder {
  id: string;
  parentId: string | null;
  name: string;
  reviewChanges: boolean;
  deleted: boolean;
  source?: { mountId: string; provider: string } | null;
}
export interface FFile {
  id: string;
  folderId: string;
  name: string;
  version: number;
  blob: string;
  mime?: string;
  kind?: string;
  deleted: boolean;
  reasons: string[];
}

export class FakeFiles {
  readonly folders = new Map<string, FFolder>();
  readonly files = new Map<string, FFile>();
  readonly blobs = new Map<string, string>();
  readonly writes: { fileId: string; blobId: string; reason?: string; baseVersion?: number }[] = [];
  private seq = 0;

  constructor() {
    this.folders.set("fld_into", {
      id: "fld_into",
      parentId: null,
      name: "Files",
      reviewChanges: false,
      deleted: false,
    });
  }

  blob(id: string, content: string): string {
    this.blobs.set(id, content);
    return id;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_t${this.seq}`;
  }

  private taken(folderId: string, name: string, exceptFile?: string, exceptFolder?: string): boolean {
    return (
      [...this.files.values()].some(
        (f) => f.folderId === folderId && f.name === name && !f.deleted && f.id !== exceptFile,
      ) ||
      [...this.folders.values()].some(
        (f) => f.parentId === folderId && f.name === name && !f.deleted && f.id !== exceptFolder,
      )
    );
  }

  /** Paths of live files, "Folder/sub/file", sorted. */
  paths(): string[] {
    const pathOf = (folderId: string | null): string => {
      const f = folderId && folderId !== "fld_into" ? this.folders.get(folderId) : undefined;
      if (!f) return "";
      const up = pathOf(f.parentId);
      return up === "" ? f.name : `${up}/${f.name}`;
    };
    return [...this.files.values()]
      .filter((f) => !f.deleted && this.live(f.folderId))
      .map((f) => `${pathOf(f.folderId)}/${f.name}`)
      .sort();
  }

  folderPaths(): string[] {
    const pathOf = (folderId: string | null): string => {
      const f = folderId && folderId !== "fld_into" ? this.folders.get(folderId) : undefined;
      if (!f) return "";
      const up = pathOf(f.parentId);
      return up === "" ? f.name : `${up}/${f.name}`;
    };
    return [...this.folders.values()]
      .filter((f) => !f.deleted && f.id !== "fld_into")
      .map((f) => pathOf(f.id))
      .sort();
  }

  private live(folderId: string): boolean {
    for (
      let at: FFolder | undefined = this.folders.get(folderId);
      at;
      at = at.parentId ? this.folders.get(at.parentId) : undefined
    )
      if (at.deleted) return false;
    return true;
  }

  fileNamed(name: string): FFile {
    const f = [...this.files.values()].find((x) => x.name === name && !x.deleted);
    if (!f) throw new Error(`no file ${name}`);
    return f;
  }

  folderNamed(name: string): FFolder {
    const f = [...this.folders.values()].find((x) => x.name === name && !x.deleted);
    if (!f) throw new Error(`no folder ${name}`);
    return f;
  }

  text(fileId: string): string {
    const f = this.files.get(fileId);
    return f ? (this.blobs.get(f.blob) ?? "") : "";
  }

  /** A person edits a file in Vyre: a new version with this text. */
  edit(fileId: string, text: string): number {
    const f = this.files.get(fileId);
    if (!f) throw new Error(`no file ${fileId}`);
    f.version += 1;
    f.blob = this.blob(this.nextId("blb"), text);
    return f.version;
  }

  /** The Files module's own name rule (modules/files/handlers/tree.ts cleanName), so a test sees what the real module refuses. */
  private clean(raw: unknown): string {
    const n = String(raw).trim();
    if (
      !n ||
      n.length > 255 ||
      n === "." ||
      n === ".." ||
      n.includes("/") ||
      n.includes("\\") ||
      /[\u0000-\u001f]/.test(n)
    )
      throw vyreErr("validation.bad_input", "That name cannot be used for a file or folder.");
    return n;
  }

  call(cap: string, i: Row): unknown {
    const dup = (): never => {
      throw vyreErr("validation.duplicate", "That name is already in this folder.");
    };
    const missing = (what: string): never => {
      throw vyreErr("validation.not_found", `No such ${what}.`);
    };
    // what a rename or a move made in Vyre looks like from here (the outbound moves read it before they send anything)
    if (cap === "files.get") {
      const f = this.files.get(String(i["fileId"]));
      if (!f) return missing("file");
      return {
        file: { fileId: f.id, folderId: f.folderId, name: f.name, version: f.version, deletedAt: f.deleted ? 1 : null },
      };
    }
    if (cap === "files.folder.get") {
      const f = this.folders.get(String(i["folderId"]));
      if (!f || f.deleted) return missing("folder");
      return { folder: { folderId: f.id, parentId: f.parentId, name: f.name } };
    }
    if (cap === "files.folder.create") {
      const parentId = String(i["parentId"]);
      const name = this.clean(i["name"]);
      if (!this.folders.has(parentId)) missing("folder");
      if (this.taken(parentId, name)) dup();
      const id = this.nextId("fld");
      this.folders.set(id, { id, parentId, name, reviewChanges: i["reviewChanges"] === true, deleted: false });
      return { folder: { folderId: id, parentId, name, reviewChanges: i["reviewChanges"] === true } };
    }
    if (cap === "files.folder.settings") {
      const f = this.folders.get(String(i["folderId"]));
      if (!f) missing("folder");
      else {
        if (typeof i["reviewChanges"] === "boolean") f.reviewChanges = i["reviewChanges"];
        if (i["source"] !== undefined)
          f.source =
            i["source"] === null
              ? null
              : { mountId: String(obj(i["source"])["mountId"]), provider: String(obj(i["source"])["provider"]) };
      }
      return { folder: { folderId: String(i["folderId"]) } };
    }
    if (cap === "files.folder.rename") {
      const f = this.folders.get(String(i["folderId"]));
      if (!f) return missing("folder");
      const next = this.clean(i["name"]);
      if (f.parentId && this.taken(f.parentId, next, undefined, f.id)) dup();
      f.name = next;
      return { folder: { folderId: f.id } };
    }
    if (cap === "files.folder.move") {
      const f = this.folders.get(String(i["folderId"]));
      if (!f) return missing("folder");
      f.parentId = String(i["toParentId"]);
      return { folder: { folderId: f.id } };
    }
    if (cap === "files.folder.delete") {
      const f = this.folders.get(String(i["folderId"]));
      if (!f || f.deleted) return missing("folder");
      f.deleted = true;
      return { deleted: true };
    }
    if (cap === "files.create") {
      const folderId = String(i["folderId"]);
      const name = this.clean(i["name"]);
      if (!this.folders.has(folderId)) missing("folder");
      if (this.taken(folderId, name)) dup();
      // no content: an empty placeholder, as a live mount makes for a file that has not been opened
      const blobId =
        i["content"] === undefined ? this.blob(this.nextId("blb"), "") : String(obj(i["content"])["blobId"]);
      const id = this.nextId("fil");
      const file: FFile = {
        id,
        folderId,
        name,
        version: 1,
        blob: blobId,
        deleted: false,
        reasons: [],
        ...(typeof i["mime"] === "string" ? { mime: i["mime"] } : {}),
        ...(typeof i["kind"] === "string" ? { kind: i["kind"] } : {}),
      };
      this.files.set(id, file);
      return { file: { fileId: id, folderId, name, version: 1 } };
    }
    if (cap === "files.write") {
      const f = this.files.get(String(i["fileId"]));
      if (!f || f.deleted) return missing("file");
      const blobId = String(obj(i["content"])["blobId"]);
      this.writes.push({
        fileId: f.id,
        blobId,
        ...(typeof i["reason"] === "string" ? { reason: i["reason"] } : {}),
        ...(typeof i["baseVersion"] === "number" ? { baseVersion: i["baseVersion"] } : {}),
      });
      f.version += 1;
      f.blob = blobId;
      if (typeof i["reason"] === "string") f.reasons.push(i["reason"]);
      return { file: { fileId: f.id, version: f.version }, versionId: `ver_t${f.version}` };
    }
    if (cap === "files.rename") {
      const f = this.files.get(String(i["fileId"]));
      if (!f || f.deleted) return missing("file");
      const next = this.clean(i["name"]);
      if (this.taken(f.folderId, next, f.id)) dup();
      f.name = next;
      return { file: { fileId: f.id, version: f.version } };
    }
    if (cap === "files.move") {
      const f = this.files.get(String(i["fileId"]));
      if (!f || f.deleted) return missing("file");
      f.folderId = String(i["toFolderId"]);
      return { file: { fileId: f.id, version: f.version } };
    }
    if (cap === "files.delete") {
      const f = this.files.get(String(i["fileId"]));
      if (!f || f.deleted) return missing("file");
      f.deleted = true;
      return { deleted: true };
    }
    if (cap === "files.restore") {
      const f = this.files.get(String(i["fileId"]));
      if (!f || !f.deleted) return missing("file");
      f.deleted = false;
      return { file: { fileId: f.id, folderId: f.folderId, name: f.name, version: f.version } };
    }
    return undefined;
  }
}

function obj(v: unknown): Row {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}

// ---- Google Drive -------------------------------------------------------------------------------------------

type FilesPort = FakeFiles;

export class FakeGoogle {
  readonly calls: { cap: string; input: Row }[] = [];
  readonly uploads: { fileId: string; name: string; parentId: string }[] = [];
  readonly folders: { name: string; parentId: string }[] = [];
  readonly trashed: string[] = [];
  /** files in Drive's Trash with the folder they sat in, so they can be taken back out */
  readonly bin = new Map<string, { parentId: string; file: Row }>();
  /** renames, moves and restores sent in place */
  readonly updates: {
    fileId: string;
    name?: string;
    addParentId?: string;
    removeParentId?: string;
    trashed?: boolean;
  }[] = [];
  /** every idempotency key a write carried, so a test can see a retry reuse it */
  readonly keys: { cap: string; key: string }[] = [];
  /** the content Drive holds for a file this fake was sent (a file it only listed has none) */
  readonly content = new Map<string, string>();
  /** modified time per file id, as the last listing or feed said */
  readonly modified = new Map<string, string>();
  /** Drive folders by id: the recorded listing for each */
  readonly listings = new Map<string, Row[]>();
  /** feed pages by page token */
  readonly feed = new Map<string, Row>();
  holdUploads = false;
  failWith: VyreErr | null = null;
  /** push channels opened and closed */
  readonly watches: { channelId: string; pageToken: string; address: string }[] = [];
  readonly stopped: { channelId: string; resourceId: string }[] = [];
  /** when a new channel expires (epoch ms) */
  watchExpiry = NOW + 60 * 60 * 1000;
  /** revisions Drive keeps per file id, oldest first */
  readonly revisions = new Map<string, Row[]>();
  /** uploads that replaced an existing file in place: the file id and the revision the write was conditional on */
  readonly replaced: { remoteId: string; ifRevision?: string }[] = [];
  private seq = 0;

  private readonly files: FilesPort;

  constructor(files: FilesPort) {
    this.files = files;
    this.listings.set("root_drv", [recorded("drive/root-page1.json"), recorded("drive/root-page2.json")]);
    this.listings.set("d1", [recorded("drive/folder-d1.json")]);
    this.feed.set("tok1", recorded("drive/changes-tok1.json"));
    this.feed.set("tok2", recorded("drive/changes-tok2.json"));
    this.feed.set("tok3", recorded("drive/changes-tok3.json"));
  }

  /** Drive now holds this file in that folder (a same-named file there is replaced). */
  put(parentId: string, file: Row): void {
    const pages = this.listings.get(parentId) ?? [{ files: [] }];
    this.listings.set(parentId, pages);
    for (const page of pages) page["files"] = (page["files"] as Row[]).filter((f) => f["name"] !== file["name"]);
    const last = pages[pages.length - 1] ?? { files: [] };
    (last["files"] as Row[]).push(file);
    this.note(file);
    if (file["mimeType"] === "application/vnd.google-apps.folder" && !this.listings.has(String(file["id"])))
      this.listings.set(String(file["id"]), [{ files: [] }]);
  }

  drop(id: string): void {
    for (const pages of this.listings.values())
      for (const page of pages) page["files"] = (page["files"] as Row[]).filter((f) => f["id"] !== id);
  }

  find(id: string): Row | undefined {
    for (const pages of this.listings.values())
      for (const page of pages) for (const f of page["files"] as Row[]) if (f["id"] === id) return f;
    return undefined;
  }

  /** Drive reports more about a file (head revision, last editor, modified time) as someone else saved it there. */
  decorate(id: string, extra: Row): void {
    const f = this.find(id);
    if (!f) throw new Error(`no drive file ${id}`);
    Object.assign(f, extra);
    this.note(f);
    if (typeof extra["headRevisionId"] === "string") {
      const list = this.revisions.get(id) ?? [];
      list.push({
        id: extra["headRevisionId"],
        modifiedTime: String(f["modifiedTime"] ?? ""),
        ...(extra["lastModifyingUser"] ? { lastModifyingUser: extra["lastModifyingUser"] } : {}),
      });
      this.revisions.set(id, list);
    }
  }

  /** Drive changes a file's modified time (someone edited it there). */
  touch(id: string, modifiedTime: string): void {
    for (const pages of this.listings.values())
      for (const page of pages)
        for (const f of page["files"] as Row[]) if (f["id"] === id) f["modifiedTime"] = modifiedTime;
  }

  private note(f: Row): void {
    if (typeof f["id"] === "string" && typeof f["modifiedTime"] === "string")
      this.modified.set(f["id"], f["modifiedTime"]);
  }

  /** the real id behind the "root" alias (My Drive) */
  myDrive = "root_drv";

  /** the Drive feed's start page token; unset, the call fails and a mount scans (an older Drive, or a refused scope) */
  startToken: string | undefined;

  call(cap: string, i: Row): unknown {
    if (cap === "google.dwd.my_account") return { email: ME };
    this.calls.push({ cap, input: i });
    if (typeof i["idempotencyKey"] === "string") this.keys.push({ cap, key: i["idempotencyKey"] });
    if (this.failWith) throw this.failWith;
    // the host's own rule: a write repeated with the same key returns what the first one returned and runs nothing twice
    if (typeof i["idempotencyKey"] === "string") {
      const seen = this.answers.get(`${cap}:${i["idempotencyKey"]}`);
      if (seen !== undefined) return seen;
      const answer = this.run(cap, i);
      if (answer !== undefined) this.answers.set(`${cap}:${i["idempotencyKey"]}`, answer);
      return answer;
    }
    return this.run(cap, i);
  }

  private readonly answers = new Map<string, unknown>();

  private run(cap: string, i: Row): unknown {
    if (cap === "google.drive.changes_start_token") {
      if (this.startToken === undefined) throw vyreErr("provider.bad_response", "No start token.");
      return { startPageToken: this.startToken };
    }
    if (cap === "google.drive.list_files") {
      const pages = this.listings.get(String(i["parentId"])) ?? [{ files: [] }];
      const at = i["pageToken"] === undefined ? 0 : Number(String(i["pageToken"]).replace("page", "")) - 1;
      const page = pages[at] ?? { files: [] };
      for (const f of page["files"] as Row[]) this.note(f);
      return page;
    }
    if (cap === "google.drive.list_changes") {
      const page = this.feed.get(String(i["pageToken"]));
      if (!page) throw vyreErr("provider.bad_response", "That page token is not known.");
      for (const c of page["changes"] as Row[]) if (c["file"]) this.note(c["file"] as Row);
      return page;
    }
    if (cap === "google.drive.download_file" || cap === "google.drive.export_file") {
      const id = String(i["fileId"]);
      const blobId = this.files.blob(
        `blb_g_${id}_${this.modified.get(id) ?? "0"}${cap.endsWith("export_file") ? "_x" : ""}`,
        `${cap.endsWith("export_file") ? "export" : "drive"}:${id}@${this.modified.get(id) ?? "0"}`,
      );
      return {
        blobId,
        size: 10,
        mimeType: cap.endsWith("export_file") ? String(i["mimeType"]) : "application/octet-stream",
      };
    }
    if (cap === "google.drive.get_file") {
      // "root" is Drive's alias for My Drive; the file it names has its own id
      if (i["fileId"] === "root")
        return { file: { id: this.myDrive, name: "My Drive", mimeType: "application/vnd.google-apps.folder" } };
      const f = this.find(String(i["fileId"]));
      if (!f) throw vyreErr("validation.not_found", "No such file.");
      return { file: f };
    }
    if (cap === "google.drive.watch_changes") {
      this.watches.push({
        channelId: String(i["channelId"]),
        pageToken: String(i["pageToken"]),
        address: String(i["address"]),
      });
      return { resourceId: `res_${this.watches.length}`, expiration: this.watchExpiry };
    }
    if (cap === "google.drive.stop_watch") {
      this.stopped.push({ channelId: String(i["channelId"]), resourceId: String(i["resourceId"]) });
      return { stopped: true };
    }
    if (cap === "google.drive.list_revisions") return { revisions: this.revisions.get(String(i["fileId"])) ?? [] };
    if (cap === "google.drive.download_revision") {
      return {
        blobId: this.files.blob(
          `blb_rev_${String(i["fileId"])}_${String(i["revisionId"])}`,
          `rev:${String(i["fileId"])}@${String(i["revisionId"])}`,
        ),
        size: 8,
        mimeType: "application/octet-stream",
      };
    }
    const inPlace =
      cap === "google.drive.upload_file" && typeof i["remoteId"] === "string" ? this.find(i["remoteId"]) : undefined;
    if (inPlace) {
      // a write to a file that exists: replaced in place as a new revision, unless the head revision is not the one the write was based on
      if (this.holdUploads) throw vyreErr("permission.needs_approval", "Waiting for approval.");
      if (typeof i["ifRevision"] === "string" && inPlace["headRevisionId"] !== i["ifRevision"])
        return { file: inPlace, stale: true };
      this.seq += 1;
      this.replaced.push({
        remoteId: String(i["remoteId"]),
        ...(typeof i["ifRevision"] === "string" ? { ifRevision: i["ifRevision"] } : {}),
      });
      this.uploads.push({ fileId: String(i["fileId"]), name: String(i["name"]), parentId: String(i["parentId"]) });
      this.content.set(String(i["remoteId"]), this.files.text(String(i["fileId"])));
      this.decorate(String(i["remoteId"]), {
        modifiedTime: `2026-10-10T00:00:${String(this.seq).padStart(2, "0")}.000Z`,
        headRevisionId: `rev_up${this.seq}`,
        lastModifyingUser: { name: "Noah Reyes", email: ME },
      });
      return { file: inPlace };
    }
    if (cap === "google.drive.upload_file") {
      if (this.holdUploads) throw vyreErr("permission.needs_approval", "Waiting for approval.");
      this.seq += 1;
      this.uploads.push({ fileId: String(i["fileId"]), name: String(i["name"]), parentId: String(i["parentId"]) });
      const file = {
        id: `up${this.seq}`,
        name: String(i["name"]),
        mimeType: "application/octet-stream",
        modifiedTime: `2026-10-10T00:00:${String(this.seq).padStart(2, "0")}.000Z`,
      };
      this.put(String(i["parentId"]), file);
      this.content.set(file.id, this.files.text(String(i["fileId"])));
      return { file };
    }
    if (cap === "google.drive.create_folder") {
      this.seq += 1;
      this.folders.push({ name: String(i["name"]), parentId: String(i["parentId"]) });
      const file = {
        id: `nf${this.seq}`,
        name: String(i["name"]),
        mimeType: "application/vnd.google-apps.folder",
        modifiedTime: `2026-10-10T00:00:${String(this.seq).padStart(2, "0")}.000Z`,
      };
      this.put(String(i["parentId"]), file);
      return { file };
    }
    if (cap === "google.drive.trash_file") {
      const id = String(i["fileId"]);
      this.trashed.push(id);
      for (const [parentId, pages] of this.listings)
        for (const page of pages)
          for (const f of page["files"] as Row[]) if (f["id"] === id) this.bin.set(id, { parentId, file: f });
      this.drop(id);
      return { trashed: true };
    }
    if (cap === "google.drive.update_file") {
      if (this.holdUploads) throw vyreErr("permission.needs_approval", "Waiting for approval.");
      const id = String(i["fileId"]);
      this.updates.push({
        fileId: id,
        ...(typeof i["name"] === "string" ? { name: i["name"] } : {}),
        ...(typeof i["addParentId"] === "string" ? { addParentId: i["addParentId"] } : {}),
        ...(typeof i["removeParentId"] === "string" ? { removeParentId: i["removeParentId"] } : {}),
        ...(typeof i["trashed"] === "boolean" ? { trashed: i["trashed"] } : {}),
      });
      if (i["trashed"] === false) {
        const held = this.bin.get(id);
        if (!held) throw vyreErr("validation.not_found", "Not in the Trash.");
        this.bin.delete(id);
        this.put(held.parentId, held.file);
        return { file: held.file };
      }
      const f = this.find(id);
      if (!f) throw vyreErr("validation.not_found", "No such file.");
      if (typeof i["name"] === "string") f["name"] = i["name"];
      if (typeof i["addParentId"] === "string") {
        const from = typeof i["removeParentId"] === "string" ? i["removeParentId"] : undefined;
        for (const [parentId, pages] of this.listings)
          if (from === undefined || parentId === from)
            for (const page of pages) page["files"] = (page["files"] as Row[]).filter((x) => x["id"] !== id);
        const pages = this.listings.get(i["addParentId"]) ?? [{ files: [] }];
        this.listings.set(i["addParentId"], pages);
        (pages[pages.length - 1]!["files"] as Row[]).push(f);
      }
      this.seq += 1;
      f["modifiedTime"] = `2026-10-10T00:01:${String(this.seq).padStart(2, "0")}.000Z`;
      this.note(f);
      return { file: f };
    }
    return undefined;
  }
}

// ---- Microsoft Graph ----------------------------------------------------------------------------------------

export class FakeGraph {
  readonly calls: { cap: string; input: Row }[] = [];
  readonly deltas = new Map<string, Row>();
  readonly uploads: { fileId: string; name: string; folderId: string }[] = [];
  readonly deleted: string[] = [];
  /** renames and moves sent in place, and restores from the recycle bin */
  readonly updates: { itemId: string; name?: string; parentId?: string }[] = [];
  readonly restored: string[] = [];
  /** every idempotency key a write carried */
  readonly keys: { cap: string; key: string }[] = [];
  /** drive change subscriptions opened and closed */
  readonly subs: { subscriptionId: string; notificationUrl: string }[] = [];
  readonly unsubscribed: string[] = [];
  /** the eTag Graph holds per item id; a conditional write against another one is refused */
  readonly etags = new Map<string, string>();
  readonly versions = new Map<string, Row[]>();
  readonly replaced: { remoteId: string; ifMatch?: string }[] = [];
  failWith: VyreErr | null = null;

  private readonly files: FakeFiles;

  /** Graph reports more about an item in every page of the recorded delta (eTag, last editor). */
  decorate(id: string, extra: Row): void {
    for (const page of this.deltas.values())
      for (const it of page["changed"] as Row[]) if (it["id"] === id) Object.assign(it, extra);
    if (typeof extra["eTag"] === "string") this.etags.set(id, extra["eTag"]);
  }

  constructor(files: FakeFiles) {
    this.files = files;
    this.deltas.set("", recorded("graph/delta-initial.json"));
    this.deltas.set("dl1", recorded("graph/delta-dl1.json"));
    this.deltas.set("dl2", recorded("graph/delta-dl2.json"));
  }

  call(cap: string, i: Row): unknown {
    if (cap === "ms.consent.my_account") return { email: ME };
    this.calls.push({ cap, input: i });
    if (typeof i["idempotencyKey"] === "string") this.keys.push({ cap, key: i["idempotencyKey"] });
    if (this.failWith) throw this.failWith;
    if (cap === "ms.drive.delta") {
      const page = this.deltas.get(typeof i["deltaLink"] === "string" ? i["deltaLink"] : "");
      if (!page) throw vyreErr("provider.bad_response", "That delta link is not known.");
      return page;
    }
    if (cap === "ms.drive.download_item") {
      const id = String(i["itemId"]);
      return {
        blobId: this.files.blob(`blb_m_${id}_${this.calls.length}`, `graph:${id}#${this.calls.length}`),
        size: 5,
      };
    }
    if (cap === "ms.drive.get_item") {
      for (const page of this.deltas.values())
        for (const it of page["changed"] as Row[]) if (it["id"] === i["itemId"]) return { item: it };
      throw vyreErr("validation.not_found", "No such item.");
    }
    if (cap === "ms.drive.subscribe") {
      const subscriptionId = `sub${this.subs.length + 1}`;
      this.subs.push({ subscriptionId, notificationUrl: String(i["notificationUrl"]) });
      return { subscriptionId, expiresAt: NOW + 3 * 24 * 60 * 60 * 1000 };
    }
    if (cap === "ms.drive.unsubscribe") {
      this.unsubscribed.push(String(i["subscriptionId"]));
      return { removed: true };
    }
    if (cap === "ms.drive.list_versions") return { versions: this.versions.get(String(i["itemId"])) ?? [] };
    if (cap === "ms.drive.download_version")
      return {
        blobId: this.files.blob(
          `blb_ver_${String(i["itemId"])}_${String(i["versionId"])}`,
          `ver:${String(i["itemId"])}@${String(i["versionId"])}`,
        ),
        size: 8,
      };
    if (cap === "ms.drive.upload_item" && typeof i["remoteId"] === "string") {
      const remoteId = i["remoteId"];
      if (typeof i["ifMatch"] === "string" && this.etags.get(remoteId) !== i["ifMatch"]) return { stale: true };
      this.replaced.push({ remoteId, ...(typeof i["ifMatch"] === "string" ? { ifMatch: i["ifMatch"] } : {}) });
      this.uploads.push({ fileId: String(i["fileId"]), name: String(i["name"]), folderId: String(i["folderId"]) });
      const eTag = `etag_up${this.replaced.length}`;
      this.etags.set(remoteId, eTag);
      return {
        item: {
          id: remoteId,
          name: String(i["name"]),
          eTag,
          lastModifiedDateTime: "2026-10-10T00:00:00Z",
          lastModifiedBy: { name: "Noah Reyes", email: ME },
        },
      };
    }
    if (cap === "ms.drive.upload_item") {
      this.uploads.push({ fileId: String(i["fileId"]), name: String(i["name"]), folderId: String(i["folderId"]) });
      return {
        item: { id: `mu${this.uploads.length}`, name: String(i["name"]), lastModifiedDateTime: "2026-10-10T00:00:00Z" },
      };
    }
    if (cap === "ms.drive.create_folder")
      return { item: { id: `mf${this.calls.length}`, name: String(i["name"]), folder: true } };
    if (cap === "ms.drive.update_item") {
      const id = String(i["itemId"]);
      if (typeof i["ifMatch"] === "string" && this.etags.get(id) !== i["ifMatch"]) return { stale: true, item: { id } };
      this.updates.push({
        itemId: id,
        ...(typeof i["name"] === "string" ? { name: i["name"] } : {}),
        ...(typeof i["parentId"] === "string" ? { parentId: i["parentId"] } : {}),
      });
      let found: Row | undefined;
      for (const page of this.deltas.values())
        for (const it of page["changed"] as Row[])
          if (it["id"] === id) {
            if (typeof i["name"] === "string") it["name"] = i["name"];
            if (typeof i["parentId"] === "string") it["parentId"] = i["parentId"];
            found = it;
          }
      return { item: found ?? { id } };
    }
    if (cap === "ms.drive.restore_item") {
      this.restored.push(String(i["itemId"]));
      return { item: { id: String(i["itemId"]) } };
    }
    if (cap === "ms.drive.delete_item") {
      this.deleted.push(String(i["itemId"]));
      return { deleted: true };
    }
    if (cap === "ms.drive.list_items") {
      return {
        items: [
          { id: "i1", name: "Shared Documents", folder: true },
          { id: "i2", name: "notes.txt", size: 3 },
        ],
        nextSkipToken: "s2",
      };
    }
    return undefined;
  }
}

// ---- the harness --------------------------------------------------------------------------------------------

export function harness(
  o: {
    principal?: { kind: "person" | "agent" | "actor" | "service"; id: string };
    now?: number;
    settings?: Record<string, unknown>;
  } = {},
) {
  const db = new MemoryDb();
  const files = new FakeFiles();
  const google = new FakeGoogle(files);
  const graph = new FakeGraph(files);
  const events: Emitted[] = [];
  const calls: { cap: string; input: unknown }[] = [];
  const scheduled: Scheduled[] = [];
  const gitCalls: { cap: string; input: Row }[] = [];
  const git = {
    pull: { updated: true, sha: "a".repeat(40), conflicts: [] as string[] } as Row,
    failWith: null as VyreErr | null,
    initFailWith: null as VyreErr | null,
  };
  const hidden = new Set<string>();
  const levelFor = new Map<string, string>();
  const settings: Record<string, unknown> = {
    "files.review_changes": { git: true, cloud_mount: true, plain: false },
    "files.local_mount_default": "server_copy",
    ...(o.settings ?? {}),
  };
  let clock = o.now ?? NOW;
  let schedulerOn = true;

  const ctx: Ctx = {
    space: "spc_test",
    principal: o.principal ?? { kind: "person", id: "usr_owner" },
    trace: { traceId: TRACE, spanId: "0123456789abcdef" },
    origin: "ui",
    depth: 0,
    now: () => clock,
    db,
    emit<T>(name: EventName, subject: string, payload: T): EventEnvelope<T> {
      events.push({ name, subject, payload });
      return {} as EventEnvelope<T>;
    },
    async call(cap, input) {
      calls.push({ cap, input });
      const i = obj(input);
      if (needsKey(cap) && (typeof i["idempotencyKey"] !== "string" || i["idempotencyKey"] === ""))
        throw vyreErr("validation.bad_input", `${cap} needs an idempotency key.`);
      if (cap === "settings.get") return { row: { key: i["key"], value: settings[String(i["key"])] } };
      const f = cap.startsWith("files.") ? files.call(cap, i) : undefined;
      if (f !== undefined) return f;
      const g = cap.startsWith("google.") ? google.call(cap, i) : undefined;
      if (g !== undefined) return g;
      const m = cap.startsWith("ms.") ? graph.call(cap, i) : undefined;
      if (m !== undefined) return m;
      if (cap === "github.repos.list")
        return {
          repos: [
            { repo: "acme/site", private: false, defaultBranch: "main", url: "https://github.com/acme/site" },
            { repo: "acme/secret", private: true, defaultBranch: "main", url: "https://github.com/acme/secret" },
          ],
          next: "r2",
        };
      if (cap.startsWith("git.")) {
        gitCalls.push({ cap, input: i });
        if (cap === "git.init" || cap === "git.remote_add") {
          if (git.initFailWith) throw git.initFailWith;
          return cap === "git.init" ? { branch: String(i["branch"] ?? "main") } : { ok: true };
        }
        if (cap === "git.pull") {
          if (git.failWith) throw git.failWith;
          return git.pull;
        }
      }
      throw new Error(`unscripted call ${cap}`);
    },
    authorize(action: { perm: string | null; level: string }, resource: ResourceRef): Decision {
      const key = `${resource.type}/${resource.id ?? ""}`;
      const order = ["view", "use", "edit", "manage"];
      const held = levelFor.get(resource.type) ?? "manage";
      const ok = !hidden.has(key) && order.indexOf(action.level) <= order.indexOf(held);
      return { effect: ok ? "allow" : "deny", reason: ok ? "granted" : "denied", decisionId: `dec_${key}` };
    },
    vault: { async fill() {}, use: (handle) => ({ handle }) },
    http: async () => ({ status: 200, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async (at, cap, input) => {
      if (!schedulerOn) throw new Error("no scheduler");
      scheduled.push({ at, cap, input });
      return `sch_${scheduled.length}`;
    },
    seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "b" }), unseal: () => new Uint8Array() },
  };

  return {
    ctx,
    db,
    files,
    google,
    graph,
    git,
    gitCalls,
    events,
    calls,
    scheduled,
    hidden,
    levelFor,
    settings,
    advance(ms: number) {
      clock += ms;
    },
    now: () => clock,
    noScheduler() {
      schedulerOn = false;
    },
    as(principal: { kind: "person" | "agent" | "actor" | "service"; id: string }): Ctx {
      return { ...ctx, principal };
    },
    named(name: string): unknown[] {
      return events.filter((e) => e.name === name).map((e) => e.payload);
    },
    mountRow(mountId: string): Row {
      const r = (db.rows("mounts_mount") as Row[]).find((x) => x["id"] === mountId);
      if (!r) throw new Error(`no mount ${mountId}`);
      return r;
    },
    items(mountId: string): Row[] {
      return (db.rows("mounts_item") as Row[]).filter((x) => x["mount_id"] === mountId);
    },
  };
}

export type World = ReturnType<typeof harness>;
