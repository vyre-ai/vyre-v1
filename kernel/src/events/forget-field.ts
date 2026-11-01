// Sealing a field (modules/schema/handlers/seal.ts) takes the plaintext out of every copy. The idempotency table keeps the answer of each keyed write, and a record write answers with the record,
// so an old create or update holds the value in its result. This blanks that field in those answers (the answer stays, so a retry of the key still gets one) and scrubs the freed pages.
import type { DatabaseSync } from "node:sqlite";

const isSealedValue = (v: unknown): boolean => !!v && typeof v === "object" && typeof (v as { sealed?: unknown }).sealed === "string";

/** Remove `field` from every `fields` object next to `type`: the shape of a record row in an answer. Answers true when something changed. */
function blank(node: unknown, type: string, field: string): boolean {
  let hit = false;
  if (Array.isArray(node)) { for (const x of node) hit = blank(x, type, field) || hit; return hit; }
  if (!node || typeof node !== "object") return false;
  const o = node as Record<string, unknown>;
  const f = o["fields"];
  if (o["type"] === type && f && typeof f === "object" && !Array.isArray(f) && field in (f as Record<string, unknown>) && !isSealedValue((f as Record<string, unknown>)[field])) {
    delete (f as Record<string, unknown>)[field];
    hit = true;
  }
  for (const v of Object.values(o)) hit = blank(v, type, field) || hit;
  return hit;
}

export function forgetField(db: DatabaseSync, type: string, field: string): number {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let n = 0;
  db.exec("PRAGMA secure_delete = ON");
  const rows = db.prepare("SELECT key, result FROM idempotency WHERE result IS NOT NULL AND instr(result, ?) > 0").all(field) as { key: string; result: Uint8Array | string }[];
  for (const r of rows) {
    let json: unknown;
    try { json = JSON.parse(typeof r.result === "string" ? r.result : dec.decode(r.result)); } catch { continue; }
    if (!blank(json, type, field)) continue;
    const text = JSON.stringify(json);
    db.prepare("UPDATE idempotency SET result = ? WHERE key = ?").run(typeof r.result === "string" ? text : enc.encode(text), r.key);
    n++;
  }
  if (n) { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.exec("VACUUM"); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
  return n;
}
