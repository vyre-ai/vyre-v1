// A file's activity line, after the person: "moved Fee agreement.pdf to Clients/Rivera". Slack's rule: who did what to which thing, no ids, no event names.
// The caller puts the actor in front and the time beside it. Events nobody needs to read (a star, a reading of the list) return null.

export interface FileWords {
  /** The file's name now. */
  fileName?: string | undefined;
  /** A folder's path as people read it, "Clients/Rivera"; undefined when the folder is unknown. */
  folder?: ((id: string) => string | undefined) | undefined;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const SHAPE: Readonly<Record<string, string>> = { box: "an area", range: "a time range", name: "part of the name" };

/** The plain words for one file event, or null when it is not worth a line. */
export function fileEventWords(type: string, payload: unknown, o: FileWords = {}): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const f = o.fileName ?? "this file";
  const place = (id: unknown): string | undefined => { const s = str(id); return s === undefined ? undefined : o.folder?.(s)?.replace(/ \/ /g, "/"); };
  const label = str(p["label"]) !== undefined && p["label"] !== "Text" ? (p["label"] as string).toLowerCase() : null;
  switch (type) {
    case "file.created": return `added ${str(p["name"]) ?? f}${place(p["folderId"]) ? ` to ${place(p["folderId"])}` : ""}`;
    case "file.version_added": return p["n"] === 1 ? null : str(p["reason"]) ? `saved a new version of ${f}: ${p["reason"] as string}` : `saved a new version of ${f}`;
    case "file.renamed": return str(p["from"]) && str(p["to"]) ? `renamed ${p["from"] as string} to ${p["to"] as string}` : `renamed ${f}`;
    case "file.moved": return `moved ${f}${place(p["toFolderId"]) ? ` to ${place(p["toFolderId"])}` : ""}`;
    case "file.deleted": return `deleted ${f}`;
    case "file.restored": return `restored ${f}${place(p["folderId"]) ? ` to ${place(p["folderId"])}` : ""}`;
    case "file.purged": return `deleted ${f} for good`;
    case "file.shared_external": return `shared ${f} with a link`;
    case "file.external_revoked": return `turned off the link to ${f}`;
    case "file.comment_added": return `commented on ${f}`;
    case "file.comment_resolved": return "resolved a comment";
    case "file.markup_saved": return `edited ${f}`;
    case "file.conflict_kept": return `kept both copies of ${f}`;
    case "file.reviewed": return `marked ${f} reviewed`;
    case "file.needs_review": return `could not place ${String(p["unplaced"] ?? 1)} ${p["unplaced"] === 1 ? "redaction" : "redactions"} on version ${String(p["version"] ?? "")}`.trim();
    case "file.redacted": return p["placed"] === true ? "placed a redaction on the new version" : `redacted ${label ? `a ${label}` : (SHAPE[String(p["shape"])] ?? "a passage")}`;
    case "file.unredacted": return p["dropped"] === true ? "dropped a redaction the new version no longer has" : `un-redacted ${label ? `a ${label}` : "a passage"}`;
    case "file.highlighted": return "highlighted a passage";
    case "file.highlight_removed": return "removed a highlight";
    case "file.agent_read": return p["redacted"] === true ? `read the redacted version of ${f}` : `read ${f}`;
    case "file.redact_requested": return `asked to read ${f}`;
    case "file.agent_access_changed": return `changed which agents can read ${f}`;
    case "file.starred": return null;
    default: return null;
  }
}
