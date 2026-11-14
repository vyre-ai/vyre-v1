// The open Automation as one calm page (design 2.5). It loads the Automation, keeps the person's edits as a draft on this screen, checks them (locally and with the server), draws them as sentences (StoryView),
// opens a step's form beside the page when a step is pressed (the existing Inspector is the editor), adds a step through the picker, and carries Test, Turn on, Run now, Ask Vyre and the "..." menu.
// Until the server holds a draft next to what is live, an On Automation's edits are saved by an explicit Save, and the page says so.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { isPhoneWidth } from "../../../../../../ui/src/SidePane/layout.ts";
import { loadProductCatalog, unlistedAppLine } from "../catalog/model.ts";
import type { CatalogStep, CatalogTrigger } from "../catalog/model.ts";
import { CANVAS, CONFIG, useAutomationsData, useScreenOrRead, useScreenQuery } from "../canvas/data.tsx";
import { Inspector } from "../canvas/Inspector.tsx";
import {
  addAfter,
  check,
  describeTrigger,
  removeStep,
  sortedIssues,
  startsByHand,
  updateStep,
  withPreset,
} from "../canvas/model.ts";
import { applyAccount, connectedOption } from "../connect/accounts.ts";
import { useOpenConnect } from "../../../shell/connect/context.ts";
import { connectLabel, connectThen, stepNeed } from "../../../shell/connect/model.ts";
import type { Definition, Issue } from "../canvas/model.ts";
import { AnalyticsPanel } from "../operations/StudioViews.tsx";
import { AutomationConfig } from "../config/AutomationConfig.tsx";
import { Overlay } from "../config/Overlay.tsx";
import { PromoteSheet } from "../config/PromoteSheet.tsx";
import { pickInFromCatalog } from "../picker/from-catalog.ts";
import { ConnectSheet } from "../picker/ConnectSheet.tsx";
import { StepPicker } from "../picker/StepPicker.tsx";
import { appOfStep, stepId } from "../picker/model.ts";
import { fromDefinition } from "../story/adapt.ts";
import { needsFromIssues } from "../story/issues.ts";
import { story as buildStory } from "../story/model.ts";
import { look } from "./look.ts";
import { pausedWhy } from "../first/from-list.ts";
import { Page } from "./Page.tsx";
import { StoryActions, StoryView } from "./StoryView.tsx";
import type { StoryAction } from "./StoryView.tsx";

type GetOut = CapMap["automations.get"]["out"];
type VersionsOut = CapMap["automations.versions"]["out"];
type Tab = "steps" | "runs" | "settings" | "history";

export interface BuilderPageProps {
  automationId: string;
  /** The Runs body the shell owns (the run list with its side pane). */
  runsBody?: ReactNode;
  initialSelected?: string | null;
  /** Open with the Promote sheet showing. */
  initialPromote?: boolean;
  /** Open on this tab. */
  initialTab?: "steps" | "runs" | "settings" | "history";
}

export function BuilderPage({
  automationId,
  runsBody,
  initialSelected = null,
  initialPromote = false,
  initialTab = "steps",
}: BuilderPageProps): ReactElement {
  const data = useAutomationsData();
  const q = useScreenQuery<GetOut>(CANVAS, "automation", { automationId, route: { automationId } });
  const versions = useScreenOrRead<VersionsOut>(
    CONFIG,
    "versions",
    { automationId },
    "automations.versions",
    { automationId },
    q.status === "ready" ? (q.data.automation as { version?: number } | undefined)?.version : 0,
  );
  if (q.status !== "ready")
    return (
      <Page title="">
        <View testID="builder-loading" />
      </Page>
    );
  const a = q.data.automation as GetOut["automation"] | undefined;
  if (!a)
    return (
      <Page title="This Automation is not available">
        <View testID="builder-empty" />
      </Page>
    );
  const canEdit = (q.data as { canEdit?: boolean }).canEdit;
  return (
    <Body
      key={a.id}
      a={a}
      {...(canEdit !== undefined ? { canEdit } : {})}
      versions={versions.status === "ready" ? versions.data.versions : []}
      runsBody={runsBody}
      initialSelected={initialSelected}
      initialPromote={initialPromote}
      initialTab={initialTab}
    />
  );
}

function Body({
  a,
  canEdit,
  versions,
  runsBody,
  initialSelected,
  initialPromote,
  initialTab,
}: {
  a: GetOut["automation"];
  canEdit?: boolean;
  versions: VersionsOut["versions"];
  runsBody: ReactNode;
  initialSelected: string | null;
  initialPromote: boolean;
  initialTab: Tab;
}): ReactElement {
  const data = useAutomationsData();
  const winW = useWindowDimensions().width;
  const phone = isPhoneWidth(winW);
  const { element, show } = useMenu();
  const locked = a.kind === "space" && (canEdit === undefined ? data.canSpace === false : !canEdit);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [draft, setDraft] = useState<Definition | null>(null);
  const undo = useRef<Definition[]>([]);
  const def: Definition = draft ?? a.definition;
  const [sel, setSel] = useState<string | null>(initialSelected);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<{ after: string | null; x: number; y: number } | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(initialPromote);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [catalog, setCatalog] = useState<{
    steps: CatalogStep[];
    all: CatalogStep[];
    triggers: CatalogTrigger[];
    checked: boolean;
  } | null>(null);

  useEffect(() => {
    let live = true;
    void loadProductCatalog((cap, input) => data.call(cap, input)).then((res) => {
      if (live && res.ok)
        setCatalog({
          steps: res.catalog.steps,
          all: res.catalog.all,
          triggers: res.catalog.triggers,
          checked: res.catalog.checked,
        });
    });
    return () => {
      live = false;
    };
  }, [data]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void data
        .call("automations.validate", { definition: def, kind: a.kind })
        .then((out) => live && setServerIssues((out as { issues?: Issue[] }).issues ?? []))
        .catch(() => live && setServerIssues([]));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [def, a.kind, data]);
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 4500);
    return () => clearTimeout(t);
  }, [note]);

  const listed = useMemo(() => (catalog ? new Set(catalog.steps.map((s) => s.key)) : null), [catalog]);
  const unlisted = useMemo(
    () =>
      listed === null
        ? []
        : def.nodes.flatMap((n) => {
            const line = unlistedAppLine(n.key, listed, catalog?.checked ?? true);
            return line === null ? [] : [{ nodeId: n.id, severity: "warning" as const, message: line }];
          }),
    [def, listed, catalog],
  );
  const issues = useMemo(
    () => sortedIssues([...check(def, a.kind), ...serverIssues, ...unlisted]),
    [def, a.kind, serverIssues, unlisted],
  );
  const errors = issues.filter((i) => i.severity === "error");
  const noAccess = useMemo(() => new Set(unlisted.map((u) => u.nodeId)), [unlisted]);

  const edit = useCallback(
    (next: Definition): void => {
      if (locked) return;
      undo.current.push(def);
      setDraft(next);
    },
    [def, locked],
  );
  const save = useCallback(async (): Promise<void> => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await data.call("automations.update", { automationId: a.id, definition: draft, expectedVersion: a.version });
      setDraft(null);
      undo.current = [];
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not save. Your edits are still here.");
    }
    setSaving(false);
  }, [draft, saving, data, a.id, a.version]);
  // an Off Automation is saved as you go; an On one waits for Save, because saving it makes the change live
  useEffect(() => {
    if (!draft || a.status === "on" || locked) return undefined;
    const t = setTimeout(() => void save(), 900);
    return () => clearTimeout(t);
  }, [draft, a.status, locked, save]);

  const pickIn = useMemo(() => (catalog ? pickInFromCatalog(catalog.steps) : null), [catalog]);
  const openConnect = useOpenConnect();
  // a step missing an account is fixed where it is missing: its one button connects it and puts the new account on the step
  const connectNeeds = useMemo(() => {
    const out = new Map<string, ReturnType<typeof stepNeed>>();
    if (!openConnect) return out;
    for (const issue of errors) {
      const node = issue.nodeId ? def.nodes.find((n) => n.id === issue.nodeId) : undefined;
      if (!node || out.has(node.id)) continue;
      const schema = catalog?.all.find((st) => st.key === node.key)?.input;
      const need = stepNeed(node, schema, a.kind);
      if (need) out.set(node.id, need);
    }
    return out;
  }, [errors, def, catalog, openConnect, a.kind]);
  const view = useMemo(() => {
    const full = Object.fromEntries(
      (catalog?.all ?? []).map((s) => [s.key, { title: s.title.replace(/^[^:·]{1,40}\s*[:·]\s+/, ""), ...appOf(s) }]),
    );
    const outward = new Set((catalog?.all ?? []).filter((s) => s.effects === "outward").map((s) => s.key));
    const usable = new Set((pickIn?.apps ?? []).map((x) => x.id));
    return fromDefinition(
      {
        triggers: def.triggers.map((t) => ({
          key: t.key,
          ...(t.config ? { config: t.config as Record<string, unknown> } : {}),
        })),
        nodes: def.nodes as never,
        ...(def.start ? { start: def.start } : {}),
      },
      {
        catalog: full,
        triggerTitles: Object.fromEntries((catalog?.triggers ?? []).map((t) => [t.key, t.title])),
        nameOfNode: (id) =>
          id === "trigger" ? "the start" : (full[def.nodes.find((n) => n.id === id)?.key ?? ""]?.title ?? id),
        canUse: (app) => usable.has(app) || !isGatedApp(app),
        noAccess: (name) => ({ line: `You cannot use ${name}.`, button: "Ask an admin" }),
        needsOf: (id) =>
          needsFromIssues(
            issues,
            id,
            noAccess,
            connectNeeds.has(id) ? connectLabel(connectNeeds.get(id)!, true) : undefined,
          ),
        writes: (k) => outward.has(k),
      },
    );
  }, [def, catalog, pickIn, issues, noAccess, connectNeeds]);
  // each trigger is its own row: When, then Or. The first is "trigger", the others "trigger:1", "trigger:2"
  const triggerRows = useMemo(
    () =>
      def.triggers.map((t, i) => {
        const title = catalog?.triggers.find((x) => x.key === t.key)?.title;
        return {
          id: i === 0 ? "trigger" : `trigger:${i}`,
          app: { id: "vyre:forms", name: "Trigger" },
          template: "{t}",
          values: { t: { text: describeTrigger(t, {}) || title || t.key } },
          hand: false,
        };
      }),
    [def, catalog],
  );
  const model = useMemo(
    () =>
      buildStory({
        name: a.name,
        on: a.status === "on",
        trigger: triggerRows[0] ? { ...triggerRows[0], hand: startsByHand(def) } : null,
        moreTriggers: triggerRows.slice(1),
        steps: view.steps,
        proposed: false,
        dirty: draft !== null,
        saveMode: "local",
        test: null,
      }),
    [a, view, draft, def],
  );

  const flash = (t: string): void => setNote(t);
  const setEnabled = async (enabled: boolean): Promise<void> => {
    if (enabled && errors.length > 0) {
      flash(`Fix ${errors.length === 1 ? "the problem" : `the ${errors.length} problems`} before turning this on.`);
      setSel(model.rows.flatMap((r) => (r.kind === "step" && r.need ? [r.id] : []))[0] ?? null);
      return;
    }
    try {
      await data.call("automations.set_enabled", { automationId: a.id, enabled });
    } catch (e) {
      flash(e instanceof Error ? e.message : "That did not change.");
    }
  };
  const test = async (): Promise<void> => {
    if (errors.length > 0)
      return flash(`Fix ${errors.length === 1 ? "the problem" : `the ${errors.length} problems`} first, then test.`);
    try {
      await data.call("automations.test", { automationId: a.id, sample: {} });
      flash(
        draft
          ? "Test run started on the saved version. Save your changes to test them."
          : "Test run started with sample data. Nothing was sent.",
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "The test did not start.");
    }
  };
  const runNow = async (): Promise<void> => {
    try {
      await data.call("automations.run", { automationId: a.id, payload: {} });
      flash("Started a run");
    } catch (e) {
      flash(e instanceof Error ? e.message : "The run did not start.");
    }
  };
  const askAdmin = (): void => {
    void data
      .call("access.request", {
        resource: { type: "automation", id: a.id },
        level: "edit",
        note: `May I change the Space automation ${a.name}?`,
        idempotencyKey: `ask-edit-${a.id}`,
      })
      .then(
        () => flash("Asked an admin. You will hear back in Chats."),
        (x: unknown) => flash(x instanceof Error ? x.message : "The ask did not go."),
      );
  };
  const onAction = (action: StoryAction, id?: string, e?: unknown): void => {
    if (action === "ask") data.nav.ask(a.id);
    else if (action === "test") void test();
    else if (action === "primary") {
      const label = model.head.primary?.label;
      if (label === "Turn on") void setEnabled(true);
      else if (label === "Run now") void runNow();
      else if (label === "Turn off") void setEnabled(false);
    } else if (action === "secondary") void setEnabled(false);
    else if (action === "bar") {
      if (id === "Save") void save();
      else if (id === "Discard") {
        setDraft(null);
        undo.current = [];
      }
    } else if (action === "open" && id) setSel(id === sel ? null : id);
    else if (action === "need" && id) {
      const step = model.rows.find((r) => r.kind === "step" && r.id === id);
      if (step && step.kind === "step" && step.need?.kind === "no_access") askAdmin();
      else if (id && connectNeeds.get(id) && openConnect) {
        const node = def.nodes.find((n) => n.id === id);
        const need = connectNeeds.get(id)!;
        if (node)
          void connectThen(openConnect, need, (made) => {
            if (need.kind === "mailbox")
              edit(
                updateStep(def, node.id, { input: applyAccount(node.input ?? {}, "mailboxId", connectedOption(made)) }),
              );
            else if (need.kind === "connector")
              edit(
                updateStep(def, node.id, {
                  input: applyAccount(node.input ?? {}, "connectionId", connectedOption(made)),
                }),
              );
            else if (need.kind === "ai") edit(updateStep(def, node.id, { ai: { ...(node.ai ?? {}), keyId: made.id } }));
            else flash("Connected. Pick it on the step.");
          });
      } else setSel(id);
    } else if (action === "add" || action === "insert") {
      const p = pos(e);
      setPicker({ after: action === "insert" && id ? id : (def.nodes.at(-1)?.id ?? null), x: p.x, y: p.y });
    }
  };
  const chooseStep = (pickedId: string): void => {
    const step = pickIn?.steps.find((s) => stepId(s) === pickedId);
    if (!step) return;
    const added = addAfter(def, picker?.after ?? null, step.key);
    const next = withPreset(added.def, added.id, step.preset as Record<string, unknown> | undefined);
    setPicker(null);
    edit(next);
    setSel(added.id);
  };
  const openMore = (e: unknown): void => {
    const p = pos(e);
    const items: MenuEntry[] = [
      { label: "History", onSelect: () => setTab("history") },
      ...(a.kind === "space"
        ? [
            {
              label: "Make a personal copy",
              onSelect: () =>
                void data
                  .call("automations.make_personal_copy", { automationId: a.id, name: `${a.name} (mine)` })
                  .then(() => flash("A personal copy is in your Automations"))
                  .catch((x: unknown) => flash(x instanceof Error ? x.message : "No copy was made")),
            },
          ]
        : data.canSpace === false
          ? []
          : [{ label: "Promote to the Space", onSelect: () => setPromoteOpen(true) }]),
      ...(locked ? [{ label: "Ask an admin to change it", onSelect: askAdmin }] : []),
      ...(locked
        ? []
        : [
            {
              label: "Undo last edit",
              onSelect: () => {
                const prev = undo.current.pop();
                if (prev) setDraft(JSON.stringify(prev) === JSON.stringify(a.definition) ? null : prev);
              },
            },
            { separator: true } as MenuEntry,
            {
              label: "Move to Trash",
              danger: true,
              onSelect: () =>
                void data
                  .call("automations.delete", { automationId: a.id })
                  .catch((x: unknown) => flash(x instanceof Error ? x.message : "That did not move")),
            },
          ]),
    ];
    show(items, p.x - 160, p.y, "context");
  };

  const selNode = sel && sel !== "trigger" ? (def.nodes.find((n) => n.id === sel) ?? null) : null;
  const trigIndex = sel === "trigger" ? 0 : sel?.startsWith("trigger:") ? Number(sel.slice(8)) : null;
  const trigSel = trigIndex !== null;
  const headingOf = (() => {
    const r = model.rows.find((x) => x.kind === "step" && x.id === sel);
    return r && r.kind === "step" ? r.sentence.text : undefined;
  })();
  const inspect = !locked && (selNode !== null || trigSel);
  const stepSchema = selNode && catalog ? catalog.all.find((s) => s.key === selNode.key)?.input : undefined;
  const inspector = inspect ? (
    <Inspector
      automationId={a.id}
      embedded={!phone}
      mode="basic"
      onMode={() => undefined}
      samples={{}}
      version={a.version}
      def={def}
      node={selNode}
      {...(headingOf ? { heading: headingOf } : {})}
      trigger={trigIndex !== null ? (def.triggers[trigIndex] ?? null) : null}
      triggerIndex={trigIndex}
      issues={issues}
      keys={data.keys}
      kind={a.kind}
      {...(data.keysStatus ? { keysStatus: data.keysStatus } : {})}
      {...(data.accounts ? { accounts: data.accounts } : {})}
      {...(data.lastPicks ? { lastPicks: data.lastPicks } : {})}
      {...(stepSchema !== undefined ? { inputSchema: stepSchema } : {})}
      onChange={edit}
      onClose={() => setSel(null)}
      onDelete={() => {
        if (selNode) {
          edit(removeStep(def, selNode.id));
          setSel(null);
        }
      }}
      onAsk={(bundle) => data.nav.ask(a.id, bundle)}
    />
  ) : null;

  const tabs = [
    { id: "steps", label: "Steps" },
    { id: "runs", label: "Runs" },
    { id: "settings", label: "Settings" },
    ...(tab === "history" ? [{ id: "history", label: "History" }] : []),
  ];
  return (
    <Page
      title={a.name}
      subtitle={a.status === "paused" && pausedWhy(a) ? `Paused. ${pausedWhy(a)}` : model.head.state}
      tabs={tabs}
      tab={tab}
      onTab={(t) => setTab(t as Tab)}
      onMenu={openMore}
      action={<StoryActions story={model} on={(x, id) => onAction(x, id)} />}
    >
      {note ? (
        <Text style={[look.quiet, s.note]} testID="builder-note">
          {note}
        </Text>
      ) : null}
      {tab === "steps" ? (
        <View style={s.split}>
          <View style={s.main}>
            <StoryView story={model} headless on={onAction} />
          </View>
          {inspector ? <View style={phone ? s.fill : s.side}>{inspector}</View> : null}
        </View>
      ) : null}
      {tab === "runs" ? (
        <View style={s.pane}>
          <AnalyticsPanel automationId={a.id} />
          {runsBody}
        </View>
      ) : null}
      {tab === "settings" ? (
        <View style={s.pane}>
          <AutomationConfig automationId={a.id} embedded />
        </View>
      ) : null}
      {tab === "history" ? (
        <View style={s.pane} testID="versions-list">
          {versions.length === 0 ? (
            <Text style={look.quiet}>This is the first version.</Text>
          ) : (
            versions.map((v) => (
              <Row
                key={v.versionId}
                id={`ver-${v.n}`}
                title={`Version ${v.n}${v.n === a.version ? ", current" : ""}`}
                note={`${data.name(v.by)}${v.reason ? `, ${v.reason}` : ""}`}
                {...(v.n === a.version
                  ? {}
                  : {
                      trailing: (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() =>
                            void data
                              .call("automations.restore_version", { automationId: a.id, versionId: v.versionId })
                              .then(() => flash("Restored as a new version"))
                              .catch((x: unknown) => flash(x instanceof Error ? x.message : "That did not restore"))
                          }
                        >
                          <Text style={look.btnText}>Restore</Text>
                        </Pressable>
                      ),
                    })}
              />
            ))
          )}
        </View>
      ) : null}
      {picker && pickIn ? (
        <StepPicker
          model={pickIn}
          x={picker.x}
          y={picker.y}
          onChoose={chooseStep}
          onConnect={() => {
            setPicker(null);
            setConnectOpen(true);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {connectOpen ? (
        <ConnectSheet
          apps={[]}
          known={[]}
          onSetup={() => setConnectOpen(false)}
          onAsk={() => setConnectOpen(false)}
          onDescribe={() => {
            setConnectOpen(false);
            data.nav.buildConnector?.();
          }}
          onClose={() => setConnectOpen(false)}
        />
      ) : null}
      {promoteOpen ? (
        <Overlay label="Promote to Space" onClose={() => setPromoteOpen(false)} testID="promote-overlay">
          <PromoteSheet automation={a} onClose={() => setPromoteOpen(false)} />
        </Overlay>
      ) : null}
      {element}
    </Page>
  );
}

/** An app's own steps keep the app they belong to, whether or not this person may use it. */
function appOf(s: CatalogStep): { app?: { id: string; name: string } } {
  const id = appOfStep({ key: s.key, title: s.title, ...(s.preset ? { preset: s.preset as never } : {}) });
  if (id === null) return {};
  const names: Record<string, string> = { google: "Google Workspace", microsoft: "Microsoft 365", github: "GitHub" };
  return { app: { id, name: names[id] ?? s.title.split(/\s*[:·]\s+/)[0] ?? id } };
}

/** Apps whose steps the server hides from a person who may not use them. Anything else is Vyre's own and always usable. */
const isGatedApp = (id: string): boolean => id === "google" || id === "microsoft" || id === "github";

function pos(e: unknown): { x: number; y: number } {
  const ev = e as
    | {
        currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } };
        nativeEvent?: { pageX?: number; pageY?: number };
      }
    | undefined;
  const r = ev?.currentTarget?.getBoundingClientRect?.();
  return { x: r?.left ?? ev?.nativeEvent?.pageX ?? 120, y: (r?.bottom ?? ev?.nativeEvent?.pageY ?? 160) + 4 };
}

const s = StyleSheet.create({
  split: { flex: 1, flexDirection: "row", minHeight: 0 },
  main: { flex: 1, minWidth: 0 },
  side: { width: 400, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  fill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "var(--win)" as string },
  pane: { flex: 1, padding: 16 },
  note: { paddingHorizontal: 16, paddingBottom: 4 },
});
