// Turning a capability's ResourceBinding (3.2) and its input into the ResourceRef authorize checks.
import type { CapabilityDef, ResourceBinding } from "../../../packages/contracts/src/types.ts";
import type { ResourceRef } from "../../../kernel/src/authorize/index.ts";

/** RFC 6901 pointer lookup; undefined when any step is missing. */
export function pointer(doc: unknown, ptr: string): unknown {
  if (ptr === "" || ptr === "/") return doc;
  let cur: unknown = doc;
  for (const raw of ptr.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export class BindingError extends Error {
  pointer: string;
  constructor(pointerPath: string, message: string) { super(message); this.name = "BindingError"; this.pointer = pointerPath; }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** @param spaceId the Space id (a `space` binding is the Space itself) @param resolve turns a Vault name or handle into the item id */
export function resolveResource(
  cap: Pick<CapabilityDef, "resource">, input: unknown, spaceId: string, resolve?: (type: string, kind: "name" | "handle", value: string) => string | null, caller?: { kind: string },
): ResourceRef {
  const b: ResourceBinding = cap.resource;
  if ("create" in b && b.create === true) {
    // no container named: the thing is made in the Space itself (a task with no record, the Gate's Approve task); a capability that needs a container has it required in its input schema
    const parent = str(pointer(input, b.parent)) ?? spaceId;
    return { type: b.type, id: null, parent };
  }
  if (b.type === "dynamic") {
    const ref = pointer(input, b.ref) as { type?: unknown; id?: unknown } | undefined;
    const type = str(ref?.type), id = str(ref?.id);
    if (!type || !id) throw new BindingError(b.ref, "needs a { type, id } reference");
    if (b.allowed && !(b.allowed as string[]).includes(type)) throw new BindingError(b.ref, `type ${type} is not allowed here`);
    return { type, id };
  }
  if (b.type === "entity") {
    const id = str(pointer(input, b.id));
    if (!id) throw new BindingError(b.id, "the row id is missing");
    return { type: b.entity, id };
  }
  if (!("id" in b)) return { type: "space", id: spaceId };   // the `space` binding is the only one left without an id
  const raw = str(pointer(input, b.id));
  // an agent that leaves the id out of a self binding (the chrome, screen and files tools) means its own computer or Space browser: the call is bound to the Space, where its role and grant are
  // checked, and the handler keeps it to the caller's own (modules/computers/handlers/tools/common.ts prepare). Anyone else must still name the thing.
  if (!raw && "self" in b && b.self === "agent" && caller?.kind === "agent") return { type: "space", id: spaceId };
  if (!raw) throw new BindingError(b.id, "the id is missing");
  if ("resolve" in b && b.resolve) {
    const id = resolve ? resolve(b.type, b.resolve, raw) : raw;
    if (!id) throw new BindingError(b.id, "no such item");
    return { type: b.type, id };
  }
  return { type: b.type, id: raw };
}

/** Did an agent leave the id out of a self binding (the call is about its own computer or Space browser, bound to the Space)? */
export function isSelfBound(cap: Pick<CapabilityDef, "resource">, input: unknown, caller?: { kind: string }): boolean {
  const b = cap.resource as { id?: string; self?: string };
  return b.self === "agent" && caller?.kind === "agent" && typeof b.id === "string" && !str(pointer(input, b.id));
}

/**
 * What a self-bound call really reaches, for the chat answer check and the audit row (review S1, S4, 12 Nov): the asking person's own Chrome (inMyChrome) is the computer "my-chrome", which
 * only the asker sees; a chrome tool otherwise works in the agent's own Space browser profile, judged by the browser's own rule for who may watch that profile; anything else (the agent's own
 * computer, which the gateway cannot tell yet) is unknown, "*", which never shares an answer.
 */
export function selfTarget(cap: Pick<CapabilityDef, "name">, input: unknown, agentId: string): { type: string; id: string | null } {
  const i = (input ?? {}) as { inMyChrome?: unknown };
  if (i.inMyChrome === true) return { type: "computer", id: "my-chrome" };
  if (cap.name.startsWith("computers.chrome.")) return { type: "browser_profile", id: agentId };
  return { type: "*", id: null };
}

/** The refusal a person gets for leaving the computer out: what to pass, in plain words. */
export const SELF_BINDING_LINE = "Say which computer to use: pass its computerId. Leaving it out means an agent's own computer or browser, and only an agent has those.";

/** The resource an audit row names: for a self-bound call what it reached (the agent's own computer when the gateway cannot tell its id), else the bound resource itself. */
export function auditResourceOf<R extends { type: string; id: string | null }>(cap: Pick<CapabilityDef, "resource" | "name">, input: unknown, caller: { kind: string; id: string }, resource: R | null): R | { type: string; id: string | null } | null {
  if (resource === null || !isSelfBound(cap, input, caller)) return resource;
  const t = selfTarget(cap, input, caller.id);
  return t.type === "*" ? { type: "agent_computer", id: caller.id } : t;
}
