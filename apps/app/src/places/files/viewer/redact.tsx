// Files Viewer, Redaction for AI (owner 3 Nov, rc.20): the Redact tab (status and Mark reviewed or Done, Preview as agent, Find things to redact, what is hidden, what a new version could not
// place, the name agents see, the file's Agent access), the Activity tab (who redacted what and when, and every agent read, an agent credited "(Agent)"), the banner under the header, and the
// header's Redact for AI and Activity buttons. Every change is one capability call (files.marks.add, files.marks.remove, files.marks.place, files.review, files.agent_access.set); nothing here
// decides what an agent may read: the server's read gate does.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MenuIcon } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import type { LayerAct, ViewerMark } from "../../../../../../ui/src/Viewer/index.tsx";
import type { FilesViewerData } from "./data.tsx";

export type Access = "on" | "redact" | "off";
export interface LayerMarkRow { markId: string; kind: "redact" | "highlight"; shape: "span" | "box" | "range" | "name"; text?: string; occurrence?: number; box?: { x: number; y: number; w: number; h: number }; from?: number; to?: number; label?: string; by: string; byAgent?: string; at: number; unplaced: boolean }
export interface LayerList {
  state: "available" | "reviewed" | "needs_review" | "off"; version: number; reviewed?: { by: string; at: number; version: number };
  access: { value: Access; own: boolean; inherited: Access; from?: { kind: string; id: string; name: string } };
  marks: readonly LayerMarkRow[]; unplaced: readonly LayerMarkRow[]; names: readonly { markId: string; text: string }[]; requests: readonly { requestId: string; agentId?: string; actingFor?: string; at: number }[];
}
export interface Suggestion { kind: string; label: string; text: string; count: number }
export interface AgentView { state: "clear" | "redacted" | "needs" | "off"; name: string; path: string; text: string | null }
export interface ActivityRow { id: string; who: string; agent: boolean; text: string; at: number; markId?: string }

const ACCESS_WORD: Record<Access, string> = { on: "Available", redact: "Redacted", off: "Not available" };
const GROUP: Record<string, string> = { name: "Names from Records", ssn: "Social Security numbers", dob: "Dates of birth", account: "Account and case numbers", phone: "Phone numbers", email: "Email addresses", address: "Addresses", file_name: "Name and path" };

/** "9:41 am", "Yesterday", "Oct 22": the times the layer shows. */
export function whenText(at: number, now: number): string {
  const d = new Date(at), n = new Date(now);
  const day = (x: Date): number => Math.floor((x.getTime() - x.getTimezoneOffset() * 60_000) / 86_400_000);
  const diff = day(n) - day(d);
  if (diff === 0) { const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0"); return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "am" : "pm"}`; }
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Who made a mark, as people read it: the person, or "Irfad Imtiaz (Agent)" when an agent made it for them. */
export const creditOf = (m: { by: string; byAgent?: string | undefined }, name: (id: string) => string): string => (m.byAgent ? `${name(m.by)} (Agent)` : name(m.by));

/** The file's marks as the shared Viewer draws them. */
export function viewerMarks(list: LayerList | null, name: (id: string) => string, now: number): ViewerMark[] {
  if (!list) return [];
  return list.marks.filter((m) => m.shape !== "name").map((m) => ({
    id: m.markId, kind: m.kind, shape: m.shape, ...(m.text !== undefined ? { text: m.text } : {}), ...(m.occurrence !== undefined ? { occurrence: m.occurrence } : {}), ...(m.box ? { box: m.box } : {}),
    ...(m.label ? { label: m.label } : {}), by: creditOf(m, name), when: m.kind === "redact" ? `${whenText(m.at, now)}${whenText(m.at, now).includes(":") ? " today" : ""}` : whenText(m.at, now),
  }));
}

/** An event of the file's log, as one line of its Activity. Unknown events are left out. */
export function activityOf(e: { id: string; type: string; actor: string; at: number; payload: unknown }, name: (id: string) => string): ActivityRow | null {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const first = (id: string): string => name(id).split(" ")[0] ?? name(id);
  const agentId = typeof p["agentId"] === "string" ? p["agentId"] : typeof p["byAgent"] === "string" ? p["byAgent"] : undefined;
  const by = typeof p["by"] === "string" ? p["by"] : e.actor;
  const label = typeof p["label"] === "string" && p["label"] !== "Text" ? (p["label"] as string).toLowerCase() : null;
  const person = (): string => (typeof p["byAgent"] === "string" ? `${name(by)} (Agent)` : first(by));
  const at = typeof p["markId"] === "string" ? { markId: p["markId"] as string } : {};
  switch (e.type) {
    case "file.redacted": return { id: e.id, ...at, who: person(), agent: typeof p["byAgent"] === "string", text: p["placed"] === true ? "placed a redaction on the new version" : `redacted ${label ? `a ${label}` : p["shape"] === "box" ? "an area" : p["shape"] === "range" ? "a time range" : p["shape"] === "name" ? "part of the name" : "a passage"}`, at: e.at };
    case "file.unredacted": return { id: e.id, who: first(by), agent: false, text: p["dropped"] === true ? "dropped a redaction the new version no longer has" : `un-redacted ${label ? `a ${label}` : "a passage"}`, at: e.at };
    case "file.highlighted": return { id: e.id, ...at, who: person(), agent: typeof p["byAgent"] === "string", text: "highlighted a passage", at: e.at };
    case "file.highlight_removed": return { id: e.id, who: first(by), agent: false, text: "removed a highlight", at: e.at };
    case "file.reviewed": return { id: e.id, who: first(by), agent: false, text: "marked it reviewed", at: e.at };
    case "file.needs_review": return { id: e.id, who: "Vyre", agent: false, text: `could not place ${String(p["unplaced"] ?? 1)} ${p["unplaced"] === 1 ? "redaction" : "redactions"} on version ${String(p["version"] ?? "")}`, at: e.at };
    case "file.agent_read": return agentId ? { id: e.id, who: `${name(agentId)} (Agent)`, agent: true, text: p["redacted"] === true ? "read the redacted version" : "read it", at: e.at } : null;
    case "file.redact_requested": return agentId ? { id: e.id, who: `${name(agentId)} (Agent)`, agent: true, text: "asked to read it", at: e.at } : null;
    case "file.agent_access_changed": return { id: e.id, who: first(by), agent: false, text: `set Agent access to ${ACCESS_WORD[(p["value"] as Access) ?? "on"]}`, at: e.at };
    case "file.comment_added": return { id: e.id, who: first(e.actor), agent: false, text: "commented", at: e.at };
    default: return null;
  }
}

/** Show a mark in the file: scroll it to the middle and flash it (web). */
export function jumpToMark(markId: string): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector(`[data-mark="${markId}"]`) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.animate?.([{ boxShadow: "0 0 0 3px var(--accent-line)" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1400 });
}

/** The layer of one file: its list, the agent's view on demand, the suggestions, its activity, and the calls that change it. */
export function useLayer(d: FilesViewerData, fileId: string) {
  const [list, setList] = useState<LayerList | null>(null);
  const [view, setView] = useState<AgentView | null>(null);
  const [preview, setPreview] = useState(false);
  const [sug, setSug] = useState<readonly Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<readonly ActivityRow[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const reload = useCallback(async (): Promise<void> => {
    try { setList((await d.call("files.marks.list", { fileId })) as LayerList); } catch { setList(null); }
    try {
      const ev = (await d.call("events.list", { subject: { type: "file", id: fileId }, limit: 100 })) as { events: { id: string; type: string; actor: string; at: number; payload: unknown }[] };
      setActivity(ev.events.map((e) => activityOf(e, d.name)).filter((x): x is ActivityRow => x !== null).sort((a, b) => b.at - a.at));
    } catch { setActivity([]); }
  }, [d, fileId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (!preview) return; void d.call("files.agent_view", { fileId }).then((v) => setView(v as AgentView)).catch(() => setView(null)); }, [d, fileId, preview, list]);
  const run = useCallback(async (cap: string, input: unknown, words?: string): Promise<void> => {
    try { await d.call(cap, input); if (words) setSaid(words); await reload(); } catch (e) { setSaid(e instanceof Error ? e.message : "That did not work."); }
  }, [d, reload]);
  const mark = useCallback((a: LayerAct): void => {
    void run("files.marks.add", a.shape === "box" ? { target: { type: "file", id: fileId }, kind: "redact", shape: "box", box: a.box, via: "box" } : { target: { type: "file", id: fileId }, kind: a.kind, shape: "span", text: a.text, occurrence: a.occurrence, via: "select" }, a.kind === "redact" ? "Hidden from AI" : "Highlighted");
  }, [fileId, run]);
  const find = useCallback(async (): Promise<void> => {
    setBusy(true);
    try { setSug(((await d.call("files.redact.detect", { fileId })) as { suggestions: Suggestion[] }).suggestions); } catch (e) { setSaid(e instanceof Error ? e.message : "That did not work."); }
    setBusy(false);
  }, [d, fileId]);
  const accept = useCallback(async (picks: readonly Suggestion[]): Promise<void> => {
    for (const x of picks) {
      await d.call("files.marks.add", x.kind === "file_name" ? { target: { type: "file", id: fileId }, kind: "redact", shape: "name", text: x.text, via: "check" } : { target: { type: "file", id: fileId }, kind: "redact", shape: "span", text: x.text, label: x.label, via: "check" }).catch(() => undefined);
    }
    setSug((cur) => (cur ?? []).filter((s) => !picks.includes(s)));
    setSaid(picks.length === 1 ? "Hidden from AI" : `${picks.length} hidden from AI`);
    await reload();
  }, [d, fileId, reload]);
  return { list, view, preview, setPreview, sug, setSug, busy, activity, said, setSaid, reload, run, mark, find, accept };
}
export type Layer = ReturnType<typeof useLayer>;

const SVG = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`;
const EYE_OFF = `${SVG}<path d="M1.8 8s2.4-4.2 6.2-4.2c1.2 0 2.3.4 3.2.9M14.2 8s-2.4 4.2-6.2 4.2c-1.2 0-2.3-.4-3.2-.9"/><path d="M6.5 9.5a2 2 0 012.9-2.9M2.5 13.5l11-11"/></svg>`;
const PULSE = `${SVG}<path d="M1.8 8.5h2.7l1.8-4.5 3 8.5 1.9-4h3"/></svg>`;
const CHECK = `${SVG}<path d="M3 8.5l3 3 7-7"/></svg>`;
const NOAI = `${SVG}<circle cx="8" cy="8" r="5.5"/><path d="M4.1 11.9l7.8-7.8"/></svg>`;
const LOCK = `${SVG}<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>`;
const FIND = `${SVG}<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14M5.3 7h3.4"/></svg>`;

/** The header's two buttons: Redact for AI and Activity. One of each; the open one wears the accent. */
export function LayerTools({ open, onToggle }: { open: "redact" | "activity" | null; onToggle: (k: "redact" | "activity") => void }): ReactElement {
  const b = (k: "redact" | "activity", label: string, icon: string): ReactElement => (
    <Pressable key={k} accessibilityRole="button" accessibilityLabel={label} aria-selected={open === k} accessibilityState={{ selected: open === k }} testID={`vw-${k}-btn`} onPress={() => onToggle(k)}
      style={({ hovered }: { hovered?: boolean }) => [s.iconBtn, open === k && s.iconOn, hovered === true && s.over]}><MenuIcon icon={icon} /></Pressable>
  );
  return <>{b("redact", "Redact for AI", EYE_OFF)}{b("activity", "Activity", PULSE)}</>;
}

/** The quiet line under the header: Preview as agent, Not available, a new version to place, an agent waiting (with Done), or Needs review. */
export function LayerBanner({ layer, name, onOpen, onDone, panelOpen }: { layer: Layer; name: (id: string) => string; onOpen: () => void; onDone: () => void; panelOpen: boolean }): ReactElement | null {
  const l = layer.list;
  if (!l) return null;
  const line = (icon: string, bold: string, rest: string, acts: ReactNode, testID: string, lock = false): ReactElement => (
    <View style={[s.banner, lock && s.bannerLock]} testID={testID}><MenuIcon icon={icon} /><Text style={s.bannerText}><Text style={s.b}>{bold}</Text>{` ${rest}`}</Text><View style={s.grow} />{acts}</View>
  );
  const link = (label: string, onPress: () => void, testID: string, primary = false): ReactElement => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [primary ? s.primary : s.link, hovered === true && !primary && s.over]}><Text style={primary ? s.primaryText : s.linkText}>{label}</Text></Pressable>
  );
  if (layer.preview) return line(EYE_OFF, "Preview as agent.", "Agents read [REDACTED] and are told not to guess. Highlights come through; comments don't.", link("Back to original", () => layer.setPreview(false), "rx-back"), "rx-banner-preview");
  if (l.state === "off") return line(NOAI, "Not available to AI.", "Agents can't open this file.", null, "rx-banner-off", true);
  if (l.unplaced.length > 0) return line(CHECK, "A new version came in.", `${l.marks.filter((m) => m.kind === "redact").length} of ${l.marks.filter((m) => m.kind === "redact").length + l.unplaced.length} redactions carried over. Agents wait until ${l.unplaced.length} more ${l.unplaced.length === 1 ? "is" : "are"} placed.`, panelOpen ? null : link("Review", onOpen, "rx-review"), "rx-banner-newver");
  if (l.state === "needs_review" && l.requests.length > 0) {
    const who = l.requests[0]?.agentId ? name(l.requests[0].agentId) : "An agent";
    return line(EYE_OFF, `${who} is waiting to read this.`, "Redact what agents shouldn't see, then press Done.", <>{panelOpen ? null : link("Find things to redact", onOpen, "rx-find-open")}{link("Done", onDone, "rx-done", true)}</>, "rx-banner-wait");
  }
  if (l.state === "needs_review") return line(EYE_OFF, "Needs review.", "Agents can't read this until someone reviews it.", panelOpen ? null : <>{link("Find things to redact", onOpen, "rx-find-open")}{link("Mark reviewed", onDone, "rx-mark-reviewed")}</>, "rx-banner-needs");
  return null;
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }): ReactElement {
  return <View style={s.sec}><View style={s.secHead}><Text style={s.secTitle}>{title}</Text>{count !== undefined ? <Text style={s.secCount}>{String(count)}</Text> : null}<View style={s.grow} />{action}</View>{children}</View>;
}

/** The Redact tab. */
export function RedactPanel({ layer, name, now, fileName, path, onDone, onAccess, onJump }: { layer: Layer; name: (id: string) => string; now: number; fileName: string; path: string; onDone: () => void; onAccess: (x: number, y: number) => void; onJump: (markId: string) => void }): ReactElement {
  const l = layer.list;
  const narrow = useWindowDimensions().width < 700;   // the phone: the tab covers the file, as a sheet
  const hidden = useMemo(() => (l ? l.marks.filter((m) => m.kind === "redact" && m.shape !== "name") : []), [l]);
  if (!l) return <View style={[s.panel, narrow && s.sheet]} testID="rx-panel"><Text style={s.quiet}>Loading…</Text></View>;
  const needs = l.state === "needs_review", waiting = l.requests.length > 0;
  const status = l.state === "off" ? ["Not available to AI", "Agents can't open this file.", NOAI] : needs ? ["Needs review", l.unplaced.length ? "A new version came in. Place or drop what didn't fit." : "Agents wait until someone reviews it.", EYE_OFF]
    : l.state === "reviewed" ? ["Reviewed", l.reviewed ? `${name(l.reviewed.by)} · ${whenText(l.reviewed.at, now)}` : "", CHECK] : ["Available to AI", hidden.length ? `${hidden.length} hidden from AI` : "Agents read this file as it is.", EYE_OFF];
  const groups = new Map<string, Suggestion[]>();
  for (const x of layer.sug ?? []) groups.set(x.kind, [...(groups.get(x.kind) ?? []), x]);
  const nameMark = l.marks.find((m) => m.shape === "name");
  return (
    <ScrollView style={[s.panel, narrow && s.sheet]} contentContainerStyle={s.panelBody} testID="rx-panel">
      <View style={s.status} testID="rx-status">
        <View style={[s.statusIco, needs && s.statusNeed, l.state === "reviewed" && s.statusOk]}><MenuIcon icon={status[2] as string} /></View>
        <View style={s.grow}><Text style={s.statusTitle}>{status[0]}</Text><Text style={s.quiet}>{status[1]}</Text></View>
        {needs ? <Pressable accessibilityRole="button" accessibilityLabel={waiting ? "Done" : "Mark reviewed"} disabled={l.unplaced.length > 0} testID="rx-panel-done" onPress={onDone}
          style={[waiting ? s.primary : s.btn, l.unplaced.length > 0 && s.dim]}><Text style={waiting ? s.primaryText : s.btnText}>{waiting ? "Done" : "Mark reviewed"}</Text></Pressable> : null}
      </View>
      <Pressable accessibilityRole="switch" accessibilityLabel="Preview as agent" aria-checked={layer.preview} accessibilityState={{ checked: layer.preview }} testID="rx-preview" onPress={() => layer.setPreview(!layer.preview)} style={s.row}>
        <Text style={s.rowText}>Preview as agent</Text><View style={s.grow} /><View style={[s.switch, layer.preview && s.switchOn]}><View style={[s.knob, layer.preview && s.knobOn]} /></View>
      </Pressable>
      {l.unplaced.length > 0 ? (
        <Section title="Couldn't place" count={l.unplaced.length}>
          {l.unplaced.map((u) => (
            <Row key={u.markId} id={`rx-unplaced-${u.markId}`} title={u.text ?? "An area"} note={`${u.label ?? "Text"} · not in version ${l.version}`}
              trailing={<Pressable accessibilityRole="button" accessibilityLabel="Drop" testID={`rx-drop-${u.markId}`} onPress={() => void layer.run("files.marks.place", { markId: u.markId, drop: true }, "Dropped")} style={s.linkQ}><Text style={s.quietBtn}>Drop</Text></Pressable>} />
          ))}
        </Section>
      ) : null}
      <Section title="Find things to redact" {...(layer.sug && layer.sug.length > 1 ? { action: <Pressable accessibilityRole="button" accessibilityLabel={`Redact all ${layer.sug.length}`} testID="rx-sug-all" onPress={() => void layer.accept(layer.sug ?? [])}><Text style={s.linkText}>{`Redact all ${layer.sug.length}`}</Text></Pressable> } : {})}>
        {layer.busy ? <Text style={s.quiet} testID="rx-busy">Checking on your server…</Text>
          : layer.sug === null ? <Pressable accessibilityRole="button" accessibilityLabel="Find things to redact" testID="rx-find" onPress={() => void layer.find()} style={[s.btn, s.findBtn]}><MenuIcon icon={FIND} /><Text style={s.btnText}>Find things to redact</Text></Pressable>
          : layer.sug.length === 0 ? <Text style={s.quiet} testID="rx-sug-none">Nothing left to suggest.</Text>
          : suggestionRows(groups, layer)}
        <View style={s.note}><MenuIcon icon={LOCK} /><Text style={s.quiet}>Pattern checks on your server. No AI read this file.</Text></View>
      </Section>
      <Section title="Hidden from AI" count={hidden.length}>
        {hidden.length === 0 ? <Text style={s.quiet}>Nothing yet. Select text and press Redact.</Text> : hidden.map((m) => (
          <Row key={m.markId} id={`rx-hidden-${m.markId}`} title={m.shape === "box" ? m.label ?? "Area" : m.text ?? ""} note={`${m.shape === "box" ? "Area" : m.label ?? "Text"} · ${(creditOf(m, name).split(" ")[0]) ?? ""} · ${whenText(m.at, now)}`} onPress={() => onJump(m.markId)}
            trailing={<Pressable accessibilityRole="button" accessibilityLabel="Un-redact" testID={`rx-unredact-${m.markId}`} onPress={() => void layer.run("files.marks.remove", { markId: m.markId }, "Agents can read it again")}><Text style={s.quietBtn}>Un-redact</Text></Pressable>} />
        ))}
      </Section>
      <Section title="Name agents see">
        <View style={s.row}><Text style={[s.mono, s.grow]} numberOfLines={2}>{`${path} / ${nameMark?.text ? fileName.split(nameMark.text).join("[REDACTED]") : fileName}`}</Text></View>
      </Section>
      <Section title="Agent access">
        <View style={s.row}>
          <Text style={[s.rowText, s.grow]}>{`${ACCESS_WORD[l.access.value]}${l.access.own ? " · set on this file" : l.access.from ? ` · from ${l.access.from.name}` : ""}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Change Agent access" testID="rx-access-change" onPress={(e) => onAccess(e.nativeEvent.pageX, e.nativeEvent.pageY + 8)}><Text style={s.linkText}>Change</Text></Pressable>
        </View>
      </Section>
    </ScrollView>
  );
}

/** Find things to redact, grouped by what the checks found: each a row with Redact (Redact all of this name, for a name) and Skip. */
function suggestionRows(groups: ReadonlyMap<string, Suggestion[]>, layer: Layer): ReactNode[] {
  const out: ReactNode[] = [];
  for (const [k, list] of groups) {
    out.push(<Text key={`g-${k}`} style={s.group} testID={`rx-group-${k}`}>{GROUP[k] ?? k}</Text>);
    for (const x of list) {
      const word = x.kind === "name" && x.count > 1 ? "Redact all of this name" : x.count > 1 ? `Redact all ${x.count}` : "Redact";
      out.push(
        <Row key={`${k}-${x.text}`} id={`rx-sug-${x.text}`} title={x.text} {...(x.kind === "file_name" ? { note: "In the file name" } : x.count > 1 ? { note: `${x.count} times in this file` } : {})}
          trailing={<View style={s.sugActs}><Pressable accessibilityRole="button" accessibilityLabel={word} testID={`rx-accept-${x.text}`} onPress={() => void layer.accept([x])} style={s.linkQ}><Text style={s.linkText}>{word}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Skip" testID={`rx-skip-${x.text}`} onPress={() => layer.setSug((cur) => (cur ?? []).filter((y) => y !== x))} style={s.linkQ}><Text style={s.quietBtn}>Skip</Text></Pressable></View>} />,
      );
    }
  }
  return out;
}

/** The Activity tab: newest first, by day; a line opens the spot it is about. */
export function ActivityPanel({ rows, now, onOpen }: { rows: readonly ActivityRow[]; now: number; onOpen: (row: ActivityRow) => void }): ReactElement {
  const narrow = useWindowDimensions().width < 700;
  const out: ReactNode[] = [];
  let day = "";
  for (const r of rows) {
    const w = whenText(r.at, now), d = w.includes(":") ? "Today" : w;
    if (d !== day) { day = d; out.push(<Text key={`d-${d}`} style={s.day}>{d}</Text>); }
    const t = new Date(r.at), clock = `${t.getHours() % 12 === 0 ? 12 : t.getHours() % 12}:${String(t.getMinutes()).padStart(2, "0")}`;
    out.push(<Row key={r.id} id={`rx-act-${r.id}`} title={r.who} titleSuffix={r.text} leading={<Avatar name={r.who.replace(/ \(Agent\)$/, "")} kind={r.agent ? "agent" : "person"} size={18} />} trailing={<Text style={s.quiet}>{clock}</Text>} onPress={() => onOpen(r)} />);
  }
  return <ScrollView style={[s.panel, narrow && s.sheet]} contentContainerStyle={s.panelBody} testID="rx-activity">{rows.length ? out : <Text style={s.quiet}>Nothing yet.</Text>}</ScrollView>;
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  iconBtn: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  iconOn: { backgroundColor: "var(--accent-wash)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 16, backgroundColor: "var(--accent-wash)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  bannerLock: { backgroundColor: "var(--sunk)" as string },
  bannerText: { color: "var(--ink-2)" as string, fontSize: 12.5, lineHeight: 18, flexShrink: 1 },
  b: { color: "var(--ink)" as string, fontWeight: "600" },
  link: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  linkQ: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  linkText: { color: "var(--accent)" as string, fontWeight: "600", fontSize: 12.5 },
  quietBtn: { color: "var(--ink-3)" as string, fontWeight: "500", fontSize: 12.5 },
  primary: { height: 28, paddingHorizontal: 12, borderRadius: 7, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "var(--accent-ink)" as string, fontWeight: "600", fontSize: 13 },
  btn: { height: 28, paddingHorizontal: 12, borderRadius: 7, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  btnText: { color: "var(--ink)" as string, fontWeight: "500", fontSize: 13 },
  dim: { opacity: 0.5 },
  findBtn: { alignSelf: "flex-start" },
  panel: { width: 340, flexGrow: 0, flexShrink: 0, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  panelBody: { padding: 14, gap: 16 },
  sheet: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, width: "auto" as never, zIndex: 5, backgroundColor: "var(--win)" as string, borderLeftWidth: 0 },
  status: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusIco: { width: 30, height: 30, borderRadius: 8, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center" },
  statusNeed: { backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)" as string },
  statusOk: { backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)" as string },
  statusTitle: { color: "var(--ink)" as string, fontWeight: "600", fontSize: 13 },
  quiet: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  rowText: { color: "var(--ink)" as string, fontSize: 13 },
  switch: { width: 30, height: 18, borderRadius: 99, backgroundColor: "var(--line-2)" as string, padding: 2 },
  switchOn: { backgroundColor: "var(--accent)" as string },
  knob: { width: 14, height: 14, borderRadius: 99, backgroundColor: "#FFFFFF" },
  knobOn: { transform: [{ translateX: 12 }] },
  sec: { gap: 6 },
  secHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  secTitle: { color: "var(--ink-2)" as string, fontWeight: "600", fontSize: 12 },
  secCount: { color: "var(--ink-3)" as string, fontSize: 12 },
  group: { color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "500", marginTop: 6 },
  sug: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  sugActs: { flexDirection: "row", alignItems: "center", gap: 2 },
  mono: { color: "var(--ink)" as string, fontSize: 12, fontFamily: "var(--mono)" as string },
  note: { flexDirection: "row", gap: 7, alignItems: "center" },
  unplaced: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: "color-mix(in srgb, var(--warn) 10%, transparent)" as string },
  item: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 7 },
  itemText: { color: "var(--ink)" as string, fontSize: 12.5 },
  day: { color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "600", marginTop: 8 },
  act: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingVertical: 7, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 8 },
  actText: { color: "var(--ink-2)" as string, fontSize: 12.5, lineHeight: 18 },
});
