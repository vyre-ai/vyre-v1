// Settings > Memory and privacy > Who pays for memory. Learning from your chats runs on the AI account you chat with, on its cheapest model, up to your daily limit (owner ruling 3 Nov, lane
// l-memlearn): there is nothing to pick, so "you" shows that line and today's use (memory.learning.today, when the server has it). The Space's and projects' upkeep accounts are an admin's
// and stay in the Console ("space"): each is picked, never typed; no account picked means rule-based upkeep, and the sub line says so. Each change saves as it is made, with Undo.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import type { ConnectNeed } from "../../shell/connect/model.ts";
import { MEMORY_KEYS, useIsPersonal, useScreenQuery, useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { MemorySpend } from "./MemorySpend.tsx";
import { Choice, Section, SettingsRow, Value } from "./ui.tsx";

/** What "you" says about who pays: learning needs no setup. */
export const LEARNING_LINE = "Learning uses the AI account you chat with, on its cheapest model, up to your daily limit.";

/** memory.learning.today (lane l-memlearn): what learning used today against the daily limit. */
export interface LearningToday { passes: number; capPasses: number; tokensIn: number; capTokens: number; state: "learning" | "rules_only" }

/** The line under the row: model passes today, or why learning is on simple notes today. The count is the row's value. */
export function todaySub(t: LearningToday): string {
  if (t.capPasses === 0 || t.capTokens === 0) return "Your Space turned model learning off. Vyre keeps simple notes instead.";
  if (t.state === "rules_only") return "Today's limit is reached. Simple notes until midnight.";
  return "Model passes, of your daily limit";
}

/** Today's use, read once; a server without memory.learning.today leaves it out. */
function useLearningToday(on: boolean): LearningToday | null {
  const data = useSettingsData();
  const [t, setT] = useState<LearningToday | null>(() => (on ? (data.peek?.("memory.learning.today", {}) as LearningToday | undefined) ?? null : null));
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    (data.call("memory.learning.today", {}) as Promise<LearningToday>).then((v) => { if (live) setT(v); }, () => undefined);
    return () => { live = false; };
  }, [data, on]);
  return t;
}

type KeysOut = CapMap["memory.keys.get"]["out"];
type ProjectsOut = CapMap["projects.list"]["out"];
type Picker = KeysOut["personal"];
type Layer = "space" | "project" | "person";

export const NONE = "";
const AI: ConnectNeed = { kind: "ai" };
const optionsOf = (p: Picker, none: string): { value: string; label: string }[] => [
  { value: NONE, label: none },
  ...p.choices.map((c) => ({ value: c.ref, label: `${c.title}${c.mine ? " (yours)" : " (shared)"}${c.state === "ok" ? "" : c.state === "needs_sign_in" ? ", sign in again" : ", failing"}` })),
];
export const sub = (p: Picker, none: string): string => (p.accountRef === null ? none : p.choices.some((c) => c.ref === p.accountRef) ? "Pays for the model pass that tidies this memory" : "This account is no longer available; upkeep follows rules only until you pick another");

/** `you`: your own memory, in Settings. `space`: the Space's account, its projects and the cap, in the Console. A Personal Space has no Console, so its Settings holds both. */
export function MemoryKeys({ tier = "you" }: { tier?: "you" | "space" }): ReactElement | null {
  const data = useSettingsData();
  const personal = useIsPersonal();
  const saved = useSaved();
  const keys = useScreenQuery<KeysOut>(MEMORY_KEYS, "keys", {});
  const today = useLearningToday(tier === "you");
  const projects = useScreenQuery<ProjectsOut>(MEMORY_KEYS, "projects", {});
  if (keys.status !== "ready") return null;
  const k = keys.data;
  const set = (layer: Layer, accountRef: string | null, before: string | null, projectId?: string): void => {
    const input = { layer, accountRef, ...(projectId ? { projectId } : {}) };
    void data.call("memory.key.set", input).then(
      () => saved.saved(accountRef ? "Memory account saved" : "Memory upkeep follows rules only", () => data.call("memory.key.set", { layer, accountRef: before, ...(projectId ? { projectId } : {}) }).then(() => undefined)),
      (e: unknown) => saved.failed(e instanceof Error ? e.message : "That did not save."),
    );
  };
  const personalNone = "None (rules only)";
  const showYou = tier === "you";
  const showSpace = tier === "space" || personal;
  const projectRows: ReactElement[] = [];
  if (k.space && projects.status === "ready") {
    projects.data.projects.forEach((p, i) => {
      const cur = k.projectKeys?.[p.projectId] ?? null;
      projectRows.push(
        <SettingsRow
          key={p.projectId} id={`memory.key.project.${p.projectId}`} label={p.title} first={i === 0} {...(cur !== null ? { sub: "Its own account" } : {})}
          control={<Choice value={cur ?? NONE} options={optionsOf(k.space as Picker, "The Space's account")} label={`${p.title} memory account`} testID={`ctl-memory-key-project-${p.projectId}`} onChange={(v) => set("project", v === NONE ? null : v, cur, p.projectId)} connect={{ need: AI, empty: (k.space as Picker).choices.length === 0, onConnected: (made) => set("project", made.ref ?? made.id, cur, p.projectId) }} />}
        />,
      );
    });
  }
  return (
    <>
      {showYou || (showSpace && k.space) ? <Section title="Who pays for memory" {...(showYou ? { note: LEARNING_LINE } : {})} help={showYou ? "Nothing to set up: learning runs on the account that answered you. Your Space sets the daily limit." : "Memory upkeep merges duplicates, dates facts and tidies pages. With no account it follows rules only; nothing is sent to a model."}>
        {showYou ? <SettingsRow
          id="memory.key.person" label={today ? "Your learning today" : "Your memory"} first sub={today ? todaySub(today) : "Nothing to set up"}
          {...(today ? { control: <Value text={`${today.passes} of ${today.capPasses}`} accent={today.state === "rules_only"} testID="memory-learning-today" /> } : {})}
        /> : null}
        {showSpace && k.space ? (
          <SettingsRow
            id="memory.key.space" label="Space memory" first={!showYou}
            control={<Choice value={k.space.accountRef ?? NONE} options={optionsOf(k.space, personalNone)} label="Space memory account" testID="ctl-memory-key-space" onChange={(v) => set("space", v === NONE ? null : v, k.space?.accountRef ?? null)} />}
          />
        ) : null}
      </Section> : null}
      {showSpace && k.space && projects.status === "ready" && projects.data.projects.length > 0 ? (
        <Section title="Project memory" help="A project without its own account uses the Space's.">
          {projectRows}
        </Section>
      ) : null}
      {showSpace && k.admin ? <MemorySpend /> : null}
    </>
  );
}
