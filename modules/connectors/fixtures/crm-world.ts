// A connectors kit wired to the made-up CRMs of fixtures/crm.ts: the Vault holds their keys, the probe reads them, schema calls are recorded.
import { crm, KEY_A, KEY_B } from "./crm.ts";
import { kit } from "./kit.ts";
import type { ConnectorsCtx, Probe } from "../projections.ts";

export const KEYS: Record<string, string> = { "#Ledger_Key": KEY_A, "#Orbit_Key": KEY_B };

export function world() {
  const k = kit();
  const c = crm();
  for (const [h, v] of Object.entries(KEYS)) k.vault[h] = v;
  const probe: Probe = async (_ctx, req) => {
    const key = KEYS[req.handle] ?? "";
    const headers: Record<string, string> = req.style === "bearer" ? { authorization: `Bearer ${key}` } : { [(req.header ?? "authorization").toLowerCase()]: `${req.prefix ?? ""}${key}` };
    const r = c.handle({ method: "GET", url: req.url, headers });
    return { status: r.status, text: r.body === undefined ? "" : JSON.stringify(r.body), ...(r.headers?.["link"] ? { link: r.headers["link"] } : {}) };
  };
  k.deps.probe = probe;
  const types = new Map<string, Set<string>>();
  const calls: { cap: string; input: any }[] = [];
  const ctx: ConnectorsCtx = {
    ...k.ctx,
    call: async (cap, input) => {
      calls.push({ cap, input });
      if (cap === "runs.start") return { runId: `run_${calls.filter((x) => x.cap === "runs.start").length}` };
      if (cap === "runs.finish") return { run: { id: (input as { runId: string }).runId } };
      if (cap === "schema.diff") return { previewToken: "tok", items: [], additive: 0, destructive: 0, problems: [] };
      if (cap === "schema.describe") return { types: [...types].map(([key, f]) => ({ key, fields: [...f].map((x) => ({ key: x })) })) };
      if (cap === "schema.apply") {
        for (const op of (input as { ops: any[] }).ops) {
          if (op.op === "type.create") types.set(op.type, new Set((op.def.fields as { key: string }[]).map((f) => f.key)));
          if (op.op === "field.add" || op.op === "relation.add") types.set(op.type, new Set([...(types.get(op.type) ?? []), op.field]));
        }
        return { applied: 1 };
      }
      throw new Error(`no ${cap}`);
    },
  };
  return { k, c, ctx, types, calls };
}
