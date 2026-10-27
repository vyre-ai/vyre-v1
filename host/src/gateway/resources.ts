// P-H_16: resources register themselves. When a capability creates an object of a resource type (a record, a record type, a kit, a folder ...), the invoke pipeline appends one
// `resource.created` event to the same commit, so the new object is in the access snapshot the moment the call returns and is authorizable at once. This is the one place that does it for
// every module; modules never append resource rows themselves.
//
// How the pipeline knows an object was created: every event in the registry names its subject (a resource type and a JSON pointer to the id in its payload). An emitted event whose subject
// is a resource type, whose id is well formed for that type and is not in the access snapshot yet, registers that subject. Events that end an object (deleted, dropped, removed ...) never
// register one. The first event about an object is its birth, whatever it is called (`record.created`, `schema.type_changed` for a new record type, `kit.installed`).
//   parent  the capability's own container (the `parent` pointer of its resource binding, read from the input) when that container is a known resource, else the Space
//   owner   the person the birth event names as ownerId when the type opts in (OWNER_NAMED), else the person the call acts for (the principal when nobody is acted for)
import type { ResourceRow } from "../../../kernel/src/authorize/index.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { CapabilityDef } from "../../../packages/contracts/src/types.ts";
import { pointer } from "../routes/resource.ts";

/** The part of a registry event the registrar reads. */
export interface SubjectDef { name: string; subject: { type: string; id: string } }

/** Id shape per resource type; null = any non-empty id without spaces (record types are keys, connectors are names). */
const ID_SHAPE: Readonly<Record<string, RegExp | null>> = Object.freeze({
  space: /^spc_[a-z0-9]+$/, record: /^rec_[a-z0-9]+$/, record_type: /^[a-z][a-z0-9_]*$/, project: /^prj_[a-z0-9]+$/, folder: /^fld_[a-z0-9]+$/, file: /^fil_[a-z0-9]+$/,
  channel: /^chn_[a-z0-9]+$/, thread: /^thr_[a-z0-9]+$/, mailbox: /^mbx_[a-z0-9]+$/, vault_folder: /^vfd_[a-z0-9]+$/, vault_item: /^vit_[a-z0-9]+$/, automation: /^aut_[a-z0-9]+$/,
  agent: /^agt_[a-z0-9]+$/, connection: /^con_[a-z0-9]+$/, site: /^sit_[a-z0-9]+$/, form: /^frm_[a-z0-9]+$/, campaign: /^cmp_[a-z0-9]+$/, kit: /^kit_[a-z0-9]+$/,
  terminal: /^trm_[a-z0-9]+$/, computer: /^cmt_[a-z0-9]+$/, task: /^tsk_[a-z0-9]+$/, run: /^run_[a-z0-9]+$/, number: /^num_[a-z0-9]+$/, domain: /^dom_[a-z0-9]+$/, note: /^not_[a-z0-9]+$/, email: /^eml_[a-z0-9]+$/,
  inbox: null, automation_group: null, connector: null, calendar: null,
});
/**
 * Resource types whose birth event may name the owner (its payload `ownerId`). Opt-in per type: the capability that creates one of these decides who may assign an owner other than the caller
 * (agents.create refuses a caller who is not an owner or admin), so the registrar only records what that capability allowed.
 */
const OWNER_NAMED: ReadonlySet<string> = new Set(["agent"]);
/** Every resource type the registrar checks ids for. */
export const KNOWN_TYPES: readonly string[] = Object.freeze(Object.keys(ID_SHAPE));
const ANY_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
/** Events that end an object: they never register one. */
const ENDS = /(^|[._])(deleted|dropped|removed|purged|erased|destroyed|revoked|expired|archived|left|closed)$/;

/** Does `id` look like a `type` id? */
export function idFits(type: string, id: string): boolean {
  if (!(type in ID_SHAPE)) return false;
  const shape = ID_SHAPE[type];
  return shape === null ? ANY_ID.test(id) : shape!.test(id);
}

export interface RegisterArgs {
  cap: Pick<CapabilityDef, "resource" | "name">;
  input: unknown;
  space: string;
  /** who the call acts for, or the principal */
  owner: string;
  /** the events the handler emitted, in order */
  events: readonly Pick<EventEnvelope, "type" | "payload">[];
}
export interface ResourceRegistrar {
  /** The resource rows to append (as `resource.created` payloads) for the objects these events bring into being. */
  register(a: RegisterArgs): ResourceRow[];
}

export interface RegistrarDeps {
  /** registry events: name to subject */
  events: readonly SubjectDef[];
  /** is this id already a resource in the access snapshot? */
  exists(id: string): boolean;
}

export function createResourceRegistrar(deps: RegistrarDeps): ResourceRegistrar {
  const subjects = new Map<string, SubjectDef["subject"]>();
  for (const e of deps.events) if (e.subject.type !== "entity" && !ENDS.test(e.name)) subjects.set(e.name, e.subject);
  return {
    register(a) {
      const out: ResourceRow[] = [];
      let parentPtr: string | undefined;
      const b = a.cap.resource as { parent?: string };
      if (typeof b.parent === "string") parentPtr = b.parent;
      const given = parentPtr === undefined ? null : pointer(a.input, parentPtr);
      const seen = new Set<string>();
      for (const ev of a.events) {
        const s = subjects.get(ev.type);
        if (!s) continue;
        // Agent follow-up events are also scoped to their agent. They must never create a
        // missing access resource: a concurrent host consumer would otherwise claim it as
        // svc_host before the agent.created commit reaches the access snapshot.
        if (s.type === "agent" && ev.type !== "agent.created") continue;
        const id = pointer(ev.payload, s.id);
        if (typeof id !== "string" || !idFits(s.type, id) || seen.has(id) || deps.exists(id)) continue;
        seen.add(id);
        const container = typeof given === "string" && given !== id && (deps.exists(given) || seen.has(given)) ? given : a.space;
        // a birth event that names its owner (agent.created names ownerId) says whose the object is; otherwise the person the call acts for
        const named = OWNER_NAMED.has(s.type) ? pointer(ev.payload, "/ownerId") : undefined;
        out.push({ id, type: s.type, parent_id: s.type === "space" ? null : container, label: 0, owner_id: typeof named === "string" && /^usr_[a-z0-9]+$/.test(named) ? named : a.owner, holds: 0 });
      }
      return out;
    },
  };
}
