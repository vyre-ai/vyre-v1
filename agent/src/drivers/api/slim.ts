// What the model is shown of a tool's input schema. The generated schemas carry what a validator needs (id patterns, examples of each id); the model needs the names, the types, which are required and what an
// enum allows. Every call of a turn re-sends the whole tool list, so what is not read is paid for once per call (the owner's rc.20 turn: 1.0M input tokens). The server still validates every call against the
// full schema; this only trims the copy shown to the model.
import type { ApiTool } from "./types.ts";

const DROPPED: ReadonlySet<string> = new Set(["examples", "pattern", "$schema", "default"]);

function slim(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(slim);
  if (typeof v !== "object" || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    // a property that is itself called "examples" or "pattern" lives under "properties": its schema stays
    if (DROPPED.has(k) && (typeof x !== "object" || Array.isArray(x) || k === "examples")) continue;
    out[k] = k === "properties" && typeof x === "object" && x !== null ? Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([n, s]) => [n, slim(s)])) : slim(x);
  }
  return out;
}

export const slimTool = (t: ApiTool): ApiTool => ({ ...t, inputSchema: slim(t.inputSchema) });
