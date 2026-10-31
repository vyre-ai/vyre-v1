// The small entry that lingers in the app while setup is unfinished: a progress ring and "Finish setup, 3 of 8". It reopens onboarding at the first step not yet done or skipped,
// and disappears once every step is handled. Hide puts it away for good on this device (the Home checklist still reopens setup).
import { createContext, useContext, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { COMPACT_BELOW } from "../shell/spaces/Shell.tsx";
import { countsOn, stateOn, visibleSteps } from "./device.ts";
import type { Device } from "./device.ts";
import type { FlowKind, Progress } from "./flow.ts";

const KEY = "vyre.setup.hidden";
const read = (flow: FlowKind): boolean => { try { return (globalThis as { localStorage?: Storage }).localStorage?.getItem(`${KEY}.${flow}`) === "1"; } catch { return false; } };
const write = (flow: FlowKind): void => { try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(`${KEY}.${flow}`, "1"); } catch { /* hidden for this visit only */ } };

/** Handled steps (done or skipped) of all, and the first step still open; null when everything is handled. */
export function resumeInfo(flow: FlowKind, progress: Progress, device: Device): { handled: number; total: number; step: string } | null {
  const c = countsOn(flow, progress, device);
  const step = visibleSteps(flow, device).find((st) => stateOn(progress, st, device) === "open");
  return step ? { handled: c.done + c.later, total: c.total, step: step.key } : null;
}

/** Unfinished setup for screens that show it in place (the phone's You page): handled of total, and how to reopen it. Null when setup is done or open. */
export interface Resume { handled: number; total: number; open(): void }
export const ResumeContext = createContext<Resume | null>(null);
export const useResume = (): Resume | null => useContext(ResumeContext);

export function ResumeChip({ flow, progress, device, onOpen, compact }: { flow: FlowKind; progress: Progress; device: Device; onOpen(step: string): void; compact?: boolean }): ReactElement | null {
  const [hidden, setHidden] = useState(() => read(flow));
  const width = useWindowDimensions().width;
  const overBar = compact ?? (width > 0 && width < COMPACT_BELOW);
  const info = resumeInfo(flow, progress, device);
  if (!info || hidden) return null;
  const R = 9, C = 2 * Math.PI * R, off = C * (1 - info.handled / Math.max(info.total, 1));
  // On the phone a floating pill would cover the page's own controls (Sign out, the send button): the You page carries a Finish setup row instead (ResumeContext).
  if (overBar) return null;
  const ringSvg = (globalThis as { document?: unknown }).document ? <svg width={24} height={24} viewBox="0 0 24 24"><circle cx={12} cy={12} r={R} fill="none" stroke="var(--line-2)" strokeWidth={3} /><circle cx={12} cy={12} r={R} fill="none" stroke="var(--accent)" strokeWidth={3} strokeDasharray={C} strokeDashoffset={off} strokeLinecap="round" transform="rotate(-90 12 12)" /></svg> : null;
  return (
    <View testID="resume-chip" style={s.chip}>
      <Pressable testID="resume-open" accessibilityRole="button" accessibilityLabel={`Finish setup, ${info.handled} of ${info.total}`} onPress={() => onOpen(info.step)} style={s.open}>
        <View testID="resume-ring" style={s.ring}>{ringSvg}</View>
        <Text style={s.text}>{`Finish setup, ${info.handled} of ${info.total}`}</Text>
      </Pressable>
      <Pressable testID="resume-hide" accessibilityRole="button" onPress={() => { write(flow); setHidden(true); }} style={s.hide}><Text style={s.hideText}>Hide</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  chip: { position: "absolute", left: 16, bottom: 16, zIndex: 40, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 12, paddingRight: 6, height: 40, borderRadius: 20, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, boxShadow: "var(--sh-1)" } as object,
  open: { flexDirection: "row", alignItems: "center", gap: 8, height: 40 },
  ring: { width: 24, height: 24 },
  text: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  hide: { height: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: "center" },
  hideText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
