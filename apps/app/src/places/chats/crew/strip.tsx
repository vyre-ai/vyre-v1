// The crew strip in a chat (owner, 4 Nov 2026, prototype p-crew): one raised row per helper inside one sunk strip, updated in place from engine.crew.status. A row is a face in a ring that turns while it
// works and closes when it is done, the name and what it was asked, one line of what it is on or found, a clock, and for code its branch and change. The whole row opens the peek; there is no Open button.
import { createElement, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { injectCss } from "../../../../../../ui/src/theme/css.ts";
import { clock, isCode, lineOf, modelTag, nameOf, roleOf, stripTitle, stripTone, testsWords } from "./model.ts";
import type { CrewMember, CrewTotals } from "./model.ts";

const web = Platform.OS === "web";
const CSS = [
  "@keyframes vy-cw-spin{to{transform:rotate(360deg)}}",
  "@keyframes vy-cw-live{0%{box-shadow:0 0 0 0 var(--accent-line)}70%,100%{box-shadow:0 0 0 7px transparent}}",
  "@keyframes vy-cw-pulse{0%,100%{opacity:1}50%{opacity:.35}}",
  "@keyframes vy-cw-fan{from{opacity:0;transform:translateY(9px) scale(.97)}to{opacity:1;transform:none}}",
  ".vy-cw-arc{transform-box:fill-box;transform-origin:center;animation:vy-cw-spin 1.5s linear infinite}",
  ".vy-cw-dot{animation:vy-cw-live 1.9s ease-out infinite}",
  ".vy-cw-wait{animation:vy-cw-pulse 1.8s ease-in-out infinite}",
  ".vy-cw-row{animation:vy-cw-fan .18s cubic-bezier(.2,.9,.3,1.1) both}",
  "@media (prefers-reduced-motion:reduce){.vy-cw-arc,.vy-cw-dot,.vy-cw-wait,.vy-cw-row{animation:none}}",
].join("\n");
const ensureCss = (): void => { if (web) injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-crew-strip", CSS); };

const TONE = { working: "var(--accent)", needs_you: "var(--warn)", done: "var(--ok)", failed: "var(--ink-3)", stopped: "var(--ink-4)" } as const;

/** The ring around a face: a track, a turning arc while it works, a closed ring when done, pulsing amber when it needs you, dashed when it failed. */
export function MemberRing({ state, size = 38, id }: { state: CrewMember["state"]; size?: number; id: string }): ReactElement | null {
  if (!web) return <View testID={`${id}-ring`} style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: TONE[state] as string }} />;
  ensureCss();
  const r = size / 2 - 1, c = 2 * Math.PI * r;
  const circle = (props: Record<string, unknown>): ReactElement => createElement("circle", { cx: size / 2, cy: size / 2, r, fill: "none", strokeWidth: 2, strokeLinecap: "round", ...props });
  return createElement("svg", { "data-testid": `${id}-ring`, "data-state": state, width: size, height: size, viewBox: `0 0 ${size} ${size}`, "aria-hidden": true, style: { position: "absolute", inset: 0, overflow: "visible", transform: "rotate(-90deg)" } },
    circle({ stroke: "var(--line-2)" }),
    state === "working" ? circle({ className: "vy-cw-arc", stroke: "var(--accent)", strokeDasharray: `${c * 0.34} ${c}` }) : null,
    state === "done" ? circle({ stroke: "var(--ok)", strokeDasharray: c }) : null,
    state === "needs_you" ? circle({ className: "vy-cw-wait", stroke: "var(--warn)" }) : null,
    state === "failed" ? circle({ stroke: "var(--ink-3)", strokeDasharray: "2.4 4.4" }) : null,
    state === "stopped" ? circle({ stroke: "var(--ink-4)" }) : null);
}

/** A ticking now, once a second while something works. */
export function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!live) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); (t as { unref?: () => void }).unref?.(); return () => clearInterval(t); }, [live]);
  return now;
}

/** What a row's clock shows: running time while it works, total once it ended. */
export const timeOf = (m: Pick<CrewMember, "state" | "startedAt" | "elapsedMs">, now: number): string => clock(m.state === "working" || m.state === "needs_you" ? Math.max(m.elapsedMs, now - m.startedAt) : m.elapsedMs);

export function HelperChip({ m, now, selected = false, index = 0, onPress, onRetry }: { m: CrewMember; now: number; selected?: boolean; index?: number; onPress: (m: CrewMember) => void; onRetry?: (m: CrewMember) => void }): ReactElement {
  const id = `crew-chip-${m.id}`;
  const name = nameOf(m);
  const code = isCode(m);
  const tag = m.why ? modelTag(m) : "";
  const canRetry = m.state === "failed" || m.state === "stopped";
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${name}, ${lineOf(m)}`} testID={id} onPress={() => onPress(m)}
      {...(web ? { dataSet: { state: m.state } } : {})}
      style={[st.chip, m.state === "needs_you" && st.chipWait, selected && st.chipSel, web ? ({ animationDelay: `${index * 70}ms` } as object) : null]}
    >
      <View style={st.av}>
        <MemberRing state={m.state} id={id} />
        <Avatar name={name} seedId={m.agentId} kind="agent" size={28} />
      </View>
      <View style={st.main}>
        <View style={st.l1}><Text numberOfLines={1} style={st.name}>{name}</Text><Text numberOfLines={1} testID={`${id}-role`} style={st.role}>{roleOf(m)}</Text></View>
        <Text numberOfLines={1} testID={`${id}-line`} style={[st.line, m.state === "failed" && st.lineFail, m.state === "needs_you" && st.lineWait]}>{lineOf(m)}</Text>
        {code || tag ? (
          <View style={st.l3}>
            {code ? <Text numberOfLines={1} testID={`${id}-branch`} style={st.branch}>{m.branch}</Text> : null}
            {code && (m.added !== undefined || m.deleted !== undefined) ? <Text testID={`${id}-diff`} style={st.mono}><Text style={st.add}>+{m.added ?? 0}</Text> <Text style={st.del}>−{m.deleted ?? 0}</Text></Text> : null}
            {code && m.tests ? <Text testID={`${id}-tests`} style={[st.mono, m.tests.state === "passing" && st.add, m.tests.state === "failing" && st.del]}>{testsWords(m.tests)}</Text> : null}
            {tag ? <Text numberOfLines={1} testID={`${id}-model`} style={st.mono}>{tag}</Text> : null}
          </View>
        ) : null}
      </View>
      {canRetry && onRetry ? <Pressable accessibilityRole="button" testID={`${id}-retry`} onPress={() => onRetry(m)} style={st.retry}><Text style={st.retryText}>Retry</Text></Pressable> : <Text testID={`${id}-time`} style={st.time}>{timeOf(m, now)}</Text>}
    </Pressable>
  );
}

export function CrewStrip({ members, totals, selectedId, onPeek, onStopAll, onOpenPane, onRetry }: {
  members: readonly CrewMember[]; totals: CrewTotals; selectedId?: string | null; onPeek: (m: CrewMember) => void; onStopAll?: () => void; onOpenPane?: () => void; onRetry?: (m: CrewMember) => void;
}): ReactElement | null {
  const live = totals.working + totals.needsYou > 0;
  const now = useNow(live);
  if (members.length === 0) return null;
  const tone = stripTone(totals);
  ensureCss();
  return (
    <View testID="crew-strip" accessibilityRole="summary" {...(web ? { dataSet: { tone } } : {})} style={st.strip}>
      <View style={st.head}>
        <View testID="crew-strip-dot" style={[st.dot, tone === "idle" && { backgroundColor: "var(--ok)" as string }, tone === "need" && { backgroundColor: "var(--warn)" as string }]} {...(web && tone !== "idle" ? { className: "vy-cw-dot" } : {})} />
        <Text numberOfLines={1} testID="crew-strip-title" style={st.title}>{stripTitle(totals)}</Text>
        {live && onStopAll ? <Pressable accessibilityRole="button" testID="crew-strip-stop-all" onPress={onStopAll} style={st.headBtn}><Text style={st.headBtnText}>Stop all</Text></Pressable> : null}
        {onOpenPane ? <Pressable accessibilityRole="button" accessibilityLabel="Open the Crew pane" testID="crew-strip-pane" onPress={onOpenPane} style={st.headBtn}><Text style={st.headBtnText}>Crew</Text></Pressable> : null}
      </View>
      <View style={st.list}>
        {members.map((m, i) => <HelperChip key={m.id} m={m} now={now} index={i} selected={selectedId === m.id} onPress={onPeek} {...(onRetry ? { onRetry } : {})} />)}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  strip: { marginVertical: 14, padding: 5, borderRadius: 20, maxWidth: 660, backgroundColor: "var(--sunk)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, paddingLeft: 12, paddingRight: 3 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 9, backgroundColor: "var(--accent)" as string },
  title: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink-2)" as string },
  headBtn: { height: 27, paddingHorizontal: 10, borderRadius: 8, justifyContent: "center" },
  headBtnText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  list: { gap: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, paddingLeft: 10, paddingRight: 12, borderRadius: 15, backgroundColor: "var(--raised)" as string },
  chipWait: { backgroundColor: "color-mix(in srgb, var(--warn) 12%, var(--raised))" as string },
  chipSel: { boxShadow: "0 0 0 1.5px var(--accent)" } as object,
  av: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  main: { flex: 1, minWidth: 0, gap: 1 },
  l1: { flexDirection: "row", alignItems: "baseline", gap: 8, minWidth: 0 },
  name: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  role: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  line: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  lineFail: { color: "var(--ink)" as string },
  lineWait: { color: "var(--ink)" as string },
  l3: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 1 },
  branch: { flexShrink: 1, fontSize: 12, color: "var(--ink-2)" as string, backgroundColor: "var(--hover)" as string, borderRadius: 6, paddingHorizontal: 6, fontFamily: "var(--mono)" as string },
  mono: { fontSize: 12, color: "var(--ink-3)" as string, fontFamily: "var(--mono)" as string },
  add: { color: "var(--ok)" as string },
  del: { color: "var(--danger)" as string },
  time: { fontSize: 12.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  retry: { height: 26, paddingHorizontal: 11, borderRadius: 9, justifyContent: "center", backgroundColor: "var(--sel)" as string },
  retryText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
});
