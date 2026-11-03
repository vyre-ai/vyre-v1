// Memory learning (owner ruling 3 Nov 2026). Settings > AI > Memory and privacy shows the person what learning from their chats used today: after each reply Vyre learns on the account that
// answered, with its cheapest model, up to a daily quota, and then by simple rules until their midnight. The Console (AI > Memory learning) holds the quota itself, for owners and admins: model
// passes and input tokens per person per day, each a number that saves as it changes, with Undo. A Personal Space has no Console, so its Settings shows both.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useIsPersonal, useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { Section, SettingsRow, Stepper, Value } from "./ui.tsx";

export interface LearningToday {
  day: string; passes: number; tokensIn: number; tokensOut: number; rulePasses: number; capPasses: number; capTokens: number; resetsAt: number; timezone: string; state: "learning" | "rules_only";
}

/** "31k": a token count, short. */
export function tokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

/** The Today row's value and the line under it. */
export function todayLine(t: LearningToday): { value: string; sub: string } {
  const value = `${t.passes} of ${t.capPasses}`;
  const used = `${tokens(t.tokensIn)} of ${tokens(t.capTokens)} tokens`;
  if (t.capPasses === 0 || t.capTokens === 0) return { value, sub: "Your Space turned model learning off. Vyre keeps simple notes from your chats instead." };
  if (t.state === "rules_only") return { value, sub: `Today's limit is reached (${used}). Vyre keeps simple notes until midnight, then learns as usual.` };
  return { value, sub: `${used}. Learns after each reply on the account that answered, with its cheapest model.` };
}

function useToday(): [LearningToday | null, () => void] {
  const data = useSettingsData();
  const [t, setT] = useState<LearningToday | null>(null);
  const load = (): void => { void (data.call("memory.learning.today", {}) as Promise<LearningToday>).then(setT, () => undefined); };
  useEffect(load, [data]);
  return [t, load];
}

/** Settings > AI > Memory and privacy: today's learning against the quota. */
export function MemoryLearning(): ReactElement | null {
  const personal = useIsPersonal();
  const [t, reload] = useToday();
  if (!t) return null;
  const line = todayLine(t);
  return (
    <>
      <Section title="Learning from your chats" help="After each reply, Vyre notes what is worth remembering about you, on the AI account that answered. It never slows a reply.">
        <SettingsRow id="memory.learning.today" label="Model passes today" first sub={line.sub} control={<Value text={line.value} accent={t.state === "rules_only"} testID="learning-today" />} />
      </Section>
      {personal ? <LimitRows today={t} onChanged={reload} /> : null}
    </>
  );
}

/** Console > AI > Memory learning: the daily quota for everyone in the Space. */
export function MemoryLearningLimits(): ReactElement | null {
  const [t, reload] = useToday();
  if (!t) return null;
  return <LimitRows today={t} onChanged={reload} />;
}

function LimitRows({ today, onChanged }: { today: LearningToday; onChanged(): void }): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const [passes, setPasses] = useState(today.capPasses);
  const [budget, setBudget] = useState(today.capTokens);
  const put = (key: string, next: number, before: number, show: (n: number) => void, what: string): void => {
    show(next);
    void data.call("settings.set_space", { key, value: next, idempotencyKey: `${key}-${next}-${data.clock().now}` }).then(
      () => { onChanged(); saved.saved(`${what} saved`, () => data.call("settings.set_space", { key, value: before, idempotencyKey: `${key}-${before}-undo-${data.clock().now}` }).then(() => { show(before); onChanged(); })); },
      (e: unknown) => { show(before); saved.failed(e instanceof Error ? e.message : "That did not save."); },
    );
  };
  return (
    <Section title="Memory learning" help="How much each person's chats may teach memory with a model each day. Past either limit, Vyre keeps simple notes for free until that person's midnight.">
      <SettingsRow
        id="memory.learn_daily_passes" label="Model passes per person per day" first sub="One pass follows a reply"
        control={<Stepper value={passes} onChange={(n) => put("memory.learn_daily_passes", n, passes, setPasses, "Daily passes")} min={0} max={5000} step={10} label="Model passes per day" testID="ctl-learn-passes" />}
      />
      <SettingsRow
        id="memory.learn_daily_tokens" label="Input tokens per person per day" sub="Whichever limit comes first stops model learning for the day"
        control={<Stepper value={budget} onChange={(n) => put("memory.learn_daily_tokens", n, budget, setBudget, "Daily tokens")} min={0} max={50_000_000} step={50_000} label="Input tokens per day" format={tokens} testID="ctl-learn-tokens" />}
      />
    </Section>
  );
}
