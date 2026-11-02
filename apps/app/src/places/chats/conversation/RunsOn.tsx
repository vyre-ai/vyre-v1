// "Runs on": where the next turn of this private chat runs. This computer, the Space (in a Team Space), or one of the person's own servers by its nickname. It lives in the model menu, and the composer's pill says
// "On Northwind" only when it is not this computer. An option that is off is grey and says why. The choice is stored on the thread (engine.placement.set) and decides the next turn (engine.placement.decide).
// A person's chat is never offered a teammate's machine.
import { useCallback, useEffect, useState } from "react";
import type { PanelRuns } from "../../../../../../ui/src/Composer/ModelPanel.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { GlyphName } from "./parts.tsx";
import { iconMarkup } from "../../../shell/rail/icons.tsx";

export type Target = "device" | "space" | "server";
export interface RunsOnOption { target: Target; serverId?: string; name: string; online: boolean; reason?: string }
export interface RunsOnState { private: boolean; effective: { target: Target; serverId?: string }; options: readonly RunsOnOption[] }

const same = (a: { target: Target; serverId?: string }, b: { target: Target; serverId?: string }): boolean => a.target === b.target && (a.serverId ?? "") === (b.serverId ?? "");

/** The chip is drawn for a private chat that has somewhere else to run. A lone "This computer" is no choice. */
export const showsChip = (s: RunsOnState | null): s is RunsOnState => s !== null && s.private && s.options.length > 1;

/** The option the chat runs on now. A place the options do not list (the Space runs a chat for a phone) reads as the first option. */
export function currentOption(s: RunsOnState): RunsOnOption {
  return s.options.find((o) => same(o, s.effective)) ?? s.options[0]!;
}

export const iconOf = (o: Pick<RunsOnOption, "target">): GlyphName => (o.target === "device" ? "monitor" : o.target === "space" ? "cloud" : "server");

export function runsOnEntries(s: RunsOnState, pick: (o: RunsOnOption) => void): MenuEntry[] {
  const now = currentOption(s);
  return s.options.map((o): MenuEntry => ({
    label: o.name, checked: same(o, now), icon: iconMarkup(iconOf(o)), ...(o.online ? {} : { disabled: true, ...(o.reason ? { reason: o.reason } : {}) }),
    onSelect: () => pick(o),
  }));
}

const keyOf = (o: { target: Target; serverId?: string }): string => `${o.target}:${o.serverId ?? ""}`;

/** Where this chat runs, for the model menu and the pill: read from engine.placement.options, pinned with engine.placement.set. A chat with other people has no choice: it always runs on the Space. */
export function useRunsOn({ call, threadId, agentId, spaceName, say }: { call(cap: string, input: unknown): Promise<unknown>; threadId: string; agentId?: string | undefined; spaceName: string; say?: (text: string) => void }): { runs: PanelRuns | undefined; chip: string | undefined } {
  const [state, setState] = useState<RunsOnState | null>(null);
  const load = useCallback(async (): Promise<void> => {
    try { setState((await call("engine.placement.options", { threadId, ...(agentId ? { agentId } : {}) })) as RunsOnState); } catch { setState(null); }
  }, [call, threadId, agentId]);
  useEffect(() => { void load(); }, [load]);
  if (state === null) return { runs: undefined, chip: undefined };
  if (!state.private) return { runs: { value: spaceName, current: null, options: [], fixed: { name: spaceName, note: "Space computer", line: "Chats with other people always run on the Space." }, onPick: () => undefined }, chip: undefined };
  const now = currentOption(state);
  const pick = (key: string): void => {
    const o = state.options.find((x) => keyOf(x) === key);
    if (!o) return;
    Promise.resolve(call("engine.placement.set", { threadId, target: o.target, ...(o.serverId ? { serverId: o.serverId } : {}) })).then(() => load(), () => say?.("Could not change where this chat runs."));
  };
  return {
    runs: {
      value: now.name, current: keyOf(now), onPick: pick,
      options: state.options.map((o) => ({ key: keyOf(o), name: o.name, online: o.online, note: o.target === "device" ? "This computer" : o.target === "space" ? "Space computer" : "Your server", ...(o.reason ? { reason: o.reason } : {}) })),
    },
    chip: now.target === "device" ? undefined : now.name,
  };
}

