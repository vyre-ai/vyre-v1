// Settings > Memory and privacy > Who pays for memory (memory ruling 6). Upkeep is the model pass that merges, dates and tidies memory; the account behind it is picked here, never typed:
// "Your memory" is yours (your own accounts and the shared Vault AI providers you can use); "Space memory" and "Projects" are an admin's and take shared providers only. No account picked means
// rule-based upkeep, and the sub line says so. Each change saves as it is made, with Undo.
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { MEMORY_KEYS, useScreenQuery, useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { Choice, Section, SettingsRow } from "./ui.tsx";

type KeysOut = CapMap["memory.keys.get"]["out"];
type ProjectsOut = CapMap["projects.list"]["out"];
type Picker = KeysOut["personal"];
type Layer = "space" | "project" | "person";

export const NONE = "";
const optionsOf = (p: Picker, none: string): { value: string; label: string }[] => [
  { value: NONE, label: none },
  ...p.choices.map((c) => ({ value: c.ref, label: `${c.title}${c.mine ? " (yours)" : " (shared)"}${c.state === "ok" ? "" : c.state === "needs_sign_in" ? ", sign in again" : ", failing"}` })),
];
export const sub = (p: Picker, none: string): string => (p.accountRef === null ? none : p.choices.some((c) => c.ref === p.accountRef) ? "Pays for the model pass that tidies this memory" : "This account is no longer available; upkeep follows rules only until you pick another");

export function MemoryKeys(): ReactElement | null {
  const data = useSettingsData();
  const saved = useSaved();
  const keys = useScreenQuery<KeysOut>(MEMORY_KEYS, "keys", {});
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
  return (
    <>
      <Section title="Who pays for memory" note="Memory upkeep merges duplicates, dates facts and tidies pages. With no account it follows rules only; nothing is sent to a model.">
        <SettingsRow
          id="memory.key.person" label="Your memory" first sub={sub(k.personal, personalNone)}
          control={<Choice value={k.personal.accountRef ?? NONE} options={optionsOf(k.personal, personalNone)} label="Your memory account" testID="ctl-memory-key-person" onChange={(v) => set("person", v === NONE ? null : v, k.personal.accountRef)} />}
        />
        {k.space ? (
          <SettingsRow
            id="memory.key.space" label="Space memory" sub={sub(k.space, personalNone)}
            control={<Choice value={k.space.accountRef ?? NONE} options={optionsOf(k.space, personalNone)} label="Space memory account" testID="ctl-memory-key-space" onChange={(v) => set("space", v === NONE ? null : v, k.space?.accountRef ?? null)} />}
          />
        ) : null}
      </Section>
      {k.space && projects.status === "ready" && projects.data.projects.length > 0 ? (
        <Section title="Project memory" note="A project without its own account uses the Space's.">
          {projects.data.projects.map((p, i) => {
            const cur = k.projectKeys?.[p.projectId] ?? null;
            return (
              <SettingsRow
                key={p.projectId} id={`memory.key.project.${p.projectId}`} label={p.title} first={i === 0} sub={cur === null ? "The Space's account" : "Its own account"}
                control={<Choice value={cur ?? NONE} options={optionsOf(k.space as Picker, "The Space's account")} label={`${p.title} memory account`} testID={`ctl-memory-key-project-${p.projectId}`} onChange={(v) => set("project", v === NONE ? null : v, cur, p.projectId)} />}
              />
            );
          })}
        </Section>
      ) : null}
    </>
  );
}
