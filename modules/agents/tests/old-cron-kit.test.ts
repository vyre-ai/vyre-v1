// The routine cron reader as it was on 13 Nov 2026 (tree 19aa9acab, modules/agents/projections.ts), kept verbatim as the oracle for modules/agents/tests/cron.old-new.test.ts: a routine saved on a live
// Space must keep its meaning, so the reader that replaced it is compared with this one over a generated set. Do not "fix" this file.
export const oldRoutineCron = true;
function fieldSet(spec: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) return null;
    let lo = min,
      hi = max;
    if (m[1] !== "*") {
      const [a, b] = (m[1] as string).split("-");
      lo = Number(a);
      hi = b === undefined ? (m[2] === undefined ? lo : max) : Number(b);
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size > 0 ? out : null;
}
interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}
export function oldParse(expr: string): Cron | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minute = fieldSet(f[0] as string, 0, 59),
    hour = fieldSet(f[1] as string, 0, 23),
    dom = fieldSet(f[2] as string, 1, 31),
    month = fieldSet(f[3] as string, 1, 12);
  const dowRaw = fieldSet((f[4] as string).replace(/\b7\b/g, "0"), 0, 6);
  if (!minute || !hour || !dom || !month || !dowRaw) return null;
  return { minute, hour, dom, month, dow: dowRaw, domAny: f[2] === "*", dowAny: f[4] === "*" };
}
/** The first minute after `after` (ms, UTC) that the expression names, looking a year ahead; null when there is none (31 February). */
export function oldNextRun(expr: string, after: number): number | null {
  const c = oldParse(expr);
  if (!c) return null;
  const start = new Date(after - (after % 60_000) + 60_000);
  for (let d = 0; d <= 366; d++) {
    const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + d));
    if (!c.month.has(day.getUTCMonth() + 1)) continue;
    const domOk = c.dom.has(day.getUTCDate()),
      dowOk = c.dow.has(day.getUTCDay());
    // cron: when both day fields are restricted, either one matching is enough
    const dayOk = c.domAny && c.dowAny ? true : c.domAny ? dowOk : c.dowAny ? domOk : domOk || dowOk;
    if (!dayOk) continue;
    for (const h of [...c.hour].sort((a, b) => a - b))
      for (const m of [...c.minute].sort((a, b) => a - b)) {
        const t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m);
        if (t >= start.getTime()) return t;
      }
  }
  return null;
}
