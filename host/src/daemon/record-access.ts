import { authorize, providerMax, type AccessSnapshot, type Req } from "../../../kernel/src/authorize/index.ts";
import type { Store, StoredRecord } from "../../../kernel/src/store/types.ts";
import type { CtxSeed } from "../invoke.ts";
import { fail } from "../routes/errors.ts";
import { recordSensitivity } from "./record-sensitivity.ts";
import { canonical } from "../../../lib/canonical.ts";
import { mayReadComputed as sharedMayRead } from "../../../lib/computed-fields.ts";
import type { Filter, Sort } from "../../../kernel/src/store/types.ts";

type ReadSeed = CtxSeed & { readCap?: string; readInput?: unknown; labels?: Readonly<Record<string, number>> };
/** The writes whose answer is the record: a member who may edit a record but not see one of its fields is not handed that field back (a write is projected as a read of the record is). */
export const WRITES_ANSWERING_WITH_THE_RECORD: ReadonlySet<string> = new Set([
  "records.update",
  "records.restore_version",
  "records.relate",
  "records.values.review",
  "records.merge",
  "records.restore",
]);
/** Every capability whose answer is projected through the reader's grant (host/src/invoke.ts SCOPED_RECORD_READS is the same set; test/access.hidden-scrub-guard.test.ts walks the manifest against it). */
export const SCRUBBED: ReadonlySet<string> = new Set([
  "records.get",
  "records.get_many",
  "records.as_of",
  "records.query",
  "records.search",
  "records.history",
  "records.activity",
  "records.view",
  "records.update_many",
  ...WRITES_ANSWERING_WITH_THE_RECORD,
]);
const READS = SCRUBBED;
// How long a read waits, at most, for the access snapshot to learn of records it has just read (a record shows in the store a moment before its access entry is folded, and a busy Space folds slowly). The
// waits add up to about 3 s and cost nothing when the snapshot already knows every row.
const SETTLE_MS: readonly number[] = [0, 40, 120, 250, 500, 1000, 1000];
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
export function createRecordAccess(ports: {
  store(): Store;
  snapshot(): AccessSnapshot;
  now(): number;
  fresh(): boolean;
  refresh?(): Promise<void>;
  /** Read-only SQL on the Space store, for the computed values a record carries (records_computed) and the rows they were computed from. Absent: no computed value is added to a record. */
  rows?: { all(sql: string, ...args: unknown[]): unknown[] };
  /** The waits between folds (ms) when a read finds rows the snapshot does not know yet; tests shorten them. */
  settleMs?: readonly number[];
  warn?(info: {
    cap: string;
    type: string;
    traceId: string;
    returned: number;
    allowed: number;
    missing: string[];
  }): void;
}) {
  const cursors = new Map<string, { key: string; cursor: string; expires: number; skip: number; drop?: string[] }>();
  const random = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  function related(resourceId: string | null, type: string): boolean {
    const snapshot = ports.snapshot();
    return (
      resourceId !== null &&
      (snapshot.chain(type)?.some((parent) => parent.id === resourceId) === true ||
        snapshot.chain(resourceId)?.some((parent) => parent.id === type) === true ||
        snapshot.resource(resourceId)?.home === type)
    );
  }
  // a record cut off from its type (Only me) is still a row of the type, but no grant on the type reaches it
  function inType(
    snapshot: AccessSnapshot,
    resource: { id: string; home?: string | undefined },
    type: string,
  ): boolean {
    return resource.home === type || snapshot.chain(resource.id)?.some((parent) => parent.id === type) === true;
  }
  function subjects(req: Req): string[] {
    const output = [req.principal, ...(req.actingFor ? [req.actingFor] : [])];
    for (let at = 0; at < output.length; at++) {
      const info = ports.snapshot().info(output[at]!);
      if (info?.p.kind === "svc" && info.p.owner && !output.includes(info.p.owner)) output.push(info.p.owner);
    }
    return output;
  }
  /**
   * The sort or group fields this reader may not be able to read on SOME row, decided from their grants and the label rules alone, never from what the data holds. A field any of their grants hides, or whose label
   * is above their ceiling, is taken out of the sort for the whole read and every page: ordering by it (empty values come first) would tell them which rows hold a value.
   */
  function sortBlocked(
    req: Req,
    type: string,
    labels: Readonly<Record<string, number>>,
    roots: readonly string[],
  ): Set<string> {
    const out = new Set<string>();
    if (!roots.length) return out;
    const snapshot = ports.snapshot();
    for (const principal of subjects(req)) {
      const info = snapshot.info(principal);
      if (!info) throw fail("permission.no_grant", "sort");
      const exact = authorize(snapshot, { ...req, principal, actingFor: undefined });
      const grants = snapshot
        .allGrantRecs()
        .filter(
          (grant) =>
            info.keys.has(grant.key) &&
            grant.rank >= 1 &&
            grant.exp > ports.now() &&
            grant.nb <= ports.now() &&
            grant.na >= ports.now() &&
            (related(grant.row.resource_id, type) ||
              (grant.row.resource_id === null && grant.row.resource_type === "record")),
        );
      const hidden = new Set([
        ...(exact.effect === "allow" ? (exact.scope?.hiddenFields ?? []) : []),
        ...grants.flatMap((grant) => [...grant.hidden]),
      ]);
      let ceiling = Math.min(
        info.clearance,
        ...grants.map((grant) => grant.ceiling),
        ...(exact.effect === "allow" ? [exact.scope?.labelCeiling ?? -1] : []),
      );
      if (req.provider)
        for (const policy of snapshot.policies())
          if (policy.kind === "provider_label") ceiling = Math.min(ceiling, providerMax(policy, req.provider));
      for (const field of roots)
        if (
          computedDefOf(type, field) !== null ||
          hidden.has(field) ||
          (!["id", "version", "created_at", "updated_at"].includes(field) && labels[field] === undefined) ||
          (labels[field] ?? 0) > ceiling ||
          snapshot.fieldLabel(type, field) > ceiling ||
          snapshot.fieldLabel("record", field) > ceiling
        )
          out.add(field);
    }
    return out;
  }
  function assertFields(
    req: Req,
    type: string,
    labels: Readonly<Record<string, number>>,
    touched: readonly string[],
    trace: string,
  ): void {
    if (!touched.length) return;
    const snapshot = ports.snapshot();
    for (const principal of subjects(req)) {
      const info = snapshot.info(principal);
      if (!info) throw fail("permission.no_grant", trace);
      const exact = authorize(snapshot, { ...req, principal, actingFor: undefined });
      const grants = snapshot
        .allGrantRecs()
        .filter(
          (grant) =>
            info.keys.has(grant.key) &&
            grant.rank >= 1 &&
            grant.exp > ports.now() &&
            grant.nb <= ports.now() &&
            grant.na >= ports.now() &&
            (related(grant.row.resource_id, type) ||
              (grant.row.resource_id === null && grant.row.resource_type === "record")),
        );
      const hidden = new Set(
        exact.effect === "allow" ? (exact.scope?.hiddenFields ?? []) : grants.flatMap((grant) => [...grant.hidden]),
      );
      let ceiling =
        exact.effect === "allow"
          ? (exact.scope?.labelCeiling ?? -1)
          : Math.min(info.clearance, ...grants.map((grant) => grant.ceiling));
      if (req.provider)
        for (const policy of snapshot.policies())
          if (policy.kind === "provider_label") ceiling = Math.min(ceiling, providerMax(policy, req.provider));
      if (
        touched.some((path) => {
          const field = path.split(".")[0]!;
          return (
            hidden.has(field) ||
            (!["id", "version", "created_at", "updated_at"].includes(field) && labels[field] === undefined) ||
            (labels[field] ?? 0) > ceiling ||
            snapshot.fieldLabel(type, field) > ceiling ||
            snapshot.fieldLabel("record", field) > ceiling
          );
        })
      )
        throw fail("permission.no_grant", trace, {
          message: "Filtering, grouping or sorting by a hidden field is not allowed.",
        });
    }
  }
  function mayRead(req: Req, type: string): boolean {
    const snapshot = ports.snapshot();
    if (!ports.fresh() || snapshot.resource(type)?.type !== "record_type") return false;
    const required = [req.principal, ...(req.actingFor ? [req.actingFor] : [])];
    for (let at = 0; at < required.length; at++) {
      const info = snapshot.info(required[at]!);
      if (!info || info.p.status !== "active") return false;
      if (info.p.kind === "agent" && !req.actingFor) return false;
      if (info.p.kind === "svc" && info.p.owner && !required.includes(info.p.owner)) required.push(info.p.owner);
    }
    return required.every((principal) => {
      const direct = authorize(snapshot, {
        ...req,
        principal,
        actingFor: undefined,
        resource: { type: "record_type", id: type },
      });
      if (direct.effect === "allow") return true;
      const info = snapshot.info(principal)!;
      for (const grant of snapshot.allGrantRecs()) {
        if (
          !info.keys.has(grant.key) ||
          grant.rank < 1 ||
          grant.exp <= ports.now() ||
          grant.nb > ports.now() ||
          grant.na < ports.now()
        )
          continue;
        if (grant.row.resource_id === null && grant.row.resource_type === "record") return true;
        const resource = grant.row.resource_id ? snapshot.resource(grant.row.resource_id) : undefined;
        if (resource && related(resource.id, type)) return true;
      }
      return [...snapshot.allResources()].some(
        (resource) => resource.type === "record" && resource.owner_id === principal && inType(snapshot, resource, type),
      );
    });
  }
  function references(value: unknown): string[] {
    const output: string[] = [];
    const visit = (item: unknown): void => {
      if (Array.isArray(item)) {
        item.forEach(visit);
        return;
      }
      if (!item || typeof item !== "object") return;
      const row = object(item);
      if (typeof row["field"] === "string") output.push(row["field"]);
      Object.values(row).forEach(visit);
    };
    visit(value);
    return output;
  }
  /**
   * True when the snapshot is current and knows every one of these records. When it does not, fold what is pending and look again, waiting a little longer each time, up to the bound
   * (a record is in the store a moment before its access entry is folded, and a Space under a bulk write folds slowly). A record that is still unknown after the bound is not shown.
   */
  async function settle(ids: readonly string[]): Promise<boolean> {
    const lacking = () => !ports.fresh() || ids.some((id) => !ports.snapshot().resource(id));
    if (!lacking()) return true;
    if (!ports.refresh) return false;
    const waits = ports.settleMs ?? SETTLE_MS;
    for (const wait of waits) {
      await ports.refresh();
      if (!lacking()) return true;
      await new Promise((done) => setTimeout(done, wait));
    }
    await ports.refresh();
    return !lacking();
  }
  function stale(trace: string) {
    return fail("internal.unavailable", trace, {
      message: "Access is being refreshed. Try again in a moment.",
    });
  }
  function decision(seed: ReadSeed, row: StoredRecord) {
    const snapshot = ports.snapshot();
    if (!ports.fresh()) return null;
    const resource = snapshot.resource(row.id);
    if (!resource || resource.type !== "record") return null;
    const result = authorize(snapshot, {
      principal: seed.principal.id,
      actingFor: seed.actingFor,
      provider: seed.provider,
      cap: seed.readCap,
      input: seed.readInput,
      action: { perm: null, level: "view" },
      resource: { type: "record", id: row.id },
      row: { ...row.data, id: row.id, owner_id: resource.owner_id },
      now: ports.now(),
    });
    return result.effect === "allow" ? result : null;
  }
  // a relation value is a reference (vyre://<space>/<type>/<id>) to a record: one the caller may not see is not in the list, so the value cannot say it exists
  function seeable(seed: ReadSeed, value: unknown): unknown {
    if (!Array.isArray(value)) return value;
    const snapshot = ports.snapshot();
    return value.filter((item) => {
      const urn = item && typeof item === "object" ? (item as Record<string, unknown>)["urn"] : undefined;
      if (typeof urn !== "string") return true;
      const id = urn.split("/").pop()!;
      const resource = snapshot.resource(id);
      if (!resource || resource.type !== "record") return true;
      return (
        authorize(snapshot, {
          principal: seed.principal.id,
          actingFor: seed.actingFor,
          provider: seed.provider,
          action: { perm: null, level: "view" },
          resource: { type: "record", id },
          now: ports.now(),
        }).effect === "allow"
      );
    });
  }
  /** The rule for which fields of a record a reader sees: not hidden by the grant, labelled, and within the label ceiling of the grant, the reader's provider and the type. Null when the reader may not see the record. */
  function gateOf(seed: ReadSeed, row: StoredRecord): ((key: string) => boolean) | null {
    const result = decision(seed, row);
    if (!result) return null;
    const snapshot = ports.snapshot(),
      hidden = new Set(result.scope?.hiddenFields ?? []);
    let ceiling = result.scope?.labelCeiling ?? -1;
    if (seed.provider)
      for (const policy of snapshot.policies())
        if (policy.kind === "provider_label") ceiling = Math.min(ceiling, providerMax(policy, seed.provider));
    return (key) =>
      !hidden.has(key) &&
      seed.labels?.[key] !== undefined &&
      seed.labels[key] <= ceiling &&
      snapshot.fieldLabel(row.type, key) <= ceiling &&
      snapshot.fieldLabel("record", key) <= ceiling;
  }
  // ---- computed values (formula, lookup, rollup) ----
  // A computed value is kept in records_computed, never in the record. A reader gets it only when they may read EVERYTHING it was computed from: each field it reads on the record (not hidden by their grant, labelled
  // within their ceiling), and for a lookup or a rollup, the field it reads on EVERY record linked through the relation, each of those records visible to them. One link they cannot see, or one field they cannot read,
  // and the value is not there (empty, like a hidden field), never a smaller sum or a shorter list. A computed field read through another computed field is judged on that one's inputs too, a few hops deep.
  interface Side {
    field: string;
    value: string | null;
    inputs: string;
    kind: string;
    computed_at?: number;
    link_ids?: string | null;
  }
  const SAFE_TYPE = /^[a-z][a-z0-9_]{0,62}$/;
  /** Does this type have any computed value or fill? Asked once per read (per seed) for a type, so a page of records of a type with none costs one query, not two per record. */
  const hasComputed = (seed: ReadSeed, type: string): boolean => {
    if (!ports.rows || !SAFE_TYPE.test(type)) return false;
    const memo = typeHas.get(seed) ?? typeHas.set(seed, new Map()).get(seed)!;
    const had = memo.get(type);
    if (had !== undefined) return had;
    let yes = false;
    try {
      yes =
        ports.rows.all("SELECT 1 AS x FROM records_computed WHERE type = ? LIMIT 1", type).length > 0 ||
        ports.rows.all("SELECT 1 AS x FROM records_computed_job WHERE type = ? LIMIT 1", type).length > 0;
    } catch {
      yes = false;
    }
    memo.set(type, yes);
    return yes;
  };
  const typeHas = new WeakMap<object, Map<string, boolean>>();
  const updatingMemo = new WeakMap<object, Map<string, string[]>>();
  /** The definition of a computed field of a type, as the side table knows it: its kind and what it reads (type.field). Null when the field is not computed. Unknown inputs (a fill that has made no value yet) are null. */
  const computedDefOf = (type: string, field: string): { kind: string; inputs: string[] | null } | null => {
    if (!ports.rows || !SAFE_TYPE.test(type)) return null;
    try {
      const r = ports.rows.all(
        "SELECT kind, inputs FROM records_computed WHERE type = ? AND field = ? LIMIT 1",
        type,
        field,
      )[0] as { kind: string; inputs: string } | undefined;
      if (r) return { kind: r.kind, inputs: JSON.parse(r.inputs) as string[] };
      return ports.rows.all("SELECT 1 AS x FROM records_computed_job WHERE type = ? AND field = ? LIMIT 1", type, field)
        .length
        ? { kind: "unknown", inputs: null }
        : null;
    } catch {
      return null;
    }
  };
  /** Does this reader see everything of a type: every record, every field, within the label ceiling of their grant (the test that lets a read take the plain indexed path)? */
  async function unrestrictedOn(req: Req, type: string, trace: string): Promise<boolean> {
    const snapshot = ports.snapshot();
    const parent = authorize(snapshot, { ...req, resource: { type: "record_type", id: type } });
    const scope = parent.scope;
    if (
      parent.effect !== "allow" ||
      !scope ||
      scope.rowFilter ||
      scope.hiddenFields.length ||
      snapshot.cutFrom(type) > 0 ||
      req.provider
    )
      return false;
    if (scope.labelCeiling >= 3) return true;
    if (
      [...snapshot.allResources()].some(
        (r) => r.type === "record" && inType(snapshot, r, type) && r.label > scope.labelCeiling,
      )
    )
      return false;
    const definition = await ports.store().describe(type);
    const labels = await recordSensitivity(ports.store(), type, trace);
    return (
      !!definition &&
      definition.fields.every(
        (field) =>
          (labels[field.name] ?? 0) <= scope.labelCeiling &&
          snapshot.fieldLabel(type, field.name) <= scope.labelCeiling &&
          snapshot.fieldLabel("record", field.name) <= scope.labelCeiling,
      )
    );
  }
  /**
   * Does a sort, group or filter name a computed field this reader cannot be trusted to order or select by: one that reads another type they do not see in full, or whose inputs are not known yet? Decided from the
   * definition and their grants, never from the data. Such a read takes the restricted path, where the field counts as empty for sorting and a filter on it is refused.
   */
  async function computedNeedsScope(
    req: Req,
    type: string,
    names: readonly string[],
    trace: string,
    depth = 0,
  ): Promise<boolean> {
    for (const field of names) {
      const def = computedDefOf(type, field);
      if (!def) continue;
      if (def.inputs === null || depth > 3) return true;
      for (const input of def.inputs) {
        const [t, f] = input.split(".") as [string, string];
        if (t !== type && !(await unrestrictedOn(req, t, trace))) return true;
        if (await computedNeedsScope(req, t, [f], trace, depth + 1)) return true;
      }
    }
    return false;
  }
  const sideMemo = new WeakMap<object, Map<string, Side[]>>();
  const dataMemo = new WeakMap<object, Map<string, Record<string, unknown> | null>>();
  const SIDE_COLS = "type, id, field, value, inputs, kind, computed_at, link_ids";
  /**
   * Read the computed values and the rows they were computed from for a whole page of records of one type in two queries (one for the values, one for the rows), not two for each record. A read of a page asks
   * this first; a record it did not ask for is read alone, as before.
   */
  const prefetch = (seed: ReadSeed, type: string, ids: readonly string[]): void => {
    if (!ports.rows || !SAFE_TYPE.test(type) || !ids.length) return;
    const sides = sideMemo.get(seed) ?? sideMemo.set(seed, new Map()).get(seed)!;
    const datas = dataMemo.get(seed) ?? dataMemo.set(seed, new Map()).get(seed)!;
    const needSide = [...new Set(ids)].filter((id) => !sides.has(`${type}/${id}`));
    const needData = [...new Set(ids)].filter((id) => !datas.has(`${type}/${id}`));
    try {
      for (let at = 0; at < needSide.length; at += 500) {
        const part = needSide.slice(at, at + 500);
        const found = ports.rows.all(
          `SELECT ${SIDE_COLS} FROM records_computed WHERE type = ? AND id IN (${part.map(() => "?").join(",")})`,
          type,
          ...part,
        ) as Array<Side & { id: string }>;
        for (const id of part) sides.set(`${type}/${id}`, []);
        for (const r of found) sides.get(`${type}/${r.id}`)!.push(r);
      }
      for (let at = 0; at < needData.length; at += 500) {
        const part = needData.slice(at, at + 500);
        const found = ports.rows.all(
          `SELECT id, data FROM rt_${type} WHERE deleted_at IS NULL AND id IN (${part.map(() => "?").join(",")})`,
          ...part,
        ) as Array<{ id: string; data: string }>;
        for (const id of part) datas.set(`${type}/${id}`, null);
        for (const r of found) datas.set(`${type}/${r.id}`, JSON.parse(r.data) as Record<string, unknown>);
      }
    } catch {
      /* no side table or no such type here: each record is read alone and finds nothing */
    }
  };
  const sideOf = (seed: ReadSeed, type: string, id: string): Side[] => {
    if (!ports.rows || !SAFE_TYPE.test(type)) return [];
    const memo = sideMemo.get(seed) ?? sideMemo.set(seed, new Map()).get(seed)!;
    const had = memo.get(`${type}/${id}`);
    if (had) return had;
    try {
      const found = ports.rows.all(
        `SELECT ${SIDE_COLS} FROM records_computed WHERE type = ? AND id = ?`,
        type,
        id,
      ) as Side[];
      memo.set(`${type}/${id}`, found);
      return found;
    } catch {
      return [];
    }
  };
  const dataOf = (seed: ReadSeed, type: string, id: string): Record<string, unknown> | null => {
    if (!ports.rows || !SAFE_TYPE.test(type)) return null;
    const memo = dataMemo.get(seed) ?? dataMemo.set(seed, new Map()).get(seed)!;
    if (memo.has(`${type}/${id}`)) return memo.get(`${type}/${id}`) ?? null;
    try {
      const r = ports.rows.all(`SELECT data FROM rt_${type} WHERE id = ? AND deleted_at IS NULL`, id)[0] as
        | { data: string }
        | undefined;
      const data = r ? (JSON.parse(r.data) as Record<string, unknown>) : null;
      memo.set(`${type}/${id}`, data);
      return data;
    } catch {
      return null;
    }
  };
  const linkIds = (value: unknown): string[] => {
    const items = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
    const out: string[] = [];
    for (const item of items) {
      if (typeof item === "string") out.push(item);
      else if (item && typeof item === "object" && typeof (item as Record<string, unknown>)["urn"] === "string") {
        const part = ((item as Record<string, unknown>)["urn"] as string).slice(7).split("/");
        if (part.length >= 3 && part[2]) out.push(part[2]);
      }
    }
    return out;
  };
  const visibleMemo = new WeakMap<object, Map<string, boolean>>();
  /** May this reader see these fields of this record (the kernel's own question: the record, its row filter, the fields their grant hides, the label ceiling). */
  function visibleOn(seed: ReadSeed, type: string, id: string, names: readonly string[]): boolean {
    const memo = visibleMemo.get(seed) ?? visibleMemo.set(seed, new Map()).get(seed)!;
    const key = `${type}/${id}/${names.join(",")}`;
    const had = memo.get(key);
    if (had !== undefined) return had;
    const snapshot = ports.snapshot();
    const data = dataOf(seed, type, id);
    const resource = snapshot.resource(id);
    const ok =
      data !== null &&
      !!resource &&
      resource.type === "record" &&
      authorize(snapshot, {
        principal: seed.principal.id,
        actingFor: seed.actingFor,
        provider: seed.provider,
        cap: seed.readCap,
        input: seed.readInput,
        action: { perm: null, level: "view" },
        resource: { type: "record", id },
        fields: [...names],
        row: { ...data, id, owner_id: resource.owner_id },
        now: ports.now(),
      }).effect === "allow";
    memo.set(key, ok);
    return ok;
  }
  function mayReadComputed(seed: ReadSeed, type: string, id: string, c: Side, depth: number): boolean {
    return sharedMayRead(
      {
        visibleOn: (t, i, names) => visibleOn(seed, t, i, names),
        sideOf: (t, i) => sideOf(seed, t, i),
        prefetch: (t, ids) => prefetch(seed, t, ids),
      },
      type,
      id,
      c,
      depth,
    );
  }
  /** The computed values of one record this reader may read, as fields (gate: the rule for the record's own field names). */
  function computedFields(seed: ReadSeed, row: StoredRecord, gate: (key: string) => boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!hasComputed(seed, row.type)) return out;
    for (const c of sideOf(seed, row.type, row.id)) {
      if (!gate(c.field)) continue;
      if (!mayReadComputed(seed, row.type, row.id, c, 0)) continue;
      out[c.field] = c.value === null ? null : JSON.parse(c.value);
    }
    return out;
  }
  /** When each computed value the reader may read was computed, and which of the type's computed fields are being filled now (the app shows those as updating). Empty for a type with none. */
  function computedMeta(
    seed: ReadSeed,
    row: StoredRecord,
  ): { updating?: string[]; computedAt?: Record<string, number> } {
    if (!hasComputed(seed, row.type)) return {};
    const gate = gateOf(seed, row);
    if (!gate) return {};
    const at: Record<string, number> = {};
    for (const c of sideOf(seed, row.type, row.id))
      if (gate(c.field) && typeof c.computed_at === "number" && mayReadComputed(seed, row.type, row.id, c, 0))
        at[c.field] = c.computed_at;
    // the fields of the type being filled now, asked once per read for the type; each record shows the ones its reader may see
    const ups = updatingMemo.get(seed) ?? updatingMemo.set(seed, new Map()).get(seed)!;
    let filling = ups.get(row.type);
    if (!filling) {
      try {
        filling = (
          ports.rows!.all("SELECT field FROM records_computed_job WHERE type = ? AND state <> 'done'", row.type) as {
            field: string;
          }[]
        ).map((r) => r.field);
      } catch {
        filling = [];
      }
      ups.set(row.type, filling);
    }
    const updating = filling.filter((f) => gate(f));
    return { ...(updating.length ? { updating } : {}), ...(Object.keys(at).length ? { computedAt: at } : {}) };
  }
  function fields(
    seed: ReadSeed,
    row: StoredRecord,
    original: Record<string, unknown>,
    trace: string,
    withComputed = true,
  ) {
    const gate = gateOf(seed, row);
    if (!gate) throw fail("permission.no_grant", trace);
    return {
      ...Object.fromEntries(
        Object.entries(original)
          .filter(([key]) => gate(key))
          .map(([key, value]) => [key, seeable(seed, value)]),
      ),
      ...(withComputed ? computedFields(seed, row, gate) : {}),
    };
  }
  return {
    /**
     * Which fields of one record a reader may see, as a test on a field name (the rule `records.get` applies, kept in one place: gateOf). Null when the reader may not see the record, or it is gone. For the readers
     * that show what a record's events carried (the event log, a run, a notification): the values a grant hides are not in what they show.
     */
    async fieldGate(
      reader: { principal: string; actingFor?: string | undefined; provider?: string | undefined },
      type: string,
      recordId: string,
      trace: string,
      /** the labels of a type's fields, kept by the caller for the length of one read (a page of events over thousands of records asks the schema once per type, not once per record) */
      labels?: Map<string, Readonly<Record<string, number>>>,
      o: {
        /** the record is trashed (a deletion's event): judged on the kept row and its access entry */
        deleted?: boolean;
        /** wait, a bounded while, for the access snapshot to know a record the store already has (default); a reader that cannot wait passes false and gets "later" */
        settle?: boolean;
      } = {},
    ): Promise<((key: string) => boolean) | null | "later"> {
      const row = await ports.store().get(type, recordId, o.deleted === true ? { include_deleted: true } : undefined);
      if (!row) return null;
      // a record is in the store a moment before its access entry is folded: that is "not known yet", never "not visible". The caller decides what waiting for it means (an event shown now is cut; a trigger is retried).
      if (o.settle === false ? !ports.fresh() || !ports.snapshot().resource(row.id) : !(await settle([row.id])))
        return "later";
      let known = labels?.get(type);
      if (known === undefined) {
        known = await recordSensitivity(ports.store(), type, trace);
        labels?.set(type, known);
      }
      const seed = {
        principal: { id: reader.principal },
        actingFor: reader.actingFor,
        provider: reader.provider,
        labels: known,
      } as unknown as ReadSeed;
      return gateOf(seed, row);
    },
    async collection(
      cap: string,
      input: unknown,
      seed: ReadSeed,
      req: Req,
      trace: string,
    ): Promise<{ finish(): unknown } | null> {
      if (!["records.query", "records.search", "records.counts"].includes(cap)) return null;
      seed = { ...seed, readCap: cap, readInput: input };
      const value = object(input),
        type = value["type"];
      if (typeof type !== "string") throw fail("validation.bad_input", trace);
      if (!mayRead(req, type)) throw fail("permission.no_grant", trace);
      seed = { ...seed, labels: await recordSensitivity(ports.store(), type, trace) };
      const snapshot = ports.snapshot(),
        parent = authorize(snapshot, req),
        scope = parent.scope;
      if (parent.effect === "hold") throw fail("permission.needs_approval", trace);
      const cut = snapshot.cutFrom(type) > 0;
      const namedRoots = [
        ...references(value["filter"]),
        ...(Array.isArray(value["sort"]) ? (value["sort"] as Sort[]).map((row) => row.field) : []),
        ...(typeof value["group"] === "string" ? [value["group"]] : []),
      ].map((field) => field.split(".")[0]!);
      // a sort or filter by a computed field that reads a type this reader does not see in full goes the restricted way (the field is empty for sorting, a filter is refused)
      const computedRestricted = await computedNeedsScope(req, type, namedRoots, trace);
      if (
        !computedRestricted &&
        parent.effect === "allow" &&
        scope &&
        !scope.rowFilter &&
        !scope.hiddenFields.length &&
        scope.labelCeiling >= 3 &&
        !seed.provider &&
        !cut
      )
        return null;
      const children = [...snapshot.allResources()].filter(
        (resource) => resource.type === "record" && inType(snapshot, resource, type),
      );
      // Keep the existing indexed query/FTS path for unrestricted callers. The
      // scoped path below pages authorized rows, rather than filtering a raw page.
      if (
        !computedRestricted &&
        !seed.provider &&
        !cut &&
        parent.effect === "allow" &&
        scope &&
        !scope.rowFilter &&
        !scope.hiddenFields.length &&
        children.every((resource) => resource.label <= scope.labelCeiling)
      ) {
        const definition = await ports.store().describe(type);
        if (
          definition?.fields.every(
            (field) =>
              (seed.labels?.[field.name] ?? 0) <= scope.labelCeiling &&
              snapshot.fieldLabel(type, field.name) <= scope.labelCeiling &&
              snapshot.fieldLabel("record", field.name) <= scope.labelCeiling,
          )
        )
          return null;
      }
      await this.facts("records.query", input, req, trace);
      const { cursor: _cursor, offset: _offset, ...query } = value,
        key = canonical({
          cap,
          query,
          principal: seed.principal,
          actingFor: seed.actingFor ?? null,
          provider: seed.provider ?? null,
          space: seed.space,
        });
      let cursor: string | undefined;
      let remainingSkip: number | undefined;
      let saved0: { drop?: string[] } | undefined;
      if (value["cursor"] !== undefined) {
        const saved = typeof value["cursor"] === "string" ? cursors.get(value["cursor"]) : undefined;
        if (!saved || saved.key !== key || saved.expires <= ports.now())
          throw fail("validation.bad_input", trace, { message: "This page expired. Refresh the list." });
        cursor = saved.cursor;
        remainingSkip = saved.skip;
        saved0 = saved;
      }
      const limit = typeof value["limit"] === "number" ? value["limit"] : cap === "records.search" ? 50 : 200;
      let skip = remainingSkip ?? (typeof value["offset"] === "number" ? value["offset"] : 0);
      if (!Number.isInteger(skip) || skip < 0) throw fail("validation.bad_input", trace);
      // A sort or a group by a field this reader may not see: that field is EMPTY for them, so it does not order their rows (the rows keep the order of the other keys, then the default order). Ordering by the real
      // value would tell them the order of values they cannot read. `drop` holds the fields the reader's grants or the label rules can hide on some row (sortBlocked: decided before the first query, never from the data); they stay out of every page, and the page token keeps them.
      const drop = new Set<string>(saved0?.drop ?? []);
      const askedSort = [...(Array.isArray(value["sort"]) ? value["sort"] : [])] as Sort[];
      if (typeof value["group"] === "string" && !askedSort.some((row) => row.field === value["group"]))
        askedSort.unshift({ field: value["group"], dir: "asc" });
      const touched = references(value["filter"]).map((field) => field.split(".")[0]!);
      if (touched.some((field) => computedDefOf(type, field) !== null))
        throw fail("permission.no_grant", trace, {
          message: "Filtering by a computed field is not available with the access you have to this table.",
        });
      const sortRoots = (): string[] => askedSort.map((row) => row.field.split(".")[0]!);
      if (!saved0) for (const field of sortBlocked(req, type, seed.labels ?? {}, sortRoots())) drop.add(field);
      const sort = askedSort.filter((row) => !drop.has(row.field.split(".")[0]!));
      assertFields(req, type, seed.labels ?? {}, touched, trace);
      const requested = Array.isArray(value["fields"]) ? new Set(value["fields"] as string[]) : null;
      const words =
        cap === "records.search"
          ? (String(value["q"] ?? "")
              .toLocaleLowerCase()
              .match(/[\p{L}\p{N}_]+/gu) ?? [])
          : [];
      const rows: StoredRecord[] = [];
      let scanned = 0;
      let gaveUp = false;
      do {
        const before = cursor;
        const page = await ports.store().query(type, {
          ...(value["filter"] !== undefined ? { filter: value["filter"] as Filter } : {}),
          ...(sort.length ? { sort } : {}),
          page: { limit: 1, ...(cursor ? { cursor } : {}) },
        });
        if (!mayRead(req, type)) throw fail("permission.no_grant", trace);
        const row = page.rows[0];
        cursor = page.next_cursor;
        scanned++;
        // a row the snapshot does not know yet is waited for once, not skipped: a skipped row would be missing from every later page. After one wait that found nothing, the rest of this read does not wait again.
        if (row && !gaveUp && !(await settle([row.id]))) gaveUp = ports.fresh();
        if (row && !ports.fresh()) throw stale(trace);
        if (row && decision(seed, row)) {
          const visible = fields(seed, row, row.data, trace);
          const sortable = touched.every(
            (field) => ["id", "version", "created_at", "updated_at"].includes(field) || Object.hasOwn(visible, field),
          );
          const actual =
            Object.values(visible)
              .filter((item) => typeof item === "string")
              .join(" ")
              .toLocaleLowerCase()
              .match(/[\p{L}\p{N}_]+/gu) ?? [];
          if (
            sortable &&
            (cap !== "records.search" ||
              (words.length > 0 && words.every((word) => actual.some((item) => item.startsWith(word)))))
          ) {
            if (cap === "records.counts") rows.push(row);
            else if (skip > 0) skip--;
            else {
              rows.push(row);
              if (rows.length > limit) {
                rows.pop();
                cursor = before;
                break;
              }
            }
          }
        }
        if (cap === "records.counts" && cursor && scanned >= 5000)
          throw fail("validation.precondition_failed", trace, {
            message: "This restricted count exceeds the 5,000-row scan limit. Narrow the filter and retry.",
          });
        if (cap !== "records.counts" && scanned >= 2000) break;
      } while (cursor);
      let next: string | undefined;
      if (cursor && cap !== "records.counts") {
        for (const [token, saved] of cursors) if (saved.expires <= ports.now()) cursors.delete(token);
        if (cursors.size >= 2000) cursors.delete(cursors.keys().next().value!);
        next = random();
        cursors.set(next, {
          key,
          cursor,
          expires: ports.now() + 3600000,
          skip,
          ...(drop.size ? { drop: [...drop] } : {}),
        });
      }
      return {
        finish: async () => {
          seed = { ...seed, labels: await recordSensitivity(ports.store(), type, trace) };
          if (!mayRead(req, type)) throw fail("permission.no_grant", trace);
          assertFields(req, type, seed.labels ?? {}, touched, trace);
          if (cap === "records.counts")
            return {
              count: rows.filter((row) => {
                if (!decision(seed, row)) return false;
                const visible = fields(seed, row, row.data, trace);
                return touched.every(
                  (field) =>
                    ["id", "version", "created_at", "updated_at"].includes(field) || Object.hasOwn(visible, field),
                );
              }).length,
            };
          if (hasComputed(seed, type))
            prefetch(
              seed,
              type,
              rows.map((r) => r.id),
            );
          return {
            rows: rows.flatMap((row) => {
              const result = decision(seed, row);
              if (!result) return [];
              const resource = ports.snapshot().resource(row.id)!;
              const projected = fields(seed, row, row.data, trace);
              if (
                !touched.every(
                  (field) =>
                    ["id", "version", "created_at", "updated_at"].includes(field) || Object.hasOwn(projected, field),
                )
              )
                return [];
              if (cap === "records.search") {
                const actual =
                  Object.values(projected)
                    .filter((item) => typeof item === "string")
                    .join(" ")
                    .toLocaleLowerCase()
                    .match(/[\p{L}\p{N}_]+/gu) ?? [];
                if (!words.every((word) => actual.some((item) => item.startsWith(word)))) return [];
              }
              return [
                {
                  id: row.id,
                  type: row.type,
                  version: row.version,
                  label: resource.label,
                  fields: requested
                    ? Object.fromEntries(Object.entries(projected).filter(([field]) => requested.has(field)))
                    : projected,
                  createdAt: row.created_at,
                  updatedAt: row.updated_at,
                  holds: resource.holds,
                  ...computedMeta(seed, row),
                },
              ];
            }),
            ...(next ? { next } : {}),
          };
        },
      };
    },
    async facts(cap: string, input: unknown, req: Req, trace: string): Promise<Req> {
      if (cap === "records.query") {
        const value = object(input),
          type = value["type"];
        if (typeof type === "string") {
          const labels = await recordSensitivity(ports.store(), type, trace);
          const touched: string[] = [];
          const visit = (item: unknown): void => {
            if (Array.isArray(item)) {
              item.forEach(visit);
              return;
            }
            if (!item || typeof item !== "object") return;
            const row = object(item);
            if (typeof row["field"] === "string") touched.push(row["field"]);
            Object.values(row).forEach(visit);
          };
          // a sort or a group by a field this reader may not see is not refused: that field counts as empty for them (see collection), so only the filter names fields that must be visible
          visit(value["filter"]);
          assertFields(req, type, labels, touched, trace);
        }
        return req;
      }
      if (!["records.get", "records.as_of", "records.history", "records.activity"].includes(cap)) return req;
      const value = object(input);
      if (typeof value["type"] !== "string" || typeof value["recordId"] !== "string") return req;
      const row = await ports.store().get(value["type"], value["recordId"]);
      if (!row) return req;
      const resource = ports.snapshot().resource(row.id);
      return { ...req, row: { ...row.data, id: row.id, owner_id: resource?.owner_id ?? null }, now: ports.now() };
    },
    async project(cap: string, input: unknown, seed: ReadSeed, output: unknown, trace: string): Promise<() => unknown> {
      if (!READS.has(cap)) return () => output;
      seed = { ...seed, readCap: cap, readInput: input };
      const value = object(input),
        result = object(output);
      const type = value["type"];
      if (typeof type !== "string") throw fail("validation.bad_input", trace);
      if (cap === "records.history" || cap === "records.activity") {
        const id = value["recordId"];
        const row = typeof id === "string" ? await ports.store().get(type, id) : null;
        if (!row) throw fail("permission.no_grant", trace);
        return async () => {
          seed = { ...seed, labels: await recordSensitivity(ports.store(), type, trace) };
          const visible = fields(seed, row, row.data, trace);
          return {
            ...result,
            entries: (Array.isArray(result["entries"]) ? result["entries"] : []).filter((entry) =>
              typeof object(entry)["field"] === "string"
                ? Object.hasOwn(visible, object(entry)["field"] as string)
                : cap === "records.activity",
            ),
          };
        };
      }
      if (cap === "records.update_many") {
        const items = Array.isArray(result["results"]) ? result["results"].map(object) : [];
        const stored = await Promise.all(
          items.map((item) => {
            const id = object(item["record"])["id"];
            return typeof id === "string" ? ports.store().get(type, id) : Promise.resolve(null);
          }),
        );
        return async () => {
          seed = { ...seed, labels: await recordSensitivity(ports.store(), type, trace) };
          return {
            ...result,
            results: items.map((item, index) => {
              if (item["record"] === undefined) return item;
              const row = stored[index];
              const record = object(item["record"]);
              // a record the caller can no longer see, or one the store does not have, comes back with no fields at all
              const visible = row && decision(seed, row) ? fields(seed, row, object(record["fields"]), trace) : {};
              return {
                ...item,
                record: { ...record, fields: visible, ...(row && decision(seed, row) ? computedMeta(seed, row) : {}) },
              };
            }),
          };
        };
      }
      if (WRITES_ANSWERING_WITH_THE_RECORD.has(cap)) {
        const record = object(result["record"]);
        const id = record["id"] ?? value["recordId"];
        const row = typeof id === "string" ? await ports.store().get(type, id) : null;
        return async () => {
          seed = { ...seed, labels: await recordSensitivity(ports.store(), type, trace) };
          const visible = row && decision(seed, row) ? fields(seed, row, object(record["fields"]), trace) : {};
          return {
            ...result,
            record: { ...record, fields: visible, ...(row && decision(seed, row) ? computedMeta(seed, row) : {}) },
          };
        };
      }
      const originals =
        cap === "records.get" || cap === "records.as_of"
          ? [object(result["record"])]
          : Array.isArray(result["rows"])
            ? result["rows"].map(object)
            : [];
      const stored = await Promise.all(
        originals.map((row) =>
          typeof row["id"] === "string" ? ports.store().get(type, row["id"]) : Promise.resolve(null),
        ),
      );
      return async () => {
        seed = { ...seed, labels: await recordSensitivity(ports.store(), type, trace) };
        if (hasComputed(seed, type))
          prefetch(
            seed,
            type,
            stored.flatMap((r) => (r ? [r.id] : [])),
          );
        const read = () =>
          originals.flatMap((original, index) => {
            const row = stored[index];
            if (!row || !decision(seed, row)) return [];
            const visible = fields(seed, row, object(original["fields"]), trace, cap !== "records.as_of");
            if (cap === "records.query") {
              const touched = [
                ...references(value["filter"]),
                ...references(value["sort"]),
                ...(typeof value["group"] === "string" ? [value["group"]] : []),
              ].map((field) => field.split(".")[0]!);
              const complete = fields(seed, row, row.data, trace);
              if (
                touched.some(
                  (field) =>
                    !["id", "version", "created_at", "updated_at"].includes(field) &&
                    Object.hasOwn(row.data, field) &&
                    !Object.hasOwn(complete, field),
                )
              )
                throw fail("permission.no_grant", trace);
            }
            if (cap === "records.search") {
              const words =
                String(value["q"] ?? "")
                  .toLocaleLowerCase()
                  .match(/[\p{L}\p{N}_]+/gu) ?? [];
              const body = Object.values(visible)
                .filter((item) => typeof item === "string")
                .join(" ")
                .toLocaleLowerCase();
              const actual = body.match(/[\p{L}\p{N}_]+/gu) ?? [];
              if (!words.length || !words.every((word) => actual.some((item) => item.startsWith(word)))) return [];
            }
            return [{ ...original, fields: visible, ...(cap === "records.as_of" ? {} : computedMeta(seed, row)) }];
          });
        // A row the read returned may belong to a record this Space wrote a moment ago (a run, a hook, a sync) whose access entry is not in the snapshot yet: the record is visible a little before its access
        // event is folded. Wait for the fold, a bounded while (settle), reading the stored rows afresh each time, before judging the page. After that, a row that is not shown is one that is no longer there or
        // one this person may no longer see: it is left out and the rest of the page is answered (the page is never refused for it, and nothing is shown that the snapshot does not allow).
        let rows = read();
        if (rows.length !== originals.length) {
          const known = originals.flatMap((row, index) =>
            stored[index] && typeof row["id"] === "string" ? [row["id"]] : [],
          );
          await settle(known);
          const again = await Promise.all(
            originals.map((row) =>
              typeof row["id"] === "string" ? ports.store().get(type, row["id"]) : Promise.resolve(null),
            ),
          );
          again.forEach((row, index) => {
            stored[index] = row;
          });
          rows = read();
        }
        // a snapshot that could not be brought up to date cannot say what is visible: refuse the read (it can be asked again) instead of answering a page with rows missing
        if (rows.length !== originals.length && !ports.fresh()) throw stale(trace);
        // get_many names ids the caller may not see or that are gone: those are left out by design, not a read that lost rows
        if (rows.length !== originals.length && ports.warn && cap !== "records.get_many") {
          const kept = new Set(rows.map((row) => String(object(row)["id"])));
          ports.warn({
            cap,
            type,
            traceId: trace,
            returned: originals.length,
            allowed: rows.length,
            missing: originals
              .map((row) => String(row["id"]))
              .filter((id) => !kept.has(id))
              .slice(0, 20),
          });
        }
        if (cap === "records.get" || cap === "records.as_of") {
          if (!rows[0]) throw fail("permission.no_grant", trace);
          return { ...result, record: rows[0] };
        }
        const { total: _total, ...rest } = result;
        return { ...rest, rows };
      };
    },
  };
}
