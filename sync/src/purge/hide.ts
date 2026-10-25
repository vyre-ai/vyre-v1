// Hide frames on the client (ARCH 5.3, 5.7): a row left the person's view. The replica drops the row, its field clocks, its FTS entry and its keep flags (ReplicaStore.hide);
// this adds what lives beside the row: its persisted Yjs documents, the documents open in the editor, and the cached files it points at.
import type { Hide, PullRes } from "../protocol.ts";
import type { ReplicaStore, SqlDriver, SqlRow } from "../replica/types.ts";
import { docPrefix } from "./ports.ts";
import type { OpenDocs } from "./ports.ts";

export interface HideOpts {
  driver: SqlDriver;
  docs?: OpenDocs;
  /** Hashes of cached files that belong to this row alone (read before the row is dropped). Default: none. */
  blobHashes?: (entity: string, row: SqlRow) => readonly string[];
}

export interface HideReport {
  /** Rows the replica held and no longer holds. */
  dropped: number;
  /** Hides recorded for rows the replica did not hold (a later older change for them is refused). */
  recorded: number;
  /** Rows whose documents were closed and whose saved document state was deleted. */
  docs: number;
  blobs: number;
}

/** Everything in a pull answer that takes a row away: the `hide` list and the deletes among the changes. A delete needs the same cleanup (search entry, saved documents). */
export function pullHides(res: Pick<PullRes, "changes" | "hide">): Hide[] {
  const out = [...res.hide];
  for (const c of res.changes) if (c.op === "delete") out.push({ entity: c.entity, id: c.id, seq: c.seq });
  return out;
}

/** Apply the `hide` list of a pull or an `ev` frame. Safe to apply twice. */
export async function applyHides(store: ReplicaStore, hides: readonly Hide[], o: HideOpts): Promise<HideReport> {
  const report: HideReport = { dropped: 0, recorded: 0, docs: 0, blobs: 0 };
  if (!hides.length) return report;
  const docExact = o.driver.prepare("DELETE FROM doc_local WHERE doc = ? OR substr(doc, 1, ?) = ?");
  const blobDrop = o.driver.prepare("DELETE FROM blob_cache WHERE hash = ?");
  const jobs: (() => void)[] = [];
  for (const h of hides) {
    const held = store.read(h.entity, h.id);
    const hashes = held && o.blobHashes ? o.blobHashes(h.entity, held) : [];
    store.hide(h.entity, h.id, h.seq);
    if (held) report.dropped += 1; else report.recorded += 1;
    o.docs?.closeFor(h.entity, h.id);
    const prefix = `${docPrefix(h.entity, h.id)}:`;
    jobs.push(() => docExact.run([docPrefix(h.entity, h.id), prefix.length, prefix]));
    report.docs += 1;
    for (const hash of hashes) {
      jobs.push(() => blobDrop.run([hash]));
      report.blobs += 1;
    }
  }
  o.driver.transaction(() => { for (const j of jobs) j(); });
  await o.driver.flush();
  return report;
}
