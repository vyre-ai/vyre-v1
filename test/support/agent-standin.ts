// A stand-in for the agent that fills a SyncSpec. It knows nothing about any CRM: given an app's host, a Vault handle, the paths the docs name and an endpoint that lists pick-lists, it
// reads real pages through the discovery capabilities and writes the spec from what it sees (where the list is, the id, the date, the types, how pages move, which field points at which
// object, which fields carry choices). The real agent does the same with a language model; this one is deterministic so the platform can be proven end to end.
import type { ConnectorsHandle } from "../../modules/connectors/impl.ts";
import type { ConnectorsCtx } from "../../modules/connectors/projections.ts";

type Hs = ConnectorsHandle["handlers"];
interface Auth { vaultHandle: string; style: "bearer" | "header"; header?: string }
export interface Know { name: string; domain: string; auth: Auth; objects: { remote: string; path: string; label: string; recordType: string; write?: { path: string; evidence: string } }[]; fieldsEndpoint?: { path: string; forRemote: string }; firstPullFilter?: { remote: string; param: string; value: string; words: string }; backfill?: "now" | "later"; /** Which account of the app this is (a location, a tenant). */ account?: string; /** Query parameters the docs name for one object's list (a tenant, a sort). */ query?: Record<string, Record<string, string>> }

const leaf = (p: string): string => p.split("/").pop() ?? p;
const title = (s: string): string => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Choices from a metadata answer: any entry with a key and a list of options, strings or objects with a value. */
function choicesFrom(preview: string | undefined): Map<string, { value: string; label?: string }[]> {
  const out = new Map<string, { value: string; label?: string }[]>();
  if (!preview) return out;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const name = (o["key"] ?? o["name"]) as string | undefined;
    if (typeof name === "string" && Array.isArray(o["options"])) {
      out.set(name, (o["options"] as unknown[]).map((x) => (typeof x === "string" ? { value: x } : { value: String((x as { value: unknown }).value), ...((x as { label?: string }).label ? { label: (x as { label: string }).label } : {}) })));
    }
    Object.values(o).forEach(walk);
  };
  try { walk(JSON.parse(preview)); } catch { /* an answer too long for a preview has no choices to read */ }
  return out;
}

export async function fillSpec(hs: Hs, ctx: ConnectorsCtx, know: Know): Promise<Record<string, unknown>> {
  const base = { auth: know.auth, domain: know.domain };
  // 1. one page of each object
  const seen = new Map<string, Awaited<ReturnType<Hs["sync_specs.sample"]>>>();
  for (const o of know.objects) seen.set(o.remote, await hs["sync_specs.sample"](ctx, { ...base, path: o.path, items: 10, ...(know.query?.[o.remote] ? { query: know.query[o.remote] } : {}) }));
  // 2. pick-lists
  const choices = know.fieldsEndpoint ? choicesFrom((await hs["sync_specs.sample"](ctx, { ...base, path: know.fieldsEndpoint.path })).preview) : new Map();
  // 3. ids of each object, to see which field points at which
  const idsOf = new Map<string, Set<string>>();
  for (const o of know.objects) {
    const l = seen.get(o.remote)!.shape!.lists[0]!;
    idsOf.set(o.remote, new Set((seen.get(o.remote)!.items as Record<string, unknown>[]).map((it) => String(readPath(it, l.idAt ?? "/id")))));
  }
  const objects: Record<string, unknown>[] = [];
  const mapping: Record<string, unknown>[] = [];
  for (const o of know.objects) {
    const s = seen.get(o.remote)!;
    const l = s.shape!.lists[0]!;
    // how pages move: a Link header, a cursor in the answer, or a page number the app answers differently
    let cursor: Record<string, unknown> = { kind: "none" };
    if (s.nextLink) cursor = { kind: "link", size: l.count, sizeParam: "limit" };
    else if (s.shape!.cursors[0]) cursor = { kind: "cursor", param: "after", next: s.shape!.cursors[0].pointer };
    else {
      const p2 = await hs["sync_specs.sample"](ctx, { ...base, path: o.path, query: { ...(know.query?.[o.remote] ?? {}), page: "2", per_page: String(l.count) } });
      const first2 = (p2.items?.[0] as Record<string, unknown> | undefined);
      if (p2.ok && first2 && String(readPath(first2, l.idAt ?? "/id")) !== String(readPath((s.items as Record<string, unknown>[])[0]!, l.idAt ?? "/id"))) cursor = { kind: "page", param: "page", size: l.count, sizeParam: "per_page" };
    }
    const filter = know.firstPullFilter?.remote === o.remote ? { param: know.firstPullFilter.param, value: know.firstPullFilter.value } : undefined;
    const fields = l.fields.filter((f) => f.seen > 0 && f.path !== (l.idAt ?? "/id")).map((f) => {
      const values = (s.items as Record<string, unknown>[]).map((it) => readPath(it, f.path)).filter((v) => v !== null && v !== undefined);
      const target = know.objects.find((t) => t.remote !== o.remote && values.length > 0 && values.every((v) => idsOf.get(t.remote)!.has(String(v))));
      const pick = choices.get(leaf(f.path));
      return {
        path: f.path, label: title(leaf(f.path)),
        ...(target && f.type !== "date" ? { type: "relation", relationTo: target.remote } : pick ? { type: "choice", choices: pick } : { type: f.type }),
        // a stamp the app keeps itself is read, never written
        ...(/(modified|updated|created)/.test(leaf(f.path)) ? { readOnly: true } : {}),
      };
    });
    objects.push({
      remote: o.remote, label: o.label, ...(s.estimate ? { count: s.estimate.count } : {}), id: l.idAt ?? "/id", itemsAt: l.itemsAt, ...(l.updatedAtGuess ? { updatedAt: l.updatedAtGuess } : {}),
      list: { path: o.path, ...(know.query?.[o.remote] ? { query: know.query[o.remote] } : {}), cursor, ...(filter ? { filter } : {}) },
      ...(o.write ? { update: { path: o.write.path, method: "PATCH", evidence: o.write.evidence } } : {}),
      fields,
    });
    const status = (fields as { path: string; type: string }[]).find((f) => f.type === "choice" && /status|stage/.test(f.path));
    const emailField = (fields as { path: string; type: string }[]).find((f) => f.type === "email");
    mapping.push({
      remote: o.remote, recordType: o.recordType, title: o.label,
      fields: (fields as { path: string; type: string }[]).map((f) => ({ path: f.path, field: keyOf(f.path, o.recordType), direction: f.type === "relation" || !o.write ? "pull" : "both" })),
      ...(status ? { stagesFrom: status.path } : {}), ...(emailField ? { match: [emailField.path] } : {}),
    });
  }
  return {
    app: { name: know.name, domain: know.domain, ...(know.account ? { account: know.account } : {}) },
    auth: know.auth,
    objects, mapping,
    plan: { firstPull: { words: know.firstPullFilter?.words ?? "Everything" }, backfill: know.backfill ?? "later", conflicts: "newest" },
  };
}

const keyOf = (path: string, type: string): string => {
  const k = leaf(path).replace(/^full_/, "").replace(/_id$/, "").replace(/[^a-z0-9_]/g, "_");
  return k === "name" || k === "title" ? k : k === type ? `${k}_value` : k;
};
function readPath(doc: unknown, pointer: string): unknown {
  let cur: unknown = doc;
  for (const k of pointer.slice(1).split("/")) { if (cur === null || typeof cur !== "object") return undefined; cur = (cur as Record<string, unknown>)[k]; }
  return cur;
}
