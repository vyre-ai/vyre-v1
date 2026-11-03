// "Runs on": where the next turn of this private chat runs. Automatic, the default, lets the rules decide; or pinned to this computer, the Space (in a Team Space), or one of the person's own servers by its nickname. It lives in the model menu, and the composer's pill says
// "On Northwind" only when it is not this computer. An option that is off is grey and says why. The choice is stored on the thread (engine.placement.set) and decides the next turn (engine.placement.decide).
// A person's chat is never offered a teammate's machine.
// Lane l-runson: each of the person's computers is its own row ("This computer" for the one they are on, the others by name), on only while its link to the Space is up; the menu reads the options
// again every 15 seconds while the chat is open, so it never says a computer is on when the Space cannot reach it.
import { useCallback, useEffect, useState } from "react";
import type { PanelRuns } from "../../../../../../ui/src/Composer/ModelPanel.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { GlyphName } from "./parts.tsx";
import { iconMarkup } from "../../../shell/rail/icons.tsx";

export type Target = "device" | "space" | "server";
export interface RunsOnOption { target: Target; serverId?: string; deviceId?: string; current?: boolean; name: string; online: boolean; reason?: string }
export interface RunsOnState { private: boolean; pinned?: boolean; effective: { target: Target; serverId?: string; deviceId?: string }; /** where Automatic would run the next turn now */ automatic?: { target: Target; serverId?: string; deviceId?: string }; options: readonly RunsOnOption[] }

type Place = { target: Target; serverId?: string; deviceId?: string };
/** Two places are the same machine. A place that names no computer (an older pin) is the computer the person is on. */
function same(a: Place & { current?: boolean }, b: Place): boolean {
  if (a.target !== b.target) return false;
  if (a.target === "server") return (a.serverId ?? "") === (b.serverId ?? "");
  if (a.target === "device") return b.deviceId === undefined ? a.current === true || a.deviceId === undefined : a.deviceId === b.deviceId;
  return true;
}

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

const keyOf = (o: Place): string => `${o.target}:${o.serverId ?? o.deviceId ?? ""}`;
const AUTOMATIC = "auto:";

/** Where Automatic lands now, as its row says it: "Now: Office iMac", "Now: The Space", "Now: this computer". Read from the engine's own order, whatever the chat is pinned to. */
export function automaticNote(s: RunsOnState): string {
  const at = s.automatic ?? (s.pinned === true ? undefined : s.effective);
  const o = at ? s.options.find((x) => same(x, at)) : undefined;
  if (!o) return at?.target === "space" ? "Now: The Space" : "Now: this computer";
  return `Now: ${o.target === "device" && (o.current === true || o.deviceId === undefined) ? "this computer" : o.name}`;
}

/** The rows of the Runs on menu. Automatic comes first and says where it lands now; each place says only what its name does not. */
export function runsOptions(s: RunsOnState): PanelRuns["options"] {
  return [
    { key: AUTOMATIC, name: "Automatic", note: automaticNote(s), online: true },
    ...s.options.map((o) => {
      const what = o.target === "server" ? "Your server" : o.target === "device" && o.deviceId !== undefined && o.current !== true ? "Your computer" : "";
      // an off place says so on its row, beside what it is: the menu never shows a machine as ready when it is not
      const note = [what, !o.online && o.reason ? o.reason : ""].filter((x) => x !== "").join(" · ");
      return { key: keyOf(o), name: o.name, online: o.online, ...(note ? { note } : {}), ...(o.reason ? { reason: o.reason } : {}) };
    }),
  ];
}

/** Where this chat runs, for the model menu and the pill: read from engine.placement.options, pinned with engine.placement.set. A chat with other people has no choice: it always runs on the Space. */
export function useRunsOn({ call, threadId, agentId, spaceName, say }: { call(cap: string, input: unknown): Promise<unknown>; threadId: string; agentId?: string | undefined; spaceName: string; say?: (text: string) => void }): { runs: PanelRuns | undefined; chip: string | undefined } {
  const [state, setState] = useState<RunsOnState | null>(null);
  const load = useCallback(async (): Promise<void> => {
    try { setState((await call("engine.placement.options", { threadId, ...(agentId ? { agentId } : {}) })) as RunsOnState); } catch { setState(null); }
  }, [call, threadId, agentId]);
  // the options are live state (a computer's link, a server's connection): read again while the chat is open
  useEffect(() => { void load(); const t = setInterval(() => { void load(); }, 15_000); (t as { unref?: () => void }).unref?.(); return () => clearInterval(t); }, [load]);   // unref: a poll never keeps a test process alive
  if (state === null) return { runs: undefined, chip: undefined };
  if (!state.private) return { runs: { value: spaceName, current: null, options: [], fixed: { name: spaceName, note: "Space computer", line: "Chats with other people always run on the Space." }, onPick: () => undefined }, chip: undefined };
  const now = currentOption(state);
  const pick = (key: string): void => {
    const o = state.options.find((x) => keyOf(x) === key);
    if (!o && key !== AUTOMATIC) return;
    Promise.resolve(call("engine.placement.set", { threadId, target: o?.target ?? "auto", ...(o?.serverId ? { serverId: o.serverId } : {}), ...(o?.deviceId ? { deviceId: o.deviceId } : {}) })).then(() => load(), () => say?.("Could not change where this chat runs."));
  };
  return {
    runs: {
      value: state.pinned === true ? now.name : "Automatic", current: state.pinned === true ? keyOf(now) : AUTOMATIC, onPick: pick,
      options: runsOptions(state),
    },
    // the pill names a place only when it is not the computer the person is on
    chip: now.target === "device" && (now.current === true || now.deviceId === undefined) ? undefined : now.name,
  };
}

