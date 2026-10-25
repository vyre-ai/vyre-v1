// Site tables in Records (spec 2.20 Site tables, 3.4 sidebar; ARCH 7.4). A site table is a record type scoped to one site: made by the site's agent or anyone who can edit the site, no schema
// permission needed, listed in Records under a Sites group, and absent from the Console's "create a record type" list. Promoting it makes it a normal Space record type: the key stays, so its
// rows stay. Module sites decides who may do either (it checks edit and schema.manage) and raises site.table_created and site.table_promoted; this file projects the type from those events.
// DECISION: a site table carries `scope: "site"`, `site_id`, `group: "Sites"` and `console_create: false` in its type definition; a promoted one carries `scope: "space"` and
// `promoted_from_site` and none of the other three, so it is listed with every other type.
// DECISION: both handlers are idempotent and order-tolerant. The same event twice changes nothing. A created event that arrives after the promotion of the same table (a replay out of order)
// changes nothing, so a table is never scoped back to its site. A promotion that arrives before its creation is refused with unknown_type: the host retries it once the creation has landed.
// DECISION: the fields come from the event's optional `fields` (key, type, title). The frozen site.table_created payload names only siteId and type today, so until it carries the fields
// (or module sites offers a read of them) the type is made with no fields. This is the one contract gap of this packet; see the packet comment.
import { StoreError } from "../../../kernel/src/store/types.ts";
import type { FieldDef, Store, TypeDef } from "../../../kernel/src/store/types.ts";
import { TYPE_NAME } from "../projections.ts";

export interface SiteField { key: string; type: string; title?: string }
export interface SiteTableEvent { siteId: string; type: string; fields?: readonly SiteField[] }

export const SITES_GROUP = "Sites";
const SITE_ID = /^sit_[a-z0-9]+$/;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,62}$/;
const KIND = /^[a-z][a-z0-9_.]{0,39}$/;

const refuse = (message: string): never => { throw new StoreError("invalid", message); };

/** Is this type a site table that still belongs to its site? */
export const isSiteTable = (def: Record<string, unknown>): boolean => def["scope"] === "site" && typeof def["site_id"] === "string";
/** The site a table belongs to, or was promoted from. */
export const siteOf = (def: Record<string, unknown>): string | undefined => {
  const a = def["site_id"], b = def["promoted_from_site"];
  return typeof a === "string" ? a : typeof b === "string" ? b : undefined;
};
/** The Console's "create a record type" offers every type except the ones a site made for itself. */
export const consoleCreatable = (def: Record<string, unknown>): boolean => def["console_create"] !== false;
/** Records lists a site table under the Sites group; any other type lists under its own group. */
export const listGroup = (def: Record<string, unknown>): string | undefined => (isSiteTable(def) ? SITES_GROUP : typeof def["group"] === "string" ? def["group"] : undefined);

/** Site tables of one site that are still scoped to it (a promoted table is a Space type and is not listed here). */
export async function siteTablesOf(store: Store, siteId: string): Promise<TypeDef[]> {
  return (await store.types()).filter((t) => isSiteTable(t) && t["site_id"] === siteId);
}

function label(type: string): string {
  const key = /^site_[0-9a-f]+_(.+)$/.exec(type)?.[1] ?? type;
  const words = key.replace(/_+/g, " ").trim();
  return words.length === 0 ? type : words[0]!.toUpperCase() + words.slice(1);
}

function fieldsOf(raw: readonly SiteField[] | undefined): FieldDef[] {
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const f of raw ?? []) {
    if (!f || typeof f.key !== "string" || !FIELD_KEY.test(f.key)) refuse(`${String(f?.key)} is not a field key`);
    if (typeof f.type !== "string" || !KIND.test(f.type)) refuse(`${f.key} has no field type`);
    if (seen.has(f.key)) refuse(`the field ${f.key} is listed twice`);
    seen.add(f.key);
    const title = typeof f.title === "string" && f.title.trim() !== "" ? f.title.trim() : f.key;
    out.push({ name: f.key, kind: f.type, label: title });
  }
  return out;
}

function check(ev: SiteTableEvent): void {
  if (!ev || typeof ev.siteId !== "string" || !SITE_ID.test(ev.siteId)) refuse(`${String(ev?.siteId)} is not a site id`);
  if (typeof ev.type !== "string" || !TYPE_NAME.test(ev.type) || !ev.type.startsWith("site_")) refuse(`${String(ev?.type)} is not a site table key`);
}

export interface SiteTableHandlers {
  /** site.table_created: make the record type, scoped to the site. */
  created(ev: SiteTableEvent): Promise<{ applied: boolean; type: string }>;
  /** site.table_promoted: make the type a normal Space record type. */
  promoted(ev: SiteTableEvent): Promise<{ applied: boolean; type: string }>;
}

export function createSiteTableHandlers(deps: { store: Store }): SiteTableHandlers {
  const find = async (type: string): Promise<TypeDef | undefined> => (await deps.store.types()).find((t) => t.name === type);
  return {
    async created(ev) {
      check(ev);
      const have = await find(ev.type);
      if (have) {
        // the same table again, or the same table after its promotion: nothing to do
        if (siteOf(have) === ev.siteId) return { applied: false, type: ev.type };
        refuse(`${ev.type} already exists and does not belong to site ${ev.siteId}`);
      }
      const def: TypeDef = { name: ev.type, label: label(ev.type), fields: fieldsOf(ev.fields), scope: "site", site_id: ev.siteId, group: SITES_GROUP, console_create: false };
      const res = await deps.store.define({ add_types: [def] });
      return { applied: res.applied, type: ev.type };
    },
    async promoted(ev) {
      check(ev);
      const have = await find(ev.type);
      if (!have) throw new StoreError("unknown_type", `no site table ${ev.type} yet`);
      if (siteOf(have) !== ev.siteId) refuse(`${ev.type} does not belong to site ${ev.siteId}`);
      if (have["scope"] === "space") return { applied: false, type: ev.type };
      const def: TypeDef = { ...have, scope: "space", promoted_from_site: ev.siteId };
      delete def["site_id"];
      delete def["group"];
      delete def["console_create"];
      const res = await deps.store.define({ change_types: [def] });
      return { applied: res.applied, type: ev.type };
    },
  };
}
