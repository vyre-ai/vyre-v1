// Making a record from New. A person's type gets a bare record. An agent gets a real agent first (agents.create: its folder, its files, its place in Chats) and then the row that
// lists it; a project gets a real project (projects.create: record, channel and folder). Nothing here draws.
import type { TypeDef } from "./model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Kind = Pick<TypeDef, "key"> & { template?: string };

export type MadeKind = "record" | "agent" | "project";

export const madeKind = (def: Kind): MadeKind => (def.key === "agent" ? "agent" : def.template === "project" ? "project" : "record");

const idOf = (out: unknown, ...path: string[]): string | undefined => {
  let v: unknown = out;
  for (const k of path) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return typeof v === "string" && v !== "" ? v : undefined;
};

/** Makes what New asks for and answers the id of the record to open. A refusal from the module passes through, so the bar says why. */
export async function makeRecord(call: Call, def: Kind & Pick<TypeDef, "titleField">, name: string, key: string): Promise<string | undefined> {
  const kind = madeKind(def);
  if (kind === "project") return idOf(await call("projects.create", { type: def.key, title: name, idempotencyKey: key }), "recordId");
  if (kind === "agent") await call("agents.create", { name, idempotencyKey: `${key}:agent` });
  return idOf(await call("records.create", { type: def.key, fields: { [def.titleField]: name }, idempotencyKey: key }), "record", "id");
}
