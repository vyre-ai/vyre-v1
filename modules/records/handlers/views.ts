// records.view, records.relations_map, records.page_prefs.get and records.page_prefs.set (spec 2.9 "Views", "Page", "Fields on the page"; ARCH 7.4).
// Path mapping: the packet lists handlers/views.ts and handlers/review.ts; the wiring (impl.ts, handlers/index.ts) and the contract tests sit beside them.
//
// A saved view lives in the schema module (views.get); this module resolves it for the table: the definition plus the rows its filter, sort and group select, a page at a
// time. The schema module is reached through ctx.call (boundary B1: modules are leaves). Page preferences are personal: one row per person and type, never shared and never
// a Star. The relationship map walks the relation fields out from one record, at most two hops, and names each edge by its field.
import { StoreError } from "../../../kernel/src/store/types.ts";
import type { FieldDef, StoredRecord } from "../../../kernel/src/store/types.ts";
import { turns } from "../../../lib/yield-loop.ts";
import { mapError } from "./write.ts";
import type { RecordRow, WriteCtx } from "./write.ts";
import { runQuery } from "./query.ts";
import type { ViewSpec } from "./query.ts";
import { ensureReviewTables, fail, isObj, isRelation, needType, refIds, targetOf } from "./review.ts";
import type { RvCtx, RvDeps } from "./review.ts";

export interface ViewDef {
  viewId: string;
  type: string;
  kind: string;
  title: string;
  shared: boolean;
  updatedAt: number;
  filter?: unknown;
  sort?: unknown;
  group?: string;
  hidden?: string[];
  colorRules?: unknown;
  config?: Record<string, unknown>;
}
export interface PagePrefs {
  folded: string[];
  keepVisible: string[];
}
export interface MapNode {
  recordId: string;
  type: string;
  title: string;
  hop: number;
}
export interface MapEdge {
  from: string;
  to: string;
  field: string;
}

export interface ViewHandlers {
  "records.view"(
    ctx: RvCtx,
    input: { type: string; viewId: string; cursor?: string; limit?: number },
  ): Promise<{ view: ViewDef; rows: RecordRow[]; next?: string; total?: number }>;
  "records.relations_map"(
    ctx: RvCtx,
    input: { type: string; recordId: string; hops?: number },
  ): Promise<{ nodes: MapNode[]; edges: MapEdge[] }>;
  "records.page_prefs.get"(ctx: RvCtx, input: { type: string }): Promise<PagePrefs>;
  "records.page_prefs.set"(
    ctx: RvCtx,
    input: { type: string; folded?: string[]; keepVisible?: string[] },
  ): Promise<PagePrefs>;
}

/** The most rows a view read looks at for one page (and for its total): past it the page ends where it is and there is no total. */
const SCAN_ROWS = 5000;
const PREF_MAX = 200;
const MAP_MAX_NODES = 100;

const strings = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200))].slice(
    0,
    PREF_MAX,
  );
};

const titleOf = (r: StoredRecord): string => {
  for (const k of ["name", "title", "subject", "label"]) {
    const v = r.data[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return r.id;
};

/** The type a relation item points at: its reference when it carries one, otherwise the field's target. */
function refType(item: unknown, fallback: string): string {
  if (isObj(item) && typeof item["urn"] === "string") {
    const s = item["urn"].slice(7).split("/");
    if (s.length >= 3 && s[1]) return s[1];
  }
  return fallback;
}

export function createViewHandlers(deps: RvDeps): ViewHandlers {
  const { tx, store } = deps;
  const guard = async <T>(ctx: RvCtx, run: () => Promise<T>): Promise<T> => {
    try {
      ensureReviewTables(tx);
      return await run();
    } catch (e) {
      return mapError(ctx as unknown as WriteCtx, e);
    }
  };
  const person = (ctx: RvCtx): string =>
    ctx.principal?.id ??
    fail(ctx, "permission.role_lacks_permission", "Page choices belong to a person; sign in to keep them.");
  const prefsOf = (who: string, type: string): PagePrefs => {
    const row = tx.get<{ folded: string; keep_visible: string }>(
      "SELECT folded, keep_visible FROM records_page_prefs WHERE person = ? AND type = ?",
      who,
      type,
    );
    if (!row) return { folded: [], keepVisible: [] };
    return { folded: strings(JSON.parse(row.folded)) ?? [], keepVisible: strings(JSON.parse(row.keep_visible)) ?? [] };
  };

  return {
    "records.view": (ctx, input) =>
      guard(ctx, async () => {
        await needType(store, input.type);
        if (!ctx.call)
          return fail(
            ctx,
            "internal.unavailable",
            "Saved views cannot be read: the schema module is not reachable from here.",
          );
        const got = (await ctx.call("views.get", { viewId: input.viewId })) as { view?: ViewDef };
        const view = got.view;
        if (!view || view.type !== input.type)
          return fail(ctx, "validation.not_found", `${input.type} has no view ${input.viewId}.`);
        const spec: ViewSpec = {
          ...(view.filter !== undefined && view.filter !== null ? { filter: view.filter } : {}),
          ...(Array.isArray(view.sort) && view.sort.length ? { sort: view.sort as NonNullable<ViewSpec["sort"]> } : {}),
          ...(typeof view.group === "string" && view.group ? { group: view.group } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
        };
        const page = runQuery(tx, input.type, spec);
        const def: ViewDef = {
          viewId: view.viewId,
          type: view.type,
          kind: view.kind,
          title: view.title,
          shared: view.shared,
          updatedAt: view.updatedAt,
          ...(view.filter !== undefined ? { filter: view.filter } : {}),
          ...(view.sort !== undefined ? { sort: view.sort } : {}),
          ...(view.group !== undefined ? { group: view.group } : {}),
          ...(view.hidden !== undefined ? { hidden: view.hidden } : {}),
          ...(view.colorRules !== undefined ? { colorRules: view.colorRules } : {}),
          ...(view.config !== undefined ? { config: view.config } : {}),
        };
        // the view's own filter, sort and group run on the server: a record the caller may not read one of those fields on would be picked or placed by a value they may not know, so it is left out (and the total
        // stops counting what that value picked)
        const named = new Set<string>();
        const walk = (f: unknown): void => {
          if (!f || typeof f !== "object") return;
          const o = f as Record<string, unknown>;
          for (const k of ["and", "or"]) if (Array.isArray(o[k])) (o[k] as unknown[]).forEach(walk);
          if (o["not"] !== undefined) walk(o["not"]);
          if (typeof o["field"] === "string") named.add(o["field"].split(".")[0]!);
        };
        walk(view.filter);
        for (const k of Array.isArray(view.sort) ? view.sort : [])
          if (isObj(k) && typeof k["field"] === "string") named.add(k["field"].split(".")[0]!);
        if (typeof view.group === "string" && view.group) named.add(view.group.split(".")[0]!);
        const judged = [...named].filter((f) => !["id", "version", "created_at", "updated_at"].includes(f));
        // Every caller is judged record by record, as an export is, whatever they hold (a Manage grant can hide a field, a row filter can take a record away): the host cuts a page afterwards, so a page that
        // came back with records the caller may not have would come back short. Without a way to ask (no authorize here) the page is the page.
        if (!ctx.authorize)
          return {
            view: def,
            rows: page.rows,
            total: page.total,
            ...(page.next !== undefined ? { next: page.next } : {}),
          };
        const authorize = ctx.authorize!;
        const keeps = (r: { id: string }): boolean =>
          authorize(
            { perm: null, level: "view", ...(judged.length ? { fields: judged } : {}) },
            { type: "record", id: r.id },
          ).effect === "allow";
        // A record left out takes no place in the paging: pages are read one after the other until `limit` records are kept (a page may hold more than `limit`; none is cut or skipped), and the answer never
        // comes short because a record was left out, so stepping the cursor says nothing about the records the caller may not know. The total counts only the records the caller may have (every page is read for it): a count of what the view picked would count the records the caller may not read the field on (the host drops the total for a restricted reader in any case).
        const want = Math.max(1, Math.min(Math.trunc(input.limit ?? 200), 500));
        const turn = turns();
        const rows: typeof page.rows = [];
        let at: { rows: typeof page.rows; next?: string } = page;
        // bounded by rows read, not pages: after SCAN_ROWS rows the page ends there (possibly short), and there is no total. Exact totals for a big table belong in records.counts.
        let scanned = 0;
        for (;;) {
          scanned += at.rows.length;
          for (const r of at.rows) if (keeps(r)) rows.push(r);
          if (rows.length >= want || at.next === undefined || scanned >= SCAN_ROWS) break;
          await turn();
          at = runQuery(tx, input.type, { ...spec, cursor: at.next });
        }
        // the total counts the records the caller may have, when the count finishes inside the same bound (the host drops it for a restricted reader in any case)
        let total: number | undefined = 0;
        const { cursor: _from, ...whole } = spec;
        let counted = 0;
        for (let cursor: string | undefined; ; ) {
          if (counted >= SCAN_ROWS) {
            total = undefined;
            break;
          }
          const part = runQuery(tx, input.type, { ...whole, limit: 500, ...(cursor ? { cursor } : {}) });
          counted += part.rows.length;
          for (const r of part.rows) if (keeps(r)) total++;
          if (part.next === undefined) break;
          cursor = part.next;
          await turn();
        }
        return {
          view: def,
          rows,
          ...(total !== undefined ? { total } : {}),
          ...(at.next !== undefined ? { next: at.next } : {}),
        };
      }),

    "records.relations_map": (ctx, input) =>
      guard(ctx, async () => {
        const hops = Math.min(Math.max(input.hops ?? 2, 1), 2);
        const root = await store.get(input.type, input.recordId);
        if (!root) throw new StoreError("not_found", `no ${input.type} ${input.recordId}`);
        const nodes = new Map<string, MapNode>([
          [root.id, { recordId: root.id, type: root.type, title: titleOf(root), hop: 0 }],
        ]);
        const edges = new Map<string, MapEdge>();
        const defs = new Map<string, readonly FieldDef[]>();
        const fieldsOf = async (type: string): Promise<readonly FieldDef[]> => {
          const have = defs.get(type);
          if (have) return have;
          const f = (await store.types()).find((t) => t.name === type)?.fields ?? [];
          defs.set(type, f);
          return f;
        };
        let frontier: StoredRecord[] = [root];
        for (let hop = 1; hop <= hops && frontier.length; hop++) {
          const next: StoredRecord[] = [];
          for (const from of frontier) {
            for (const f of (await fieldsOf(from.type)).filter(isRelation)) {
              const value = from.data[f.name];
              const items = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
              const fallback = targetOf(f);
              if (!fallback) continue;
              for (const item of items) {
                const [id] = refIds([item]);
                if (!id) continue;
                if (!nodes.has(id) && nodes.size >= MAP_MAX_NODES) continue;
                if (!nodes.has(id)) {
                  const to = await store.get(refType(item, fallback), id);
                  if (!to) continue; // gone or in Trash: no node, no edge
                  // a record the caller may not see is not drawn, and nothing says it is there
                  if (
                    ctx.authorize &&
                    ctx.authorize({ perm: null, level: "view" }, { type: "record", id }).effect !== "allow"
                  )
                    continue;
                  nodes.set(id, { recordId: id, type: to.type, title: titleOf(to), hop });
                  next.push(to);
                }
                edges.set(`${from.id}|${f.name}|${id}`, { from: from.id, to: id, field: f.name });
              }
            }
          }
          frontier = next;
        }
        return { nodes: [...nodes.values()], edges: [...edges.values()] };
      }),

    "records.page_prefs.get": (ctx, input) =>
      guard(ctx, async () => {
        await needType(store, input.type);
        return prefsOf(person(ctx), input.type);
      }),

    "records.page_prefs.set": (ctx, input) =>
      guard(ctx, async () => {
        await needType(store, input.type);
        const who = person(ctx);
        const have = prefsOf(who, input.type);
        const folded = input.folded === undefined ? have.folded : strings(input.folded);
        const keepVisible = input.keepVisible === undefined ? have.keepVisible : strings(input.keepVisible);
        if (!folded || !keepVisible)
          return fail(ctx, "validation.bad_input", "folded and keepVisible are lists of names.");
        tx.run(
          "INSERT INTO records_page_prefs (person, type, folded, keep_visible) VALUES (?, ?, ?, ?) ON CONFLICT(person, type) DO UPDATE SET folded = excluded.folded, keep_visible = excluded.keep_visible",
          who,
          input.type,
          JSON.stringify(folded),
          JSON.stringify(keepVisible),
        );
        return { folded, keepVisible };
      }),
  };
}
