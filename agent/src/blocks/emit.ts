// Block emitters (ARCH 6.8): one place makes every block an agent sends. The data is checked against the type's schema from the contract before the block exists, so a renderer never sees data that
// breaks its type, and a value that must never reach a chat never does: the Vault's own blocks carry names and handles only, and any text a Vault value was scrubbed from is scrubbed here again.
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { mintId } from "../../../lib/ids.ts";
import { fallbackText } from "./fallback.ts";
import type { Block, BlockDef, BlockPatch, BlockState, EmitOptions, PatchOp } from "./types.ts";

/** Blocks whose data streams in as ephemeral frames and is persisted once at the end. */
export const STREAMING_TYPES: ReadonlySet<string> = new Set(["terminal", "deploy", "screenshot"]);
/** Blocks that are about a secret without ever holding one. */
const SECRETLESS: ReadonlySet<string> = new Set(["secret_input", "vault_used"]);
const SECRET_KEY = /^(value|values|secret|password|passphrase|token|apikey|api_key|private_?key|credential)$/i;

export interface BlocksDeps {
  defs: readonly BlockDef[];
  /** The contract's shared schema definitions (`$defs`), which block schemas refer to. */
  schemas: Record<string, JsonSchema>;
  /** Replace anything a Vault value was filled from in a piece of text (agent/src/vault-use createScrubber). Applied to every string of the data. */
  scrub?: (text: string) => string;
  /** Sealed and Restricted values become handles or masks here, before the block exists (authorize does it at emit time, ARCH 6.8 rule 6). */
  redact?: (def: BlockDef, data: unknown) => unknown;
  newId?: () => string;
  now?: () => number;
}

export interface Blocks {
  /** Every type with an emitter, each once, newest version. */
  types(): string[];
  has(type: string, v?: number): boolean;
  def(type: string, v?: number): BlockDef | undefined;
  emit(type: string, data: unknown, o: EmitOptions): Block;
  /** Apply frames to a streaming block. The result is a whole block again and is validated again. */
  patch(block: Block, ops: PatchOp[]): { block: Block; frame: BlockPatch };
  /** The text form (notifications, email, CLI). */
  text(block: Block): string;
}

function walk(v: unknown, f: (s: string) => string): unknown {
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return v.map((x) => walk(x, f));
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x, f)]));
  return v;
}

function secretKeys(v: unknown, path = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => secretKeys(x, `${path}/${i}`));
  if (v === null || typeof v !== "object") return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => (SECRET_KEY.test(k) ? [`${path}/${k}`] : secretKeys(x, `${path}/${k}`)));
}

export function createBlocks(deps: BlocksDeps): Blocks {
  const byKey = new Map<string, BlockDef>();
  const latest = new Map<string, BlockDef>();
  for (const d of deps.defs) {
    byKey.set(`${d.type}@${d.v}`, d);
    const cur = latest.get(d.type);
    if (!cur || cur.v < d.v) latest.set(d.type, d);
  }
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? ((): string => mintId("blk", now()).replaceAll("-", ""));
  const text = (block: Block): string => fallbackText(block, byKey);

  const check = (def: BlockDef, data: unknown, traceId: string): void => {
    const hidden = SECRETLESS.has(def.type) ? secretKeys(data) : [];
    if (hidden.length > 0) throw fail("validation.bad_input", traceId, { message: "A block about a secret holds its name, never its value.", details: { type: def.type, paths: hidden } });
    const errors = validate(def.data, data, "", deps.schemas);
    if (errors.length > 0) throw fail("validation.bad_input", traceId, { message: `That is not the data of a ${def.type} block.`, details: { type: def.type, errors: errors.slice(0, 10) } });
  };

  return {
    types: () => [...latest.keys()].sort(),
    has: (type, v) => (v === undefined ? latest.has(type) : byKey.has(`${type}@${v}`)),
    def: (type, v) => (v === undefined ? latest.get(type) : byKey.get(`${type}@${v}`)),
    emit(type, data, o) {
      const def = o.v === undefined ? latest.get(type) : byKey.get(`${type}@${o.v}`);
      if (!def) throw fail("validation.bad_input", o.traceId, { message: `There is no block type ${type}${o.v === undefined ? "" : ` version ${o.v}`}.`, details: { type } });
      let clean: unknown = deps.redact ? deps.redact(def, data) : data;
      if (deps.scrub) clean = walk(clean, deps.scrub);
      check(def, clean, o.traceId);
      const state: BlockState = o.state ?? (def.waitsForAnswer ? "waiting" : STREAMING_TYPES.has(def.type) ? "live" : "done");
      return { type: def.type, v: def.v, id: o.id ?? newId(), data: clean, state, traceId: o.traceId };
    },
    patch(block, ops) {
      if (!STREAMING_TYPES.has(block.type)) throw fail("validation.bad_input", block.traceId, { message: `A ${block.type} block does not stream.`, details: { type: block.type } });
      const def = byKey.get(`${block.type}@${block.v}`);
      if (!def) throw fail("validation.bad_input", block.traceId, { message: `There is no block type ${block.type} version ${block.v}.` });
      const next = structuredClone(block.data) as Record<string, unknown>;
      for (const op of ops) {
        const m = /^\/([A-Za-z0-9_]+)$/.exec(op.path);
        if (!m) throw fail("validation.bad_input", block.traceId, { message: "A frame names one top-level field.", details: { path: op.path } });
        const key = m[1]!;
        if (op.op === "append") {
          if (typeof next[key] !== "string") throw fail("validation.bad_input", block.traceId, { message: "Only text can be appended to.", details: { path: op.path } });
          next[key] = (next[key] as string) + (deps.scrub ? deps.scrub(op.value) : op.value);
        } else next[key] = deps.scrub ? walk(op.value, deps.scrub) : op.value;
      }
      check(def, next, block.traceId);
      return { block: { ...block, data: next }, frame: { id: block.id, ops } };
    },
    text,
  };
}
