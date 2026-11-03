// The read gate (Redaction for AI, owner 3 Nov, rc.20): one place every call an agent is behind passes on its way back, so what reaches a model is the redacted rendition of a file, or a refusal.
// "Behind" is lib/redact.ts agentBound: an agent or an outside actor, or anything the agent's machinery runs, whoever it runs as (the engine reading context as the person, a setup-grant call rerun as
// the person, the agent's computer, the MCP door, the email and form helpers). The files module decides (its host call files.agent_gate); this seam only routes and fails closed.
// Before the handler: a write that would carry a file out of its layer (copy, move, send) is refused. After it: content, names, paths and snippets are rendered, or the read is refused.
// Paths that never pass through a capability are gated where they read: a CLI engine's disk folders (mounts.engine_folders, routed here), the agent computer's mirror (files.read as the agent,
// routed here), git trees (git.* here), search and memory indexes (they index files.agent_view), and blob-route previews (host/src/routes/blobs.ts asks blobFor below).

import { agentBound } from "../../../lib/redact.ts";

export interface GateSeed { principal: { kind: string; id: string }; actingFor?: string | undefined; thread?: string | undefined; run?: string | undefined; origin?: string | undefined; forAgent?: string | undefined }
export interface Refusal { code: string; message: string; details: Record<string, unknown> }
export interface AgentGate {
  /** A write an agent may not make on a file it cannot read as it is. */
  before(cap: string, input: unknown, seed: GateSeed): Promise<Refusal | null>;
  /** The output an agent may have, or a refusal. Capabilities outside the gate come back untouched. */
  after(cap: string, effects: string, input: unknown, output: unknown, seed: GateSeed): Promise<{ output: unknown } | { refuse: Refusal }>;
}

/** Families whose reads hand back a file's content, name, path or a snippet of it. */
const PREFIXES = ["files.", "sheets.", "previews.", "changesets.", "search.", "memory.", "git.", "mounts."];
/** Writes that would take a file out of its folder's layer. */
export const CARRY_CAPS: ReadonlySet<string> = new Set(["files.copy", "files.move", "files.folder.move", "files.share_external", "mail.send_file"]);
/** Connector calls that reach a provider file a mount holds: the id names the provider's item. */
export const CONNECTOR_CAPS: ReadonlyMap<string, string> = new Map([
  ["google.docs.get_document", "documentId"], ["google.sheets.get_values", "spreadsheetId"], ["google.drive.download_file", "fileId"], ["google.drive.export_file", "fileId"],
  ["google.drive.download_revision", "fileId"], ["google.drive.get_file", "fileId"], ["ms.workbook.get_range", "itemId"], ["ms.drive.download_item", "itemId"], ["ms.drive.download_version", "itemId"],
  ["ms.drive.get_item", "itemId"], ["dropbox.download", "path"],
]);
/** Calls the engine host makes as the Space that hand an engine something to read from disk. */
const ENGINE_FEEDS: ReadonlySet<string> = new Set(["mounts.engine_folders"]);

export function gated(cap: string, effects: string): boolean {
  if (CONNECTOR_CAPS.has(cap) || ENGINE_FEEDS.has(cap)) return true;
  return effects === "read" && PREFIXES.some((p) => cap.startsWith(p));
}

const who = (s: GateSeed): Record<string, unknown> => ({ principal: s.principal, ...(s.actingFor ? { actingFor: s.actingFor } : {}), ...(s.thread ? { thread: s.thread } : {}), ...(s.run ? { run: s.run } : {}), ...(s.origin ? { origin: s.origin } : {}) });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const unavailable = (cap: string): Refusal => ({ code: "internal.unavailable", message: "Vyre could not check what agents may read here, so nothing was handed over. Try again in a moment.", details: { cap, reason: "read_gate_unavailable" } });

/** `call` runs a module's host call (the daemon's hook runner). */
export function createAgentGate(d: { call(name: string, input: unknown): Promise<unknown>; warn?(msg: string, attrs: Record<string, unknown>): void }): AgentGate {
  const ask = async (input: Record<string, unknown>): Promise<{ output: unknown } | { refuse: Refusal }> => {
    const r = await d.call("files.agent_gate", input);
    if (isObj(r) && isObj(r.refuse)) return { refuse: r.refuse as unknown as Refusal };
    if (isObj(r) && "output" in r) return { output: r.output };
    throw new Error("the files gate answered nothing");
  };
  return {
    async before(cap, input, seed) {
      if (!CARRY_CAPS.has(cap) || !agentBound(seed)) return null;
      try { const r = await ask({ phase: "before", cap, input, who: who(seed) }); return "refuse" in r ? r.refuse : null; }
      catch (e) { d.warn?.("the read gate did not answer before a write", { cap, error: e instanceof Error ? e.message : String(e) }); return unavailable(cap); }
    },
    async after(cap, effects, input, output, seed) {
      if (!agentBound(seed) || !gated(cap, effects)) return { output };
      try {
        const key = CONNECTOR_CAPS.get(cap);
        if (key !== undefined) {
          const remote = isObj(input) && typeof input[key] === "string" ? (input[key] as string) : "";
          if (!remote) return { output };
          const m = (await d.call("mounts.item_for_remote", { remoteId: remote })) as { fileId?: string | null; folderId?: string | null } | null;
          if (!m || (!m.fileId && !m.folderId)) return { output };   // not a file Vyre holds: the provider's own rules apply
          return await ask({ phase: "after", cap: "connector.content", input: { ...(m.fileId ? { fileId: m.fileId } : {}), ...(m.folderId ? { folderId: m.folderId } : {}) }, output, who: who(seed) });
        }
        return await ask({ phase: "after", cap, input, output, who: who(seed) });
      } catch (e) {
        d.warn?.("the read gate did not answer", { cap, error: e instanceof Error ? e.message : String(e) });
        return { refuse: unavailable(cap) };
      }
    },
  };
}
