// Settings > Memory and privacy > Memory spend (memory ruling 6, admins): what the nightly model pass cost last night and this month, against the monthly cap the Space set. The cap is a plain
// number of dollars that saves as it is changed, with Undo; at the cap upkeep stops using a model and follows rules only, and the line says so. Without a model account nothing is spent.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { Section, SettingsRow, Stepper, Value } from "./ui.tsx";

type StatusOut = CapMap["memory.upkeep.status"]["out"];

/** "$0.42": micros of a dollar (a millionth) as dollars with cents; under a cent it says "Under $0.01" so a real but tiny cost does not read as nothing. */
export function dollars(micros: number): string {
  if (micros <= 0) return "$0.00";
  if (micros < 10_000) return "Under $0.01";
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/** What the month line says: how far into the cap the Space is, or that upkeep has stopped at it. */
export function monthNote(s: Pick<StatusOut, "spentMicros" | "capMicros" | "capReached" | "modelAvailable">): string {
  if (!s.modelAvailable) return "No model account is picked, so upkeep follows rules only and costs nothing.";
  if (s.capReached) return "The cap is reached. Upkeep follows rules only until next month.";
  if (s.capMicros <= 0) return "The cap is zero, so upkeep follows rules only.";
  return `${Math.round((s.spentMicros / s.capMicros) * 100)}% of the cap`;
}

export function MemorySpend(): ReactElement | null {
  const data = useSettingsData();
  const saved = useSaved();
  const [s, setS] = useState<StatusOut | null>(() => { try { return (data.peek?.("memory.upkeep.status", {}) as StatusOut | undefined) ?? null; } catch { return null; } });
  const [cap, setCap] = useState<number | null>(null);
  useEffect(() => { void (data.call("memory.upkeep.status", {}) as Promise<StatusOut>).then((r) => { setS(r); setCap(Math.round(r.capMicros / 1_000_000)); }, () => undefined); }, [data]);
  if (!s) return null;
  const dollarsCap = cap ?? Math.round(s.capMicros / 1_000_000);
  const change = (next: number): void => {
    const before = dollarsCap;
    setCap(next);
    void data.call("settings.set_space", { key: "memory.upkeep_monthly_cap", value: next, idempotencyKey: `upkeep-cap-${next}-${data.clock().now}` }).then(
      () => saved.saved("Monthly cap saved", () => data.call("settings.set_space", { key: "memory.upkeep_monthly_cap", value: before, idempotencyKey: `upkeep-cap-${before}-undo-${data.clock().now}` }).then(() => setCap(before))),
      (e: unknown) => { setCap(before); saved.failed(e instanceof Error ? e.message : "That did not save."); },
    );
  };
  const last = s.lastNight;
  return (
    <Section title="Memory spend" help="What the nightly model pass costs. Rules-only upkeep is free.">
      <SettingsRow id="memory.spend.night" label="Last night" first sub={last ? `${last.runs} ${last.runs === 1 ? "run" : "runs"}, ${last.tokensIn + last.tokensOut} tokens` : "No model pass ran"} control={<Value text={last ? dollars(last.costMicros) : "$0.00"} testID="spend-night" />} />
      <SettingsRow id="memory.spend.month" label="This month" sub={monthNote(s)} control={<Value text={dollars(s.spentMicros)} accent={s.capReached} testID="spend-month" />} />
      <SettingsRow id="memory.spend.cap" label="Monthly cap" sub="Upkeep stops using a model at this amount" control={<Stepper value={dollarsCap} onChange={change} min={0} max={1000} step={1} label="Monthly cap in dollars" format={(n) => `$${n}`} testID="ctl-memory-spend-cap" />} />
    </Section>
  );
}
