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
  cap: Pick<CapabilityDef, "resource">, input: unknown, spaceId: string, resolve?: (type: string, kind: "name" | "handle", value: string) => string | null,
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
  if (!raw) throw new BindingError(b.id, "the id is missing");
  if ("resolve" in b && b.resolve) {
    const id = resolve ? resolve(b.type, b.resolve, raw) : raw;
    if (!id) throw new BindingError(b.id, "no such item");
    return { type: b.type, id };
  }
  return { type: b.type, id: raw };
}
