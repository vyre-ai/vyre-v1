// What a step was given and what it answered, for the run history. The step log holds the words as the step saw them; this read hides anything that looks like a key before it leaves, whatever the step was.
// A field named like a secret, and a text that starts like a bearer token or a key, is replaced by [hidden] and counted. A very large value is cut.
import { allSteps, raise, seeRun } from "../projections.ts";
import type { RunsCtx } from "../projections.ts";

const SECRET_NAME = /(secret|password|passwd|authorization|cookie|token|api[-_]?key|credential|private[-_]?key)/i;
const SECRET_TEXT = /^(bearer\s+\S|sk-[A-Za-z0-9]|key_[A-Za-z0-9]|ya29\.|ghp_|xox[bp]-)/i;
const MAX_CHARS = 60_000;

export function hide(value: unknown, depth = 0): { value: unknown; hidden: number } {
  let hidden = 0;
  const walk = (v: unknown, d: number): unknown => {
    if (d > 20) return "[too deep]";
    if (typeof v === "string") { if (SECRET_TEXT.test(v.trim())) { hidden += 1; return "[hidden]"; } return v; }
    if (Array.isArray(v)) return v.map((x) => walk(x, d + 1));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (SECRET_NAME.test(k) && x !== null && x !== undefined && x !== "") { hidden += 1; out[k] = "[hidden]"; } else out[k] = walk(x, d + 1);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value, depth), hidden };
}

function shown(json: string | undefined): { value?: unknown; hidden: number; truncated: boolean } {
  if (json === undefined) return { hidden: 0, truncated: false };
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { value: "[unreadable]", hidden: 0, truncated: false }; }
  const h = hide(parsed);
  const text = JSON.stringify(h.value);
  if (text !== undefined && text.length > MAX_CHARS) return { value: `${text.slice(0, MAX_CHARS)}...`, hidden: h.hidden, truncated: true };
  return { value: h.value, hidden: h.hidden, truncated: false };
}

export async function stepIo(ctx: RunsCtx, input: { runId: string; step: string; attempt?: number }): Promise<unknown> {
  seeRun(ctx, input.runId);
  const rows = allSteps(ctx.db, input.runId).filter((s) => s.step === input.step && (input.attempt === undefined || s.attempt === input.attempt));
  const row = rows[rows.length - 1];
  if (!row) raise(ctx, "validation.not_found", "That step has no log in this run.");
  const i = shown(row.inputJson);
  const o = shown(row.outputJson);
  return { step: row.step, attempt: row.attempt, ...(i.value !== undefined ? { input: i.value } : {}), ...(o.value !== undefined ? { output: o.value } : {}), hidden: i.hidden + o.hidden, truncated: i.truncated || o.truncated };
}
