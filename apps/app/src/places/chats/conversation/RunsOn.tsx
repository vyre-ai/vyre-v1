// The "runs on" chip in a chat header: where the next turn of this private chat runs. This computer, the Space (in a Team Space), or one of the person's own servers by its nickname. It is quiet:
// one small pill, drawn only when there is a choice to make, with the options in a menu. An option that is off is grey and says why on hover. The choice is stored on the thread
// (engine.placement.set) and decides the next turn (engine.placement.decide). A person's chat is never offered a teammate's machine.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Glyph, anchorOf } from "./parts.tsx";
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

export function RunsOnPill({ state, narrow = false, onOpen }: { state: RunsOnState; narrow?: boolean; onOpen(x: number, y: number): void }): ReactElement {
  const now = currentOption(state);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`Runs on ${now.name}`} testID="runs-on" {...(Platform.OS === "web" ? ({ title: `Runs on ${now.name}` } as object) : {})}
      onPress={(e) => { const p = anchorOf(e); onOpen(p.x, p.y); }} style={st.pill}
    >
      <Glyph name={iconOf(now)} size={13} color={now.online ? "var(--ink-2)" : "var(--ink-4)"} />
      {narrow ? null : <Text numberOfLines={1} testID="runs-on-label" style={[st.text, !now.online && { color: "var(--ink-4)" as string }]}>{now.name}</Text>}
      <Glyph name="chevd" size={11} color="var(--ink-4)" />
    </Pressable>
  );
}

export function RunsOnChip({ call, threadId, agentId, narrow = false, say }: { call(cap: string, input: unknown): Promise<unknown>; threadId: string; agentId?: string | undefined; narrow?: boolean; say?: (text: string) => void }): ReactElement | null {
  const [state, setState] = useState<RunsOnState | null>(null);
  const { element, show } = useMenu();
  const load = useCallback(async (): Promise<void> => {
    try { setState((await call("engine.placement.options", { threadId, ...(agentId ? { agentId } : {}) })) as RunsOnState); } catch { setState(null); }
  }, [call, threadId, agentId]);
  useEffect(() => { void load(); }, [load]);
  if (!showsChip(state)) return null;
  const pick = (o: RunsOnOption): void => {
    call("engine.placement.set", { threadId, target: o.target, ...(o.serverId ? { serverId: o.serverId } : {}) }).then(() => load(), () => say?.("Could not change where this chat runs."));
  };
  return <>{element}<RunsOnPill state={state} narrow={narrow} onOpen={(x, y) => show(runsOnEntries(state, pick), x, y, "other", { label: "Runs on" })} /></>;
}

const st = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: "var(--hover)" as string, maxWidth: 160 },
  text: { fontSize: 12, color: "var(--ink-2)" as string, flexShrink: 1 },
});
