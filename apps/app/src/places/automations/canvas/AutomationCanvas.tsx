// The Automation canvas (spec 3.7, 2.12; ARCH 7.7): header, tabs, and the Steps surface where an Automation is built. Several triggers on one card, then steps down the page; Paths and
// Parallel fan out into lanes and come back together, a Loop wraps its body, Wait, Approval and Stop are cards like any other. A run lights the lane it took. Errors show on the card
// and in a line under the tabs while someone builds. Edits are a draft: Save (or Cmd-S) writes one version; Undo (Cmd-Z) takes back the latest edit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { AddDot, StepCard, TriggerCard } from "./Cards.tsx";
import type { CardHandlers } from "./Cards.tsx";
import { Inspector } from "./Inspector.tsx";
import { Glyph } from "./icons.tsx";
import { CANVAS, CONFIG, useAutomationsData, useScreenQuery } from "./data.tsx";
import {
  TRIGGER_PALETTE, addAfter, addInto, addTrigger, check, clampZoom, describeTrigger, duplicateStep, fitScale, kindOfKey, layout, moveStep, neighbour, palette, removeStep, removeTrigger, sortedIssues,
} from "./model.ts";
import type { CardNode, DefTrigger, Definition, Issue, RunState } from "./model.ts";
import { Dot, IconButton, SubTabs, TextButton, pointer, webOnly } from "./parts.tsx";
import type { KeyEventLike, SubTab } from "./parts.tsx";

type GetOut = CapMap["automations.get"]["out"];
type VersionsOut = CapMap["automations.versions"]["out"];
type RunsOut = CapMap["runs.list"]["out"];

export type CanvasTab = "steps" | "runs" | "versions" | "settings";

export interface CanvasProps {
  automationId: string;
  /** Bodies other packets own (RunHistory, Config): the Runs and Settings tabs show them when given. Versions has a built-in list. */
  tabBodies?: Partial<Record<Exclude<CanvasTab, "steps">, ReactNode>>;
  initialTab?: CanvasTab;
  /** A run to light on the canvas (its steps), controlled by the caller; the canvas also lets a person pick one from the Runs list. */
  run?: { id: string; label: string; states: Readonly<Record<string, RunState>> } | null;
  onClearRun?: () => void;
  paneOpen?: boolean;
  onTogglePane?: () => void;
  initialZoom?: number;
  /** Start with this step selected (the panel open). */
  initialSelected?: string | null;
  /** Start with the step panel open on the selected step. */
  initialPanel?: boolean;
}

const DEFAULT_ZOOM = 0.84;

export function AutomationCanvas({ automationId, tabBodies, initialTab = "steps", run = null, onClearRun, paneOpen = false, onTogglePane, initialZoom = DEFAULT_ZOOM, initialSelected = null, initialPanel = false }: CanvasProps): ReactElement {
  const data = useAutomationsData();
  const q = useScreenQuery<GetOut>(CANVAS, "automation", { automationId, route: { automationId } });
  const failed = useScreenQuery<RunsOut>(CONFIG, "runs", { subject: { type: "automation", id: automationId }, statuses: ["failed"], scope: "subject" });
  const versions = useScreenQuery<VersionsOut>(CONFIG, "versions", { automationId });
  const [tab, setTab] = useState<CanvasTab>(initialTab);
  if (q.status !== "ready") return <Frame><Text style={s.dim} accessibilityRole="progressbar">Loading</Text></Frame>;
  const a = q.data.automation as GetOut["automation"] | undefined;
  if (!a) return <Frame><Text style={s.dim} testID="canvas-empty">This Automation is not available</Text></Frame>;
  return (
    <CanvasBody
      key={a.id}
      a={a}
      tab={tab}
      setTab={setTab}
      failedRuns={failed.status === "ready" ? failed.data.runs.length : 0}
      versions={versions.status === "ready" ? versions.data.versions : []}
      tabBodies={tabBodies ?? {}}
      run={run}
      onClearRun={onClearRun}
      paneOpen={paneOpen}
      onTogglePane={onTogglePane}
      initialZoom={initialZoom}
      initialSelected={initialSelected}
      initialPanel={initialPanel}
      data={data}
    />
  );
}

function Frame({ children }: { children: ReactNode }): ReactElement {
  return <View testID="canvas-frame" style={s.frame}>{children}</View>;
}

function CanvasBody({ a, tab, setTab, failedRuns, versions, tabBodies, run, onClearRun, paneOpen, onTogglePane, initialZoom, initialSelected, initialPanel, data }: {
  a: GetOut["automation"];
  tab: CanvasTab;
  setTab(t: CanvasTab): void;
  failedRuns: number;
  versions: VersionsOut["versions"];
  tabBodies: Partial<Record<Exclude<CanvasTab, "steps">, ReactNode>>;
  run: CanvasProps["run"];
  onClearRun: CanvasProps["onClearRun"];
  paneOpen: boolean;
  onTogglePane: CanvasProps["onTogglePane"];
  initialZoom: number;
  initialSelected: string | null;
  initialPanel: boolean;
  data: ReturnType<typeof useAutomationsData>;
}): ReactElement {
  const { element, show } = useMenu();
  const [draft, setDraft] = useState<Definition | null>(null);
  const undo = useRef<Definition[]>([]);
  const def: Definition = draft ?? a.definition;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(a.definition);
  const [sel, setSel] = useState<{ id: string; trigger: number | null } | null>(initialSelected ? { id: initialSelected, trigger: null } : null);
  const [panel, setPanel] = useState(initialPanel);
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState(initialZoom);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [graphView, setGraphView] = useState({ w: 0, h: 0 });
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [litRun, setLitRun] = useState<{ id: string; label: string; states: Readonly<Record<string, RunState>> } | null>(null);
  const shownRun = run ?? litRun;

  // the server checks against the live catalogue (connections, keys); the local check answers at once and the two lists merge
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void data.call("automations.validate", { definition: def, kind: a.kind })
        .then((out) => { if (live) setServerIssues((out as { issues?: Issue[] }).issues ?? []); })
        .catch(() => { if (live) setServerIssues([]); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [def, a.kind, data]);
  const issues = useMemo(() => sortedIssues([...check(def, a.kind), ...serverIssues]), [def, a.kind, serverIssues]);
  const lay = useMemo(() => layout(def, { issues, ...(shownRun ? { run: shownRun.states } : {}), keyName: (id) => data.keys.find((k) => k.id === id)?.name ?? data.name(id) }), [def, issues, shownRun, data]);
  const errors = issues.filter((i) => i.severity === "error");
  const agentOf = (n: CardNode): string | undefined => (n.node?.ai?.agentId ? data.name(n.node.ai.agentId) : n.node?.ai ? "Assistant" : undefined);

  const edit = useCallback((next: Definition): void => {
    undo.current.push(def);
    setDraft(next);
  }, [def]);
  const undoEdit = useCallback((): void => {
    const prev = undo.current.pop();
    if (prev) setDraft(JSON.stringify(prev) === JSON.stringify(a.definition) ? null : prev);
  }, [a.definition]);

  const flash = (text: string): void => { setNote(text); };
  const save = useCallback(async (): Promise<void> => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await data.call("automations.update", { automationId: a.id, definition: draft, expectedVersion: a.version });
      setDraft(null);
      undo.current = [];
      flash(`Saved as version ${a.version + 1}`);
    } catch (e) { flash(e instanceof Error ? e.message : "That did not save. Your edits are still here."); }
    setSaving(false);
  }, [draft, saving, data, a.id, a.version]);

  const selected = sel ? (sel.id === "trigger" ? null : def.nodes.find((n) => n.id === sel.id) ?? null) : null;
  const select = (id: string | null, trigger: number | null = null): void => { setSel(id === null ? null : { id, trigger }); if (id === null) setPanel(false); };
  const openPanel = (id: string, trigger: number | null = null): void => { setSel({ id, trigger }); setPanel(true); };

  // ---- menus
  const addEntries = (onPick: (key: string) => void): MenuEntry[] => {
    const out: MenuEntry[] = [];
    for (const g of palette()) {
      out.push({ head: g.head });
      for (const p of g.items) out.push({ label: p.title, onSelect: () => onPick(p.key) });
    }
    return out;
  };
  const rect = (e: unknown): { x: number; y: number } => {
    const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
    const r = ev.currentTarget?.getBoundingClientRect?.();
    return { x: r?.left ?? ev.nativeEvent?.pageX ?? 0, y: (r?.bottom ?? ev.nativeEvent?.pageY ?? 0) + 4 };
  };
  const at = (x: number, y: number, el: string | null): { x: number; y: number } => {
    if (x >= 0 && y >= 0) return { x, y };
    const dom = (globalThis as { document?: { querySelector(s: string): { getBoundingClientRect(): { left: number; bottom: number } } | null } }).document?.querySelector(`[data-card="${el ?? ""}"]`);
    const r = dom?.getBoundingClientRect();
    return { x: r?.left ?? 320, y: (r?.bottom ?? 220) + 4 };
  };
  const openAdd = (afterId: string | null, x: number, y: number): void => {
    const p = at(x, y, afterId);
    const host = afterId ? def.nodes.find((n) => n.id === afterId) : undefined;
    const lanes = host && (kindOfKey(host.key) === "paths" || kindOfKey(host.key) === "parallel" || host.key === "loop") ? host.branches ?? [] : [];
    if (host && lanes.length > 0) {
      // a step with lanes: say which lane the new step starts
      const choose: MenuEntry[] = [{ head: "Add to which lane?" }];
      lanes.forEach((b, i) => choose.push({ label: b.label || `Lane ${i + 1}`, onSelect: () => show(addEntries((key) => { const r = addInto(def, host.id, key, i); edit(r.def); openPanel(r.id); }), p.x, p.y, "other") }));
      show(choose, p.x, p.y, "other");
      return;
    }
    show(addEntries((key) => {
      const r = addAfter(def, afterId, key);
      edit(r.def);
      openPanel(r.id);
    }), p.x, p.y, "other");
  };
  const openCardMenu = (id: string, x: number, y: number): void => {
    const p = at(x, y, id);
    const n = def.nodes.find((k) => k.id === id);
    if (!n) return;
    show([
      { label: "Edit this step", onSelect: () => openPanel(id) },
      { label: "Add a step after", onSelect: () => openAdd(id, p.x, p.y) },
      { label: "Duplicate", onSelect: () => { const r = duplicateStep(def, id); edit(r.def); openPanel(r.id); } },
      { separator: true },
      { label: "Move up", onSelect: () => edit(moveStep(def, id, -1)) },
      { label: "Move down", onSelect: () => edit(moveStep(def, id, 1)) },
      { separator: true },
      { label: "Delete", danger: true, onSelect: () => { edit(removeStep(def, id)); select(null); } },
    ], p.x, p.y, "context");
  };
  const openTriggerAdd = (x: number, y: number): void => {
    const p = at(x, y, "trigger");
    const used = new Set<string>();
    for (const t of def.triggers) used.add(t.key);
    const entries: MenuEntry[] = [];
    for (const t of TRIGGER_PALETTE) entries.push({ label: t.title, checked: used.has(t.key), onSelect: () => { edit(addTrigger(def, t.key)); openPanel("trigger", def.triggers.length); } });
    show(entries, p.x, p.y, "other");
  };
  const openTriggerMenu = (index: number, x: number, y: number): void => {
    const p = at(x, y, "trigger");
    show([
      { label: "Edit this trigger", onSelect: () => openPanel("trigger", index) },
      { label: "Add another trigger", onSelect: () => openTriggerAdd(p.x, p.y) },
      { separator: true },
      { label: "Remove", danger: true, onSelect: () => { edit(removeTrigger(def, index)); select(null); } },
    ], p.x, p.y, "context");
  };
  const describe = (t: DefTrigger): string => describeTrigger(t);

  // ---- keys
  const onKey = (e: KeyEventLike, id: string): void => {
    const k = e.key ?? "";
    const mod = e.metaKey === true || e.ctrlKey === true;
    if (mod && k.toLowerCase() === "z") { e.preventDefault?.(); undoEdit(); return; }
    if (mod && k.toLowerCase() === "s") { e.preventDefault?.(); void save(); return; }
    const dir = k === "ArrowDown" ? "down" : k === "ArrowUp" ? "up" : k === "ArrowLeft" ? "left" : k === "ArrowRight" ? "right" : null;
    if (dir) {
      e.preventDefault?.();
      const to = neighbour(lay, id, dir);
      if (to) { select(to, to === "trigger" ? null : null); focusCard(to); }
      return;
    }
    if (k === "Enter") { e.preventDefault?.(); openPanel(id); return; }
    if (k === "Escape") { select(null); return; }
    if ((k === "Delete" || k === "Backspace") && id !== "trigger") { e.preventDefault?.(); edit(removeStep(def, id)); select(null); return; }
    if (k === "+" || (k === "=" && !mod)) { e.preventDefault?.(); openAdd(id === "trigger" ? null : id, -1, -1); return; }
    if (mod && (k === "=" || k === "+")) { e.preventDefault?.(); setZoom((z) => clampZoom(z + 0.1)); return; }
    if (mod && k === "-") { e.preventDefault?.(); setZoom((z) => clampZoom(z - 0.1)); return; }
    if (k === "0" && mod) { e.preventDefault?.(); setZoom(1); }
  };
  const handlers: CardHandlers = { onSelect: (id) => select(id), onOpen: (id) => openPanel(id), onMenu: openCardMenu, onAdd: (id, x, y) => openAdd(id, x, y), onKey };

  // ---- header actions
  const needs = issues.find((i) => /^needs the .+ (key|connection)$/i.test(i.message))?.message ?? a.pausedReason ?? null;
  const service = needs ? /^needs the (.+?)( key| connection)?$/i.exec(needs)?.[1] ?? null : null;
  const statusLabel = a.status === "on" ? "On" : a.status === "paused" ? "Paused" : a.status === "draft" ? "Draft" : "Off";
  const test = async (): Promise<void> => {
    if (errors.length > 0) { flash(`Fix ${errors.length === 1 ? "the problem" : `the ${errors.length} problems`} first, then test.`); setTab("steps"); return; }
    try { await data.call("automations.test", { automationId: a.id, sample: true }); flash("Test run started with sample data"); }
    catch (e) { flash(e instanceof Error ? e.message : "The test did not start."); }
  };
  const setEnabled = async (enabled: boolean): Promise<void> => {
    if (enabled && errors.length > 0) { flash(`Fix ${errors.length === 1 ? "the problem" : `the ${errors.length} problems`} before turning this on.`); return; }
    try { await data.call("automations.set_enabled", { automationId: a.id, enabled }); } catch (e) { flash(e instanceof Error ? e.message : "That did not change."); }
  };
  const rename = async (name: string): Promise<void> => {
    setRenaming(null);
    if (!name.trim() || name === a.name) return;
    try { await data.call("automations.update", { automationId: a.id, name }); } catch (e) { flash(e instanceof Error ? e.message : "That did not rename."); }
  };
  const openMore = (e: unknown): void => {
    const p = rect(e);
    show([
      ...(a.kind === "space" ? [{ label: "Make a personal copy", onSelect: () => void data.call("automations.make_personal_copy", { automationId: a.id, name: `${a.name} (mine)` }).then(() => flash("A personal copy is in your Automations")).catch((x: unknown) => flash(x instanceof Error ? x.message : "No copy was made")) }] : [{ label: "Promote to the Space", onSelect: () => flash("Promote opens its own sheet") }]),
      { label: "Undo last edit", onSelect: undoEdit },
      { separator: true },
      { label: "Move to Trash", danger: true, onSelect: () => void data.call("automations.delete", { automationId: a.id }).catch((x: unknown) => flash(x instanceof Error ? x.message : "That did not move")) },
    ], p.x - 160, p.y, "context");
  };
  const openStatus = (e: unknown): void => {
    const p = rect(e);
    show([
      { label: "On", checked: a.status === "on", onSelect: () => void setEnabled(true) },
      { label: "Off", checked: a.status === "off" || a.status === "draft", onSelect: () => void setEnabled(false) },
    ], p.x, p.y, "other");
  };

  // fit once the surface has a size
  const fitted = useRef(false);
  const onSurface = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    setView({ w: width, h: height });
    if (!fitted.current && initialZoom === DEFAULT_ZOOM) fitted.current = true;
  };
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 4500);
    return () => clearTimeout(t);
  }, [note]);

  const tabs: SubTab[] = [
    { key: "steps", label: "Steps" },
    { key: "runs", label: "Runs", ...(failedRuns > 0 ? { note: `${failedRuns} failed`, tone: "danger" as const } : {}) },
    { key: "versions", label: "Versions", note: `v${a.version}` },
    { key: "settings", label: "Settings" },
  ];
  const trigSel = sel?.id === "trigger";
  const stepCards: ReactElement[] = [];
  const addDots: ReactElement[] = [];
  for (const card of lay.cards) {
    if (card.type !== "step") continue;
    stepCards.push(<StepCard key={card.id} card={card} selected={sel?.id === card.id} hovered={hover === card.id} handlers={handlers} agent={agentOf(card)} onHover={setHover} />);
    if ((hover === card.id || sel?.id === card.id) && !(card.node && kindOfKey(card.node.key) === "stop")) {
      addDots.push(<AddDot key={`add-${card.id}`} x={card.x + card.w / 2} y={card.y + card.h + 6} label={`Add a step after ${card.title}`} onPress={(px, py) => openAdd(card.id, px, py)} />);
    }
  }
  const inspect = panel && sel !== null && (selected !== null || trigSel);
  // Runs tab: the step graph sits beside the run list, read only, at the size that fits its column, lit by the run being shown
  const still: CardHandlers = { onSelect: () => undefined, onOpen: () => undefined, onMenu: () => undefined, onAdd: () => undefined, onKey: () => undefined };
  const graphCards: ReactElement[] = [];
  for (const card of lay.cards) if (card.type === "step") graphCards.push(<StepCard key={card.id} card={card} selected={false} hovered={false} handlers={still} agent={agentOf(card)} onHover={() => undefined} />);
  const runGraph = tab === "runs" && tabBodies.runs ? (
    <View style={s.graphCol} testID="run-graph" accessibilityLabel="Steps of the run" onLayout={(e: LayoutChangeEvent) => setGraphView({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View pointerEvents="none" style={{ flex: 1 }}>
        <Surface lay={lay} zoom={graphView.w > 0 ? fitScale(lay, graphView.w, graphView.h) : 0.4} view={graphView}>
          <TriggerCard card={lay.cards[0]!} triggers={def.triggers} selected={false} hovered={false} onHover={() => undefined} handlers={still} selectedIndex={null} onSelectTrigger={() => undefined} onOpenTrigger={() => undefined} onAddTrigger={() => undefined} onTriggerMenu={() => undefined} describe={describe} />
          {graphCards}
        </Surface>
      </View>
    </View>
  ) : null;

  return (
    <View testID="canvas-frame" style={s.frame}>
      <View style={s.head}>
        <View style={[s.tile, { backgroundColor: "var(--accent-wash)" as string }]}><Glyph name="bolt" size={16} color="var(--accent)" /></View>
        <View style={s.titleBox}>
          {renaming !== null ? (
            <TextInput
              accessibilityLabel="Name" testID="rename" autoFocus value={renaming} onChangeText={setRenaming} onBlur={() => void rename(renaming)} onSubmitEditing={() => void rename(renaming)}
              {...webOnly({ onKeyDown: (e: { key?: string }) => { if (e.key === "Escape") setRenaming(null); } })} style={s.titleInput}
            />
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={`${a.name}. Rename`} testID="title" onPress={() => setRenaming(a.name)} style={pointer}>
              <Text accessibilityRole="header" aria-level={1} numberOfLines={1} style={s.title}>{a.name}</Text>
            </Pressable>
          )}
        </View>
        <View style={s.kind} testID="kind"><Glyph name={a.kind === "space" ? "users" : "key"} size={13} color="var(--ink-3)" /><Text style={s.kindText}>{a.kind === "space" ? "Space" : "Personal"}</Text></View>
        {needs ? (<><View style={s.sep} /><View style={s.needs}><Dot tone="warn" size={6} /><Text numberOfLines={1} style={s.needsText}>{needs.replace(/^needs/i, "Needs")}</Text></View></>) : null}
        <View style={{ flex: 1 }} />
        {service ? <TextButton label={`Connect ${service}`} icon="key" testID="connect" onPress={() => data.nav.connect(service)} /> : null}
        {dirty ? <TextButton label={saving ? "Saving" : "Save"} primary disabled={saving || errors.length > 0} testID="save" onPress={() => void save()} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`Status: ${statusLabel}`} testID="status" onPress={openStatus} style={[s.status, pointer]}>
          <Dot tone={a.status === "on" ? "ok" : a.status === "paused" ? "warn" : "muted"} />
          <Text style={s.statusText}>{statusLabel}</Text>
          <Glyph name="chevD" size={11} color="var(--ink-3)" />
        </Pressable>
        <TextButton label="Test run" icon="flask" testID="test-run" onPress={() => void test()} />
        <TextButton label="Ask" icon="sparkle" testID="ask" onPress={() => data.nav.ask(a.id)} />
        <IconButton icon="panel" label={paneOpen ? "Hide the side pane" : "Show the side pane"} on={paneOpen} testID="toggle-pane" onPress={onTogglePane} />
        <IconButton icon="more" label="More" testID="more" onPress={openMore} />
      </View>
      <SubTabs tabs={tabs} active={tab} onSelect={(k) => setTab(k as CanvasTab)} label="Automation" />
      {tab === "steps" ? (
        <>
          {errors.length > 0 ? (
            <View style={s.problems} testID="problems" accessibilityRole="alert">
              <Glyph name="warn" size={13} color="var(--danger)" />
              <Text style={s.problemsText} numberOfLines={1}>{`${errors.length} ${errors.length === 1 ? "thing" : "things"} to fix before this can run`}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Show the first problem" testID="problem-go" onPress={() => { const i = errors[0]; if (i) { const id = i.nodeId ?? "trigger"; select(id); focusCard(id); } }} style={pointer}>
                <Text style={s.problemsLink}>{errors[0]?.message ?? ""}</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={s.body}>
            <View style={s.surfaceWrap} onLayout={onSurface}>
              <Surface lay={lay} zoom={zoom} view={view}>
                <TriggerCard
                  card={lay.cards[0]!} triggers={def.triggers} selected={trigSel} hovered={hover === "trigger"} onHover={setHover} handlers={handlers}
                  selectedIndex={trigSel ? sel?.trigger ?? null : null} onSelectTrigger={(i) => select("trigger", i)} onOpenTrigger={(i) => openPanel("trigger", i)} onAddTrigger={openTriggerAdd} onTriggerMenu={openTriggerMenu} describe={describe}
                />
                {stepCards}
                {addDots}
                {def.nodes.length === 0 ? <AddDot x={lay.cards[0]!.x + lay.cards[0]!.w / 2} y={lay.cards[0]!.y + lay.cards[0]!.h + 6} label="Add the first step" onPress={(px, py) => openAdd(null, px, py)} /> : null}
              </Surface>
              <View style={s.zoom} testID="zoom">
                <IconButton icon="x" label="Zoom out" testID="zoom-out" onPress={() => setZoom((z) => clampZoom(z - 0.1))} />
                <Text style={s.zoomText} testID="zoom-level">{`${Math.round(zoom * 100)}%`}</Text>
                <IconButton icon="plus" label="Zoom in" testID="zoom-in" onPress={() => setZoom((z) => clampZoom(z + 0.1))} />
                <Pressable accessibilityRole="button" accessibilityLabel="Fit to the window" testID="zoom-fit" onPress={() => setZoom(fitScale(lay, view.w, view.h))} style={[s.fit, pointer]}>
                  <Glyph name="fit" size={13} color="var(--ink-2)" /><Text style={s.fitText}>Fit</Text>
                </Pressable>
              </View>
              {shownRun ? (
                <View style={s.runChip} testID="run-chip">
                  <Text style={s.runChipText} numberOfLines={1}>{`Showing ${shownRun.label}`}</Text>
                  <IconButton icon="x" label="Stop showing this run" size={20} onPress={() => { setLitRun(null); onClearRun?.(); }} />
                </View>
              ) : null}
              {note ? <View style={s.toast} accessibilityLiveRegion="polite" testID="note"><Text style={s.toastText}>{note}</Text></View> : null}
            </View>
            {inspect ? (
              <Inspector
                def={def} node={selected} trigger={trigSel && sel?.trigger !== null && sel?.trigger !== undefined ? def.triggers[sel.trigger] ?? null : null} triggerIndex={trigSel ? sel?.trigger ?? null : null}
                issues={issues} keys={data.keys} onChange={edit} onClose={() => select(null)} onDelete={() => { if (sel && sel.id !== "trigger") { edit(removeStep(def, sel.id)); select(null); } }}
              />
            ) : null}
          </View>
        </>
      ) : null}
      {tab === "runs" ? (
        tabBodies.runs ? (
          <View style={s.runsBody}><View style={{ flex: 1, minWidth: 0 }}>{tabBodies.runs}</View>{runGraph}</View>
        ) : <View style={s.pageBody}><RunsList automationId={a.id} onLight={(r) => { setLitRun(r); setTab("steps"); }} /></View>
      ) : null}
      {tab === "versions" ? <View style={s.pageBody}>{tabBodies.versions ?? <VersionsList versions={versions} current={a.version} onRestore={(id) => void data.call("automations.restore_version", { automationId: a.id, versionId: id }).then(() => flash("Restored as a new version")).catch((x: unknown) => flash(x instanceof Error ? x.message : "That did not restore"))} />}</View> : null}
      {tab === "settings" ? <View style={s.pageBody}>{tabBodies.settings ?? <Text style={s.dim}>Settings, Alerts and Runs open here.</Text>}</View> : null}
      {element}
    </View>
  );
}

const focusCard = (id: string): void => {
  const doc = (globalThis as { document?: { querySelector(s: string): { focus?: () => void } | null } }).document;
  setTimeout(() => doc?.querySelector(`[data-card="${id}"]`)?.focus?.(), 0);
};

/** The dotted surface: the cards and connectors at their size, scaled by the zoom, centred when smaller than the window and scrolling when larger. */
function Surface({ lay, zoom, view, children }: { lay: ReturnType<typeof layout>; zoom: number; view: { w: number; h: number }; children: ReactNode }): ReactElement {
  const w = lay.width * zoom;
  const h = lay.height * zoom;
  const parts: ReactElement[] = [];
  lay.frames.forEach((f, n) => parts.push(<View key={`f${n}`} pointerEvents="none" style={{ position: "absolute", left: f.x, top: f.y, width: f.w, height: f.h, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "var(--line-2)" as string }} />));
  lay.segs.forEach((g, n) => {
    const colour = (g.lit ? "var(--ok)" : "var(--line-2)") as string;
    parts.push(
      <View
        key={`s${n}`} pointerEvents="none"
        style={g.x1 === g.x2 ? { position: "absolute", left: g.x1, top: Math.min(g.y1, g.y2), width: 1, height: Math.abs(g.y2 - g.y1), backgroundColor: colour } : { position: "absolute", left: Math.min(g.x1, g.x2), top: g.y1, width: Math.abs(g.x2 - g.x1), height: 1, backgroundColor: colour }}
      />,
    );
  });
  lay.chips.forEach((c2, n) => parts.push(
    <View key={`c${n}`} pointerEvents="none" style={{ position: "absolute", left: c2.x - 130, top: c2.y, width: 260, alignItems: "center" }}>
      <View style={[s.chip, c2.lit && { borderColor: "var(--ok)" as string }]}><Text numberOfLines={1} style={[s.chipText, c2.mono && s.mono]}>{c2.text}</Text></View>
    </View>,
  ));
  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ minHeight: Math.max(h + 80, view.h) }} testID="surface" accessibilityLabel="Automation steps">
      <ScrollView horizontal contentContainerStyle={{ minWidth: Math.max(w + 40, view.w), justifyContent: "center", paddingTop: 28 }} showsHorizontalScrollIndicator={false}>
        <View style={{ width: w, height: h }}>
          <View style={{ position: "absolute", left: 0, top: 0, width: lay.width, height: lay.height, transform: [{ scale: zoom }], ...(webTransformOrigin) }}>
            {parts}
            {children}
          </View>
        </View>
      </ScrollView>
    </ScrollView>
  );
}
const webTransformOrigin = { transformOrigin: "0 0" } as unknown as Record<string, never>;

function RunsList({ automationId, onLight }: { automationId: string; onLight(r: { id: string; label: string; states: Record<string, RunState> }): void }): ReactElement {
  const q = useScreenQuery<RunsOut>(CONFIG, "runs", { subject: { type: "automation", id: automationId }, scope: "subject" });
  const data = useAutomationsData();
  if (q.status !== "ready") return <Text style={s.dim}>Loading</Text>;
  if (q.data.runs.length === 0) return <Text style={s.dim}>No runs yet. Test run sends sample data through it.</Text>;
  return (
    <View testID="runs-list">
      {q.data.runs.map((r) => (
        <Row
          key={r.id} id={`run-${r.id}`} title={r.summary ?? r.name ?? "Run"} note={`${r.status === "failed" ? "Failed" : r.status === "succeeded" ? "Done" : r.status === "waiting" ? "Waiting" : "Running"} · ${new Date(r.startedAt).toISOString().slice(0, 10)}${r.definitionVersion ? ` · v${r.definitionVersion}` : ""}`}
          leading={<Dot tone={r.status === "failed" ? "danger" : r.status === "succeeded" ? "ok" : "warn"} />}
          onPress={() => onLight({ id: r.id, label: `${r.summary ?? "run"}`, states: {} })}
        />
      ))}
      <View style={{ height: 8 }} />
      <TextButton label="Open run history" onPress={() => data.nav.openRun(q.data.runs[0]!.id)} />
    </View>
  );
}

function VersionsList({ versions, current, onRestore }: { versions: VersionsOut["versions"]; current: number; onRestore(versionId: string): void }): ReactElement {
  const data = useAutomationsData();
  if (versions.length === 0) return <Text style={s.dim}>This is the first version.</Text>;
  return (
    <View testID="versions-list">
      {versions.map((v) => (
        <Row
          key={v.versionId} id={`ver-${v.n}`} title={`Version ${v.n}${v.n === current ? ", running" : ""}`} note={`${data.name(v.by)}${v.reason ? `, ${v.reason}` : ""}`}
          trailing={v.n === current ? undefined : <TextButton label="Restore" onPress={() => onRestore(v.versionId)} />}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { flex: 1, backgroundColor: "var(--win)" as string, minWidth: 0 },
  head: { minHeight: 64, flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 4, columnGap: 10, paddingHorizontal: 20, paddingVertical: 8 },
  tile: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  titleBox: { flexShrink: 1, minWidth: 140 },
  title: { fontSize: 15.5, lineHeight: 22, fontWeight: "600", color: "var(--ink)" as string },
  titleInput: { fontSize: 15.5, fontWeight: "600", height: 30, minWidth: 200, color: "var(--ink)" as string, borderRadius: 7, borderWidth: 1, borderColor: "var(--accent)" as string, paddingHorizontal: 8 },
  kind: { flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 2 },
  kindText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  sep: { width: 1, height: 16, backgroundColor: "var(--line)" as string },
  needs: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
  needsText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  status: { height: 28, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 9, borderRadius: 7 },
  statusText: { fontSize: 13, color: "var(--ink)" as string },
  problems: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, height: 34, backgroundColor: "var(--hover)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  problemsText: { fontSize: 12.5, color: "var(--ink)" as string },
  problemsLink: { fontSize: 12.5, color: "var(--accent)" as string },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  surfaceWrap: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string, ...({ backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: "22px 22px" } as object) },
  scroll: { flex: 1 },
  zoom: { position: "absolute", left: 14, bottom: 14, height: 34, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, borderRadius: 10, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  zoomText: { fontSize: 12.5, color: "var(--ink-2)" as string, minWidth: 38, textAlign: "center" },
  fit: { height: 26, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, borderRadius: 7 },
  fitText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  runChip: { position: "absolute", left: 14, top: 12, height: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 4, borderRadius: 10, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  runChipText: { fontSize: 12.5, color: "var(--ink)" as string, maxWidth: 260 },
  toast: { position: "absolute", alignSelf: "center", bottom: 18, left: 120, right: 120, alignItems: "center" },
  toastText: { fontSize: 12.5, color: "var(--ink)" as string, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7, overflow: "hidden" },
  chip: { height: 22, maxWidth: 240, paddingHorizontal: 9, borderRadius: 7, justifyContent: "center", backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  chipText: { fontSize: 11.5, color: "var(--ink-2)" as string },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 },
  pageBody: { flex: 1, padding: 20 },
  runsBody: { flex: 1, flexDirection: "row", minHeight: 0 },
  graphCol: { width: 250, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--win)" as string, ...({ backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: "22px 22px" } as object) },
  dim: { fontSize: 13, color: "var(--ink-3)" as string },
});
