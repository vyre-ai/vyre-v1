// The Space ports the Google and Microsoft seams stand on (host/src/seams/ports.ts): who the members are by work email, the bytes of a Space file, and where downloaded bytes go. A server that
// gave these none refused every call that needed one, so delegation could not even match its members. They are built here from what the Space already holds, so a real server needs nothing
// more than its own database and the Files module.
import type { SpaceBlobs, SpaceFiles, SpaceMembers } from "./ports.ts";

/** The part of the database the member list reads. */
export interface PortDb { all(sql: string, ...args: unknown[]): unknown[] }

export interface SpacePortDeps {
  db: PortDb;
  /** is this person an active member of the Space (the access projection) */
  active(personId: string): boolean;
  /** run a host call of a live module (files.upload_url, files.get, files.read) */
  call(cap: string, input: unknown): Promise<unknown>;
  /** send bytes to an upload slot files.upload_url handed out (the slot's one-time token is the authority) */
  putToSlot(url: string, bytes: Uint8Array): Promise<void>;
}

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const MAX_FILE = 100 * 1024 * 1024;

/**
 * A member's work email is the address their invitation was sent to: the only email a Space holds for a person. One address maps to one member; a person who left or was suspended is
 * not listed.
 */
export function createMembers(d: Pick<SpacePortDeps, "db" | "active">): SpaceMembers {
  return {
    async emails() {
      let rows: unknown[];
      try { rows = d.db.all(`SELECT email, accepted_by AS userId FROM members_invites WHERE state = 'accepted' AND email IS NOT NULL AND accepted_by IS NOT NULL ORDER BY accepted_at ASC`); }
      catch { return []; }   // the members module has made no invitation yet
      const seen = new Set<string>();
      const out: { userId: string; email: string }[] = [];
      for (const r of rows.map(obj)) {
        const email = typeof r["email"] === "string" ? r["email"].trim().toLowerCase() : "";
        const userId = typeof r["userId"] === "string" ? r["userId"] : "";
        if (!email || !userId || seen.has(email) || !d.active(userId)) continue;
        seen.add(email);
        out.push({ userId, email });
      }
      return out;
    },
  };
}

/** A Space file's name, type and bytes, read through the Files module (a Gmail or Outlook attachment is sent from one). */
export function createFiles(d: Pick<SpacePortDeps, "call">): SpaceFiles {
  return {
    async read(_space, fileId) {
      const meta = obj(obj(await d.call("files.get", { fileId }))["file"]);
      const size = typeof meta["size"] === "number" ? meta["size"] : 0;
      if (size > MAX_FILE) throw new Error("That file is too large to send.");
      const chunks: Buffer[] = [];
      let offset = 0;
      for (;;) {
        const part = obj(await d.call("files.read", { fileId, as: "base64", offset, length: 1024 * 1024 }));
        const bytes = Buffer.from(typeof part["base64"] === "string" ? part["base64"] : "", "base64");
        chunks.push(bytes);
        offset += bytes.length;
        if (part["truncated"] !== true || bytes.length === 0 || offset > MAX_FILE) break;
      }
      return { name: typeof meta["name"] === "string" ? meta["name"] : fileId, mime: typeof meta["mime"] === "string" ? meta["mime"] : "application/octet-stream", bytes: new Uint8Array(Buffer.concat(chunks)) };
    },
  };
}

/**
 * Where bytes from Google or Microsoft go: into the Files module's own blob store through an upload slot, so the id that comes back is one files.create and files.write accept. (A blob
 * kept under the connector's own name would be refused by Files, which reads only its own.)
 */
export function createBlobs(d: Pick<SpacePortDeps, "call" | "putToSlot">): SpaceBlobs {
  return {
    async put(_space, bytes, mime) {
      const slot = obj(await d.call("files.upload_url", { size: bytes.byteLength, mime }));
      if (typeof slot["url"] !== "string" || typeof slot["blobId"] !== "string") throw new Error("Files gave no upload slot.");
      await d.putToSlot(slot["url"], bytes);
      return slot["blobId"];
    },
  };
}

export function createSpacePorts(d: SpacePortDeps): { members: SpaceMembers; files: SpaceFiles; blobs: SpaceBlobs } {
  return { members: createMembers(d), files: createFiles(d), blobs: createBlobs(d) };
}
