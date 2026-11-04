// What /usage says in a chat, from engine.my_ai's answer (modules/engine/handlers/self-ai.ts): the words come from the one place that knows, never from the model.
export interface MyAi {
  running?: { model?: string; paid?: string; account?: { name?: string }; context?: { used: number; window: number } };
  accounts: Array<{ name: string; provider: string; usable: boolean; why?: string; models: string[]; limits: { state: "read" | "not_readable"; session?: { pct: number }; week?: { pct: number }; note?: string } }>;
  use: { today: MyUse; month: MyUse };
}
interface MyUse { turns: number; input: number; cachedInput: number; output: number; costMicros: number }
const k = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const useLine = (label: string, u: MyUse): string => `${label}: ${u.turns} ${u.turns === 1 ? "turn" : "turns"}, ${k(u.input)} new in, ${k(u.cachedInput)} cached, ${k(u.output)} out${u.costMicros > 0 ? `, $${(u.costMicros / 1e6).toFixed(2)}` : ""}`;

/** What /usage says: this chat's model and account, each account with what is left (or that it is not readable), and the person's use. */
export function usageText(o: MyAi): string {
  const out: string[] = [];
  if (o.running) out.push(`This chat: ${o.running.model ?? "the engine's own default model"}${o.running.account?.name ? ` on ${o.running.account.name}` : ""}${o.running.paid ? ` (paid by ${o.running.paid})` : ""}${o.running.context ? `, context ${k(o.running.context.used)} of ${k(o.running.context.window)}` : ""}.`);
  for (const a of o.accounts) {
    const l = a.limits;
    const left = !a.usable ? `cannot run here: ${a.why ?? "not usable"}` : l.state === "read" ? [l.session ? `session ${Math.round(l.session.pct)}% used` : "", l.week ? `week ${Math.round(l.week.pct)}% used` : ""].filter(Boolean).join(", ") : `limits not readable (${l.note ?? "the provider does not report them"})`;
    out.push(`${a.name}: ${left}${a.usable && a.models.length > 0 ? `. Models: ${a.models.slice(0, 6).join(", ")}` : ""}`);
  }
  out.push(useLine("Today", o.use.today), useLine("This month", o.use.month));
  return out.join("\n");
}

