// A record is read by its type and its id (records.get has no id-only form). A caller that is handed only an id, such as a document filled from a record or an email previewed as one, asks here which
// type holds it: the types the caller may list, the first that has the record. The reads go through the caller's own authority, so a record the caller may not see is not found.
type Call = (cap: string, input: unknown) => Promise<unknown>;

const codeOf = (e: unknown): string => (e as { error?: { code?: string }; code?: string } | null)?.error?.code ?? (e as { code?: string } | null)?.code ?? "";
const MISSING = new Set(["validation.not_found", "permission.no_grant", "permission.denied"]);

/** The record with this id and the type that holds it, or undefined when no type the caller may read has it. The record is the read that found it, so the caller need not read it again. */
export async function findRecord(call: Call, recordId: string): Promise<{ type: string; record: { fields?: unknown } } | undefined> {
  let cursor: string | undefined;
  do {
    const page = (await call("schema.types.list", cursor !== undefined ? { cursor } : {})) as { types?: Array<{ key?: string }>; next?: string } | null;
    for (const t of page?.types ?? []) {
      if (typeof t.key !== "string") continue;
      try {
        const got = (await call("records.get", { type: t.key, recordId })) as { record?: unknown } | null;
        if (got?.record) return { type: t.key, record: got.record as { fields?: unknown } };
      } catch (e) { if (!MISSING.has(codeOf(e))) throw e; }
    }
    cursor = page?.next;
  } while (cursor !== undefined);
  return undefined;
}

/** The record type that holds `recordId`, or undefined. */
export async function recordTypeOf(call: Call, recordId: string): Promise<string | undefined> {
  return (await findRecord(call, recordId))?.type;
}
