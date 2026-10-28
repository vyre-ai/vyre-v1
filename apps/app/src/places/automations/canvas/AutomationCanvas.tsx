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
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import type { PaneTab } from "../../../../../../ui/src/SidePane/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { AskVyre } from "../ask/AskVyre.tsx";
import type { AskBundle } from "../ask/bundle.ts";
import { loadProductCatalog, menuGroups } from "../catalog/model.ts";
import type { CatalogStep, CatalogTrigger } from "../catalog/model.ts";
import { setupFromIssue } from "../connect/route.ts";
import type { ConnectTarget } from "../connect/route.ts";
import { AutomationConfig } from "../config/AutomationConfig.tsx";
import { Overlay } from "../config/Overlay.tsx";
import { PromoteSheet } from "../config/PromoteSheet.tsx";
import { BUILDER_MODES, DATA_SHELF_NAME, definitionCrumb, enrollmentsPinned } from "../chrome.ts";
import type { BuilderMode } from "../chrome.ts";
import { AnalyticsPanel, LiveEvents } from "../operations/StudioViews.tsx";
import { statesFromSteps, stepsFromCall } from "../runs/ledger.ts";
import type { StepRowLite } from "../runs/ledger.ts";
import { attemptLine, childRunLine, containerForChildren } from "../runs/lineage.ts";
import { definitionLabel } from "../versions/cohorts.ts";
import { CohortMigration } from "../versions/CohortMigration.tsx";
import { AddDot, StepCard, TriggerCard } from "./Cards.tsx";
import type { CardHandlers } from "./Cards.tsx";
import { layoutForWidth } from "./frame.ts";
import { Inspector } from "./Inspector.tsx";
import { Glyph } from "./icons.tsx";
import { CANVAS, CONFIG, useAutomationsData, useScreenQuery } from "./data.tsx";
import {
  addAfter, addInto, addTrigger, check, clampZoom, describeTrigger, duplicateStep, fitScale, kindOfKey, layout, liveBlockerStep, moveStep, neighbour, removeStep, removeTrigger, sortedIssues, titleOfKey,
} from "./model.ts";
import type { CardNode, DefTrigger, Definition, Issue, RunState } from "./model.ts";
import { Dot, IconButton, SubTabs, TextButton, pointer, webOnly } from "./parts.tsx";
import type { KeyEventLike, SubTab } from "./parts.tsx";

type GetOut = CapMap["automations.get"]["out"];
type VersionsOut = CapMap["automations.versions"]["out"];
type RunsOut = CapMap["runs.list"]["out"];

export type CanvasTab = "steps" | "runs" | "versions" | "settings" | "analytics";

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
  /** Start with the Promote sheet open (the canvas menu opens the same sheet). */
  initialPromote?: boolean;
}

const DEFAULT_ZOOM = 0.84;

export function AutomationCanvas({ automationId, tabBodies, initialTab = "steps", run = null, onClearRun, paneOpen = false, onTogglePane, initialZoom = DEFAULT_ZOOM, initialSelected = null, initialPanel = false, initialPromote = false }: CanvasProps): ReactElement {
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
      initialPromote={initialPromote}
      data={data}
    />
  );
}

function Frame({ children }: { children: ReactNode }): ReactElement {
  return <View testID="canvas-frame" style={s.frame}>{children}</View>;
}

type CatalogPhase = { phase: "loading" } | { phase: "ready"; steps: CatalogStep[]; triggers: CatalogTrigger[] } | { phase: "unavailable"; message: string };

function CanvasBody({ a, tab, setTab, failedRuns, versions, tabBodies, run, onClearRun, paneOpen, onTogglePane, initialZoom, initialSelected, initialPanel, initialPromote, data }: {
  a: GetOut["automation"];
  tab: CanvasTab;
  setTab(t: CanvasTab): void;
  failedRuns: number;
  versions: VersionsOut["versions"];
  tabBodies: NonNullable<CanvasProps["tabBodies"]>;
  run: CanvasProps["run"];
  onClearRun: CanvasProps["onClearRun"];
  paneOpen: boolean;
  onTogglePane: CanvasProps["onTogglePane"];
  initialZoom: number;
  initialSelected: string | null;
  initialPanel: boolean;
  initialPromote: boolean;
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
  const [promoteOpen, setPromoteOpen] = useState(initialPromote);
  const [catalog, setCatalog] = useState<CatalogPhase>({ phase: "loading" });
  const [samples, setSamples] = useState<Record<string, unknown>>({});
  const [stepTabs, setStepTabs] = useState<PaneTab[]>(initialPanel && initialSelected ? [{ key: initialSelected, title: initialSelected }] : []);
  const [activeStep, setActiveStep] = useState<string | null>(initialPanel ? initialSelected : null);
  const [sections, setSections] = useState<Record<string, "configure" | "data" | "test">>({});
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [litRun, setLitRun] = useState<{ id: string; label: string; states: Readonly<Record<string, RunState>> } | null>(null);
  const [mode, setMode] = useState<BuilderMode>("basic");
  const [eventsOpen, setEventsOpen] = useState(false);
  const [bodyW, setBodyW] = useState(0);
  const shownRun = run ?? litRun;
  const activeRuns = useScreenQuery<RunsOut>(CONFIG, "runs", { subject: { type: "automation", id: a.id }, statuses: ["queued", "running", "waiting"], scope: "subject" });
  const pinned = enrollmentsPinned(activeRuns.status === "ready" ? activeRuns.data.runs : undefined, activeRuns.status === "ready");
  const studioLayout = layoutForWidth(bodyW);

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
  useEffect(() => {
    let live = true;
    void loadProductCatalog((cap, input) => data.call(cap, input)).then((res) => {
      if (!live) return;
      setCatalog(res.ok ? { phase: "ready", steps: res.catalog.steps, triggers: res.catalog.triggers } : { phase: "unavailable", message: res.message });
    });
    return () => { live = false; };
  }, [data]);
  const issues = useMemo(() => sortedIssues([...check(def, a.kind), ...serverIssues]), [def, a.kind, serverIssues]);
  const tested = useMemo(() => new Set(Object.keys(samples)), [samples]);
  const lay = useMemo(() => layout(def, { issues, tested, ...(shownRun ? { run: shownRun.states } : {}), keyName: (id) => data.keys.find((k) => k.id === id)?.name ?? data.name(id) }), [def, issues, shownRun, data, tested]);
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
  const tabKey = (id: string, trigger: number | null): string => (id === "trigger" ? `trigger:${trigger ?? 0}` : id);
  const openPanel = (id: string, trigger: number | null = null): void => {
    setSel({ id, trigger });
    setPanel(true);
    const key = tabKey(id, trigger);
    const title = id === "trigger" ? "Trigger" : (def.nodes.find((n) => n.id === id)?.title ?? titleOfKey(def.nodes.find((n) => n.id === id)?.key ?? id));
    setStepTabs((cur) => cur.some((t) => t.key === key) ? cur : [...cur, { key, title }]);
    setActiveStep(key);
  };
  const focusStepTab = (key: string): void => {
    setActiveStep(key);
    if (key.startsWith("trigger:")) setSel({ id: "trigger", trigger: Number(key.slice(8)) });
    else setSel({ id: key, trigger: null });
    setPanel(true);
  };

  // ---- menus. The product catalog is the runtime list. A failed load stays unavailable.
  const addEntries = (onPick: (key: string) => void): MenuEntry[] => {
    if (catalog.phase === "loading") return [{ label: "Loading the step catalog", onSelect: () => undefined }];
    if (catalog.phase === "unavailable") return [{ label: catalog.message, onSelect: () => undefined }];
    const out: MenuEntry[] = [];
    for (const g of menuGroups(catalog.steps)) {
      out.push({ head: g.head });
      for (const p of g.items) out.push({ label: p.availability === "preview" ? `${p.title} (Preview)` : p.title, onSelect: () => onPick(p.key) });
    }
    if (out.length === 0) return [{ label: "The step catalog is empty", onSelect: () => undefined }];
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
    const triggers = catalog.phase === "ready" ? catalog.triggers : [];
    if (catalog.phase === "loading") entries.push({ label: "Loading the trigger catalog", onSelect: () => undefined });
    else if (catalog.phase === "unavailable") entries.push({ label: catalog.message, onSelect: () => undefined });
    else if (triggers.length === 0) entries.push({ label: "The trigger catalog is empty", onSelect: () => undefined });
    for (const t of triggers) entries.push({ label: t.availability === "preview" ? `${t.title} (Preview)` : t.title, checked: used.has(t.key), onSelect: () => { edit(addTrigger(def, t.key)); openPanel("trigger", def.triggers.length); } });
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
  const connectTarget: ConnectTarget | null = issues.map((issue) => setupFromIssue(issue)).find((setup) => setup.connect)?.connect ?? null;
  const blockedIssue = !connectTarget ? issues.map((issue) => ({ issue, setup: setupFromIssue(issue) })).find((row) => row.issue.message === a.pausedReason && row.setup.blocked) : undefined;
  const needs = a.pausedReason ?? null;
  const statusLabel = a.status === "on" ? "On" : a.status === "paused" ? "Paused" : a.status === "draft" ? "Draft" : "Off";
  const test = async (): Promise<void> => {
    if (errors.length > 0) { flash(`Fix ${errors.length === 1 ? "the problem" : `the ${errors.length} problems`} first, then test.`); setTab("steps"); return; }
    try { await data.call("automations.test", { automationId: a.id, sample: true }); flash("Test run started with sample data"); }
    catch (e) { flash(e instanceof Error ? e.message : "The test did not start."); }
  };
  const blockerId = liveBlockerStep(errors);
  const goToBlocker = (): void => {
    if (!blockerId) return;
    if (blockerId === "trigger") openPanel("trigger", 0);
    else openPanel(blockerId);
    focusCard(blockerId);
  };
  const setEnabled = async (enabled: boolean): Promise<void> => {
    if (enabled && errors.length > 0) {
      goToBlocker();
      flash(`Fix ${errors.length === 1 ? "the problem" : `the ${errors.length} problems`} before turning this on.`);
      return;
    }
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
      ...(a.kind === "space" ? [{ label: "Make a personal copy", onSelect: () => void data.call("automations.make_personal_copy", { automationId: a.id, name: `${a.name} (mine)` }).then(() => flash("A personal copy is in your Automations")).catch((x: unknown) => flash(x instanceof Error ? x.message : "No copy was made")) }] : [{ label: "Promote to the Space", onSelect: () => setPromoteOpen(true) }]),
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
    { key: "steps", label: "Build" },
    { key: "runs", label: "Runs", ...(failedRuns > 0 ? { note: `${failedRuns} failed`, tone: "danger" as const } : {}) },
    { key: "analytics", label: "Analytics" },
    { key: "versions", label: "Versions", note: `v${a.version}` },
    { key: "settings", label: "Settings" },
  ];
  const askBundle = (issue: { nodeId?: string; message: string }): AskBundle => ({ resource: a.id, message: issue.message, ...(issue.nodeId ? { nodeId: issue.nodeId } : {}), definitionVersion: a.version });
  const trigSel = sel?.id === "trigger";
  const stepCards: ReactElement[] = [];
  const addDots: ReactElement[] = [];
  for (const card of lay.cards) {
    if (card.type !== "step") continue;
    stepCards.push(<StepCard key={card.id} card={card} selected={sel?.id === card.id} hovered={hover === card.id} handlers={handlers} agent={agentOf(card)} onHover={setHover} />);
    if (!(card.node && kindOfKey(card.node.key) === "stop")) {
      addDots.push(<AddDot key={`add-${card.id}`} x={card.x + card.w / 2} y={card.y + card.h + 6} label={`Add a step after ${card.title}`} onPress={(px, py) => openAdd(card.id, px, py)} />);
    }
  }
  const inspect = panel && sel !== null && (selected !== null || trigSel);
  const openShelf = (): void => {
    const id = sel && sel.id !== "trigger" ? sel.id : (def.nodes[0]?.id ?? "trigger");
    const trigger = id === "trigger" ? 0 : null;
    openPanel(id, trigger);
    setSections((cur) => ({ ...cur, [tabKey(id, trigger)]: "data" }));
  };
  const stepSchema = selected && catalog.phase === "ready" ? catalog.steps.find((step) => step.key === selected.key)?.input : undefined;
  const stack = studioLayout === "compact";
  const inspectorPane = inspect && activeStep ? (
    <Inspector
      embedded={!stack}
      layout={studioLayout}
      mode={mode}
      onMode={setMode}
      section={sections[activeStep] ?? "configure"}
      onSection={(next) => setSections((cur) => ({ ...cur, [activeStep]: next }))}
      samples={samples}
      version={a.version}
      onStoreSample={(id, output) => setSamples((cur) => ({ ...cur, [id]: output }))}
      def={def} node={selected} trigger={trigSel && sel?.trigger !== null && sel?.trigger !== undefined ? def.triggers[sel.trigger] ?? null : null} triggerIndex={trigSel ? sel?.trigger ?? null : null}
      issues={issues} keys={data.keys} {...(data.keysStatus ? { keysStatus: data.keysStatus } : {})} {...(data.accounts ? { accounts: data.accounts } : {})} {...(data.lastPicks ? { lastPicks: data.lastPicks } : {})} {...(stepSchema !== undefined ? { inputSchema: stepSchema } : {})} onChange={edit} onClose={() => select(null)} onDelete={() => { if (sel && sel.id !== "trigger") { edit(removeStep(def, sel.id)); select(null); } }}
      onAsk={(bundle) => data.nav.ask(a.id, bundle)}
    />
  ) : null;
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
          <Text testID="definition-version" style={s.kindText}>{definitionLabel(a, dirty)}</Text>
        </View>
        <View style={s.kind} testID="kind"><Glyph name={a.kind === "space" ? "users" : "key"} size={13} color="var(--ink-3)" /><Text style={s.kindText}>{a.kind === "space" ? "Space" : "Personal"}</Text></View>
        {needs ? (<><View style={s.sep} /><View style={s.needs}><Dot tone="warn" size={6} /><Text numberOfLines={1} style={s.needsText}>{needs.replace(/^needs/i, "Needs")}</Text></View></>) : null}
        <View style={{ flex: 1 }} />
        <View accessibilityLabel="Builder mode" testID="builder-mode" style={s.seg}>
          {BUILDER_MODES.map((label) => {
            const on = (label === "Advanced") === (mode === "advanced");
            return (
              <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: on }} testID={label === "Basic" ? "mode-basic" : "mode-advanced"} onPress={() => setMode(label === "Advanced" ? "advanced" : "basic")} style={[s.segBtn, on && s.segOn]}>
                <Text style={[s.segText, on && s.segTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {connectTarget ? <TextButton label={`Connect ${connectTarget.service}`} icon="key" testID="connect" onPress={() => data.nav.connect(connectTarget)} /> : null}
        {!connectTarget && blockedIssue?.setup.blocked ? <Text testID="blocked-step" style={s.needsText}>{blockedIssue.setup.blocked}</Text> : null}
        <TextButton label="Events" icon="bolt" testID="events" onPress={() => setEventsOpen(true)} />
        <TextButton label="Test" icon="flask" testID="test-run" onPress={() => void test()} />
        {dirty ? <TextButton label={saving ? "Saving" : "Save"} primary disabled={saving || errors.length > 0} testID="save" onPress={() => void save()} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`Status: ${statusLabel}`} testID="status" onPress={openStatus} style={[s.status, pointer]}>
          <Dot tone={a.status === "on" ? "ok" : a.status === "paused" ? "warn" : "muted"} />
          <Text style={s.statusText}>{statusLabel}</Text>
          <Glyph name="chevD" size={11} color="var(--ink-3)" />
        </Pressable>
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
              <Pressable accessibilityRole="button" accessibilityLabel={blockerId ? `Go to ${blockerId}. This step blocks going live.` : "Show the first problem"} testID="problem-go" onPress={goToBlocker} style={pointer}>
                <Text style={s.problemsLink}>{errors[0]?.message ?? ""}</Text>
              </Pressable>
              {errors[0] ? <AskVyre bundle={askBundle(errors[0])} onOpen={(safe) => data.nav.ask(a.id, safe)} /> : null}
            </View>
          ) : null}
          <View testID="tool-row" style={s.tool}>
            <Text testID="definition-crumb" style={s.toolText}>{definitionCrumb({ status: a.status, dirty, pinned })}</Text>
            <View style={{ flex: 1 }} />
            <Pressable accessibilityRole="button" accessibilityLabel={DATA_SHELF_NAME} testID="open-data-shelf" onPress={openShelf} style={[s.shelfBtn, pointer]}>
              <Glyph name="record" size={14} color="var(--ink-2)" />
              <Text style={s.toolText}>{DATA_SHELF_NAME}</Text>
            </Pressable>
          </View>
          <View style={[s.body, stack && s.stack]} onLayout={(e: LayoutChangeEvent) => setBodyW(e.nativeEvent.layout.width)}>
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
            {stack && inspectorPane ? (
              <View testID="inspector-stack" style={s.inspectorStack}>
                <View style={s.compactTabs}>
                  {stepTabs.map((item) => (
                    <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: item.key === activeStep }} onPress={() => focusStepTab(item.key)} style={pointer}>
                      <Text style={s.toolText}>{item.title}</Text>
                    </Pressable>
                  ))}
                </View>
                {inspectorPane}
              </View>
            ) : null}
            {!stack && inspect && activeStep ? (
              <SidePane
                paneKey={`automation-steps:${a.id}`}
                toggle={{ open: true, onPress: () => select(null) }}
                tabs={stepTabs}
                activeTab={activeStep}
                onSelectTab={focusStepTab}
                onCloseTab={(key) => {
                  const next = stepTabs.filter((t) => t.key !== key);
                  setStepTabs(next);
                  if (next.length === 0) { setPanel(false); setSel(null); setActiveStep(null); return; }
                  if (activeStep === key) focusStepTab(next[next.length - 1]!.key);
                }}
              >
                {inspectorPane}
              </SidePane>
            ) : null}
          </View>
        </>
      ) : null}
      {tab === "runs" ? (
        tabBodies.runs ? (
          <View style={s.runsBody}><View style={{ flex: 1, minWidth: 0 }}>{tabBodies.runs}</View>{runGraph}</View>
        ) : <View style={s.pageBody}><RunsList automationId={a.id} nodes={def.nodes} onLight={(r) => { setLitRun(r); setTab("steps"); }} onAsk={(message) => data.nav.ask(a.id, { resource: a.id, message })} /></View>
      ) : null}
      {tab === "analytics" ? <AnalyticsPanel automationId={a.id} /> : null}
      {tab === "versions" ? <View style={s.pageBody}>{tabBodies.versions ?? <VersionsList versions={versions} current={a.version} onRestore={(id) => void data.call("automations.restore_version", { automationId: a.id, versionId: id }).then(() => flash("Restored as a new version")).catch((x: unknown) => flash(x instanceof Error ? x.message : "That did not restore"))} />}<CohortMigration automationId={a.id} currentVersion={a.version} /></View> : null}
      {tab === "settings" ? <View style={s.pageBody}>{tabBodies.settings ?? <AutomationConfig automationId={a.id} />}</View> : null}
      {promoteOpen ? (
        <Overlay label="Promote to Space" onClose={() => setPromoteOpen(false)} testID="promote-overlay">
          <PromoteSheet automation={a} onClose={() => setPromoteOpen(false)} />
        </Overlay>
      ) : null}
      {eventsOpen ? (
        <Overlay label="Live Event Explorer" onClose={() => setEventsOpen(false)} testID="events-overlay">
          <View style={s.eventsSheet}><LiveEvents /></View>
        </Overlay>
      ) : null}
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

function RunsList({ automationId, nodes, onLight, onAsk }: {
  automationId: string;
  nodes: readonly { id: string; key: string }[];
  onLight(r: { id: string; label: string; states: Record<string, RunState> }): void;
  onAsk(message: string): void;
}): ReactElement {
  const q = useScreenQuery<RunsOut>(CONFIG, "runs", { subject: { type: "automation", id: automationId }, scope: "subject" });
  const data = useAutomationsData();
  const [picked, setPicked] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepRowLite[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (q.status !== "ready") return <Text style={s.dim}>{q.error?.message ?? "Loading"}</Text>;
  if (q.data.runs.length === 0) return <Text style={s.dim}>No runs yet. Test run sends sample data through it.</Text>;
  const open = (r: RunsOut["runs"][number]): void => {
    setPicked(r.id);
    setSteps(null);
    setBusy(r.id);
    setErr(null);
    void data.call("runs.steps", { runId: r.id }).then((out) => {
      const next = stepsFromCall(out);
      if (!next) { setErr("The step log did not return steps."); return; }
      setSteps(next);
    }).catch((e: unknown) => setErr(e instanceof Error ? e.message : "The step log did not load.")).finally(() => setBusy(null));
  };
  const selected = q.data.runs.find((r) => r.id === picked) ?? null;
  const container = containerForChildren(nodes);
  const children = selected ? q.data.runs.filter((r) => r.parentRun === selected.id) : [];
  return (
    <View testID="runs-list" style={s.runsSplit}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {err ? <Text style={s.dim}>{err}</Text> : null}
        {q.data.runs.map((r) => (
          <Row
            key={r.id} id={`run-${r.id}`} title={r.summary ?? r.name ?? "Run"} note={`${r.status === "failed" ? "Failed" : r.status === "succeeded" ? "Done" : r.status === "waiting" ? "Waiting" : "Running"} · ${new Date(r.startedAt).toISOString().slice(0, 10)}${r.definitionVersion ? ` · v${r.definitionVersion}` : ""}${busy === r.id ? " · loading steps" : ""}`}
            leading={<Dot tone={r.status === "failed" ? "danger" : r.status === "succeeded" ? "ok" : "warn"} />}
            onPress={() => open(r)}
          />
        ))}
        <View style={{ height: 8 }} />
        <TextButton label="Open run history" onPress={() => data.nav.openRun(q.data.runs[0]!.id)} />
      </View>
      {selected ? (
        <View testID="run-detail" style={s.runDetail}>
          <Text style={s.kindText}>{selected.summary ?? selected.id}</Text>
          {selected.parentRun ? <Text style={s.dim}>{`Parent ${selected.parentRun}`}</Text> : null}
          {steps?.map((step, index) => (
            <View key={`${step.step}-${index}`}>
              <Text testID={`run-attempt-${step.step}`} style={s.dim}>{attemptLine(step)}</Text>
              {container === step.step ? children.map((child) => <Text key={child.id} testID={`run-child-${child.id}`} style={s.dim}>{childRunLine({ runId: child.id })}</Text>) : null}
            </View>
          ))}
          {container === null ? children.map((child) => <Text key={child.id} testID={`run-child-${child.id}`} style={s.dim}>{childRunLine({ runId: child.id })}</Text>) : null}
          {selected.status === "failed" ? <AskVyre bundle={{ resource: automationId, message: selected.summary ?? "This run failed" }} onOpen={() => onAsk(selected.summary ?? "This run failed")} /> : null}
          <TextButton label="Show on the canvas" testID="show-on-canvas" disabled={!steps} onPress={() => { if (steps) onLight({ id: selected.id, label: selected.summary ?? "run", states: statesFromSteps(steps) }); }} />
        </View>
      ) : null}
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
          key={v.versionId} id={`ver-${v.n}`} title={`Version ${v.n}${v.n === current ? ", current definition" : ""}`} note={`${data.name(v.by)}${v.reason ? `, ${v.reason}` : ""}`}
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
  stack: { flexDirection: "column" },
  tool: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, minHeight: 36, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  toolText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  shelfBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  seg: { flexDirection: "row", borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string, padding: 2 },
  segBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  segOn: { backgroundColor: "var(--raised)" as string },
  segText: { fontSize: 12, color: "var(--ink-3)" as string },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  inspectorStack: { width: "100%" as unknown as number, maxHeight: "46%" as unknown as number, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  compactTabs: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  eventsSheet: { width: 520, maxWidth: "100%" as unknown as number, maxHeight: 560, borderRadius: 12, overflow: "hidden", backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  runsSplit: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  runDetail: { flex: 1, minWidth: 0, gap: 6, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
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
