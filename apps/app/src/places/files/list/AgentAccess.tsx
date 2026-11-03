// Files list, Redaction for AI (owner 3 Nov, rc.20): the folder's Agent access control in the header (Available, Redacted or Not available, where it comes from, and what is set differently
// inside, each with Reset), the "3 files need review" line with Review next, and each line's badge (Needs review, Reviewed, Not available to AI, an agent waiting). It reads files.agent_states
// for the open folder; a change is files.agent_access.set. Mounted Drive, OneDrive and SharePoint folders are Files folders, so the same control covers them.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MenuIcon } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useFilesData, useLive } from "../tree/data.tsx";

export type Access = "on" | "redact" | "off";
export type Badge = "clear" | "hidden" | "reviewed" | "needs_review" | "off";
export interface AgentStates {
  access: { value: Access; own: boolean; inherited: Access; from?: { kind: string; id: string; name: string }; setBy?: string; setAt?: number; overrides?: readonly { kind: string; id: string; name: string; value: Access }[]; files?: number };
  needs: number; queue: readonly string[];
  files: readonly { fileId: string; state: Badge; own: boolean; waiting?: readonly string[] }[];
  folders: readonly { folderId: string; value: Access; own: boolean; needs: number }[];
}

const SVG = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`;
export const ACCESS_ICON: Record<Access, string> = {
  on: `${SVG}<path d="M1.8 8S4.2 3.8 8 3.8 14.2 8 14.2 8 11.8 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.9"/></svg>`,
  redact: `${SVG}<path d="M1.8 8s2.4-4.2 6.2-4.2c1.2 0 2.3.4 3.2.9M14.2 8s-2.4 4.2-6.2 4.2c-1.2 0-2.3-.4-3.2-.9"/><path d="M6.5 9.5a2 2 0 012.9-2.9M2.5 13.5l11-11"/></svg>`,
  off: `${SVG}<circle cx="8" cy="8" r="5.5"/><path d="M4.1 11.9l7.8-7.8"/></svg>`,
};
export const ACCESS_WORD: Record<Access, string> = { on: "Available", redact: "Redacted", off: "Not available" };
const ACCESS_LINE: Record<Access, string> = { on: "Agents read files. Redacted parts stay hidden.", redact: "Agents read reviewed, redacted versions only.", off: "Agents can't open anything here." };
const CHECK = `${SVG}<path d="M3 8.5l3 3 7-7"/></svg>`;

export function useAgentStates(folderId: string | undefined): AgentStates | null {
  const q = useLive("files.agent_states" as never, (folderId ? { folderId } : { folderId: "" }) as never);
  if (!folderId) return null;
  return q.status === "ready" ? (q.data as unknown as AgentStates) : null;
}

/** A line's badge after its name: what agents may do with it. Only what changes something shows (an Available file with nothing hidden has none). */
export function LayerBadge({ state, waiting, name, compact = false }: { state: Badge | undefined; waiting?: readonly string[] | undefined; name: (id: string) => string; compact?: boolean }): ReactElement | null {
  if (state === undefined || state === "clear") return null;
  // the phone keeps the name: a dot for Needs review, the glyph for the rest
  if (compact) return <View style={s.badges} testID={`rx-badge-${state}`} accessibilityLabel={state === "needs_review" ? "Needs review" : state === "reviewed" ? "Reviewed" : state === "off" ? "Not available to AI" : "Parts hidden from AI"}>{state === "needs_review" ? <View style={s.dot} /> : <MenuIcon icon={state === "reviewed" ? CHECK : ACCESS_ICON[state === "off" ? "off" : "redact"]} size={12} color="var(--ink-3)" />}</View>;
  return (
    <View style={s.badges} testID={`rx-badge-${state}`}>
      {state === "needs_review" ? <View style={s.badge}><View style={s.dot} /><Text style={[s.badgeText, s.warn]}>Needs review</Text></View> : null}
      {state === "reviewed" ? <View style={s.badge}><MenuIcon icon={CHECK} size={12} color="var(--ink-3)" /><Text style={s.badgeText}>Reviewed</Text></View> : null}
      {state === "off" ? <View style={s.badge}><MenuIcon icon={ACCESS_ICON.off} size={12} color="var(--ink-3)" /><Text style={s.badgeText}>Not available to AI</Text></View> : null}
      {state === "hidden" ? <View style={s.badge} accessibilityLabel="Parts hidden from AI"><MenuIcon icon={ACCESS_ICON.redact} size={12} color="var(--ink-3)" /></View> : null}
      {waiting && waiting.length > 0 ? <View style={s.badge}><Text style={[s.badgeText, s.accent]}>{`${name(waiting[0]!)} is waiting`}</Text></View> : null}
    </View>
  );
}
/** A subfolder's badge: its own setting when it differs from this folder, and how many below it wait. */
export function FolderBadge({ value, own, needs, compact = false }: { value: Access; own: boolean; needs: number; compact?: boolean }): ReactElement | null {
  if (!own && needs === 0) return null;
  if (compact) return <View style={s.badges} testID="rx-folder-badge">{own ? <MenuIcon icon={ACCESS_ICON[value]} size={12} color="var(--ink-3)" /> : null}{needs > 0 && value !== "off" ? <View style={s.dot} /> : null}</View>;
  return (
    <View style={s.badges} testID="rx-folder-badge">
      {own ? <View style={s.badge}><MenuIcon icon={ACCESS_ICON[value]} size={12} color="var(--ink-3)" /><Text style={s.badgeText}>{value === "redact" ? "Redacted for AI" : value === "off" ? "Not available to AI" : "Available to AI"}</Text></View> : null}
      {needs > 0 && value !== "off" ? <View style={s.badge}><View style={s.dot} /><Text style={[s.badgeText, s.warn]}>{`${needs} need review`}</Text></View> : null}
    </View>
  );
}

/** "3 files need review before agents can read them" with Review next (the first of them opens with its Redact tab). */
export function ReviewLine({ states, onNext, compact = false }: { states: AgentStates | null; onNext: (fileId: string) => void; compact?: boolean }): ReactElement | null {
  if (!states || states.needs === 0 || states.access.value === "off" || !states.queue[0]) return null;
  return (
    <View style={s.line} accessibilityRole="alert" testID="rx-review-line">
      <MenuIcon icon={ACCESS_ICON.redact} color="var(--accent)" />
      <Text style={s.lineText} numberOfLines={1}>{compact ? `${states.needs} to review for AI` : `${states.needs} ${states.needs === 1 ? "file needs" : "files need"} review before agents can read ${states.needs === 1 ? "it" : "them"}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Review next" testID="rx-review-next" onPress={() => onNext(states.queue[0]!)} style={({ hovered }: { hovered?: boolean }) => [s.next, hovered === true && s.over]}>
        <Text style={s.nextText}>Review next</Text>
      </Pressable>
    </View>
  );
}

/** The header's Agent access control: a quiet text button with the folder's setting; it opens the popover (AccessPopover), which the list draws over itself. */
export function AccessControl({ states, open, onToggle }: { states: AgentStates | null; open: boolean; onToggle: () => void }): ReactElement | null {
  if (!states) return null;
  const a = states.access;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Agent access: ${ACCESS_WORD[a.value]}`} aria-expanded={open} testID="rx-access" onPress={onToggle}
      style={({ hovered }: { hovered?: boolean }) => [s.control, (hovered === true || open) && s.over]}>
      <MenuIcon icon={ACCESS_ICON[a.value]} /><Text style={s.controlText}>{ACCESS_WORD[a.value]}</Text><Text style={s.chev}>⌄</Text>
    </Pressable>
  );
}

/** The Agent access popover: the three choices, where the setting comes from, and what is set differently inside, each with Reset. Drawn last in the list so nothing paints over it. */
export function AccessPopover({ folderId, folderName, parentName, states, onClose }: { folderId: string; folderName: string; parentName: string; states: AgentStates | null; onClose: () => void }): ReactElement | null {
  const data = useFilesData();
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  if (!states) return null;
  const a = states.access;
  const set = async (value: Access | null, target = folderId): Promise<void> => {
    try { await data.call("files.agent_access.set", { target: { type: "folder", id: target }, value }); setSaid(null); } catch (e) { setSaid(e instanceof Error ? e.message : "That did not work."); }
  };
  const reset = async (id: string, kind: string): Promise<void> => { try { await data.call("files.agent_access.set", { target: { type: kind === "file" ? "file" : "folder", id }, value: null }); } catch (e) { setSaid(e instanceof Error ? e.message : "That did not work."); } };
  return (
    <View style={s.pop} testID="rx-access-pop" accessibilityRole="menu" accessibilityLabel="Agent access">
      <View style={s.popHead}><Text style={s.popTitle}>Agent access</Text><Text style={s.quiet}>{folderName}</Text></View>
      {/* ui-rows-lint: not a list (the three fixed choices of a popover, a radio group) */}
      {(["on", "redact", "off"] as const).map((v) => (
        <Pressable key={v} accessibilityRole="menuitemradio" aria-checked={a.value === v} accessibilityState={{ checked: a.value === v }} testID={`rx-access-${v}`} onPress={() => void set(v === a.inherited ? null : v)}
          style={({ hovered }: { hovered?: boolean }) => [s.opt, hovered === true && s.over]}>
          <MenuIcon icon={ACCESS_ICON[v]} />
          <View style={s.grow}><Text style={s.optTitle}>{ACCESS_WORD[v]}</Text><Text style={s.quiet}>{ACCESS_LINE[v]}</Text></View>
          {a.value === v ? <MenuIcon icon={CHECK} color="var(--accent)" /> : null}
        </Pressable>
      ))}
      <View style={s.hr} />
      <View style={s.inh} testID="rx-access-inherit">
        {a.own
          ? <><Text style={[s.quiet, s.grow]}>{`Set here${a.setBy ? ` by ${data.nameOf(a.setBy).split(" ")[0]}` : ""}. ${parentName} is ${ACCESS_WORD[a.inherited]}.`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Inherit" testID="rx-access-reset-own" onPress={() => void set(null)}><Text style={s.nextText}>Inherit</Text></Pressable></>
          : <Text style={s.quiet}>{`Inherited from ${a.from?.name ?? parentName}`}</Text>}
      </View>
      {(a.overrides ?? []).length > 0 ? (
        <>
          <Text style={s.gh}>Different inside</Text>
          {(a.overrides ?? []).map((o) => (
            <Row key={o.id} id={`rx-override-${o.id}`} title={o.name} trailing={<View style={s.ovActs}><Text style={s.quiet}>{ACCESS_WORD[o.value]}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Reset ${o.name}`} testID={`rx-reset-${o.id}`} onPress={() => void reset(o.id, o.kind)}><Text style={s.nextText}>Reset</Text></Pressable></View>} />
          ))}
        </>
      ) : null}
      {a.files !== undefined ? <Text style={[s.quiet, s.foot]}>{`${a.files} ${a.files === 1 ? "file follows" : "files follow"} this setting.`}</Text> : null}
      {said ? <Text style={[s.quiet, s.foot]} accessibilityLiveRegion="polite">{said}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  badges: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 6 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4 },
  badgeText: { fontSize: 12, color: "var(--ink-3)" as string },
  warn: { color: "var(--warn)" as string },
  accent: { color: "var(--accent)" as string },
  dot: { width: 6, height: 6, borderRadius: 99, backgroundColor: "var(--warn)" as string },
  line: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 10, minHeight: 30, paddingLeft: 12, paddingRight: 6, borderRadius: 9, backgroundColor: "var(--accent-wash)" as string },
  lineText: { flex: 1, minWidth: 0, color: "var(--ink-2)" as string, fontSize: 12.5 },
  next: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  nextText: { color: "var(--accent)" as string, fontWeight: "600", fontSize: 12.5 },
  over: { backgroundColor: "var(--hover)" as string },
  wrap: { position: "relative", zIndex: 30 },
  control: { height: 28, paddingHorizontal: 8, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  controlText: { color: "var(--ink)" as string, fontWeight: "500", fontSize: 12.5 },
  chev: { color: "var(--ink-3)" as string, fontSize: 10, marginTop: -4 },
  pop: { position: "absolute", zIndex: 1000, top: 46, right: 150, width: 312, padding: 6, borderRadius: 10, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" } as never,
  popHead: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 },
  popTitle: { color: "var(--ink)" as string, fontWeight: "600", fontSize: 13 },
  quiet: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 16 },
  opt: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 7 },
  optTitle: { color: "var(--ink)" as string, fontWeight: "500", fontSize: 13 },
  hr: { height: 1, backgroundColor: "var(--line)" as string, marginVertical: 6, marginHorizontal: 4 },
  inh: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 4, minHeight: 26 },
  gh: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 2, color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "600" },
  ov: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  ovName: { color: "var(--ink)" as string, fontSize: 12.5 },
  ovActs: { flexDirection: "row", alignItems: "center", gap: 8 },
  foot: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 6 },
});
