// scratch: search cost at 40,000 records for a caller with no hidden fields and one with (not committed)
import { after, before, test } from "node:test";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
let h: Hour;
before(async () => { h = await bootHour("hiddencost"); });
after(async () => { await h?.stop(); });
const N = Number(process.env["COST_N"] ?? 40000);
const med = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
test("cost", { timeout: 3_000_000 }, async () => {
  const t0 = Date.now();
  for (let b = 0; b * 100 < N; b++) {
    await h.owner.call("records.bulk_upsert", {
      type: "contact", match: ["name"], createOnly: true, runAutomations: false, idempotencyKey: `cost-${b}`,
      rows: Array.from({ length: 100 }, (_, i) => ({ name: `Perf Person ${b * 100 + i}`, email: `p${b * 100 + i}@cost.test`, phone: `+1 555 ${String(b * 100 + i).padStart(7, "0")}` })),
    });
    if (b % 50 === 0) process.stderr.write(`seeded ${b * 100} in ${Math.round((Date.now() - t0) / 1000)} s\n`);
  }
  for (let i = 0; i < 60; i++) { await h.d.hooks?.pump?.(); }
  const mk = async (label: string, email: string, hidden: boolean) => {
    const inv = await h.owner.call("members.invites.create", { role: ((await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>).find((r) => r.name === "Member")!.id, email });
    const p = h.person(label, label.toLowerCase(), email, `${label} horse battery staple 9`);
    await join(h, p, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
    await h.owner.call("access.share", { resource: { type: "record_type", id: "contact" }, subject: { kind: "person", id: p.personId }, level: "view", ...(hidden ? { conditions: { hiddenFields: ["email", "phone"] } } : {}), idempotencyKey: `cost-share-${label}` });
    return p;
  };
  const plain = await mk("Plain", "plain@cost.test", false);
  const hid = await mk("Hid", "hid@cost.test", true);
  for (let i = 0; i < 80; i++) await h.d.hooks?.pump?.();
  const time = async (p: typeof plain, cap: string, input: Record<string, unknown>): Promise<string> => {
    const ms: number[] = [];
    let n = 0;
    for (let i = 0; i < 7; i++) { const t = performance.now(); const r = await p.call(cap, input); ms.push(performance.now() - t); n = ((r as { hits?: unknown[] }).hits ?? []).length; }
    return `${Math.round(med(ms))} ms (${n} hits)`;
  };
  const seedRecent = async (p: typeof plain): Promise<void> => {
    const rows = ((await h.owner.call("records.query", { type: "contact", limit: 25 })) as { rows: Array<{ id: string }> }).rows;
    for (const r of rows.slice(0, 25)) { await p.call("records.get", { type: "contact", recordId: r.id }); await p.attempt("search.recent.record", { kind: "record", itemId: r.id }); }
  };
  await seedRecent(plain); await seedRecent(hid);
  const some = ((await h.owner.call("records.query", { type: "contact", limit: 1 })) as { rows: Array<{ id: string }> }).rows[0]!.id;
  const out: string[] = [`records ${N}, seeded in ${Math.round((Date.now() - t0) / 1000)} s`];
  for (const [name, p] of [["owner", h.owner], ["no hidden", plain], ["hidden email+phone", hid]] as const) {
    out.push(`${name}: query 20 hits ${await time(p as typeof plain, "search.query", { q: "Perf Person 1", limit: 20 })}; query rare ${await time(p as typeof plain, "search.query", { q: "Perf Person 39999", limit: 20 })}; recent ${await time(p as typeof plain, "search.recent.list", { limit: 20 })}; related ${await time(p as typeof plain, "search.related", { kind: "record", itemId: some, limit: 20 })}`);
  }
  process.stderr.write(`COSTRESULT\n${out.join("\n")}\n`);
});
