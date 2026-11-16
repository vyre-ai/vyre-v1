// The open Automation as one calm page (design 2.5). It loads the Automation, keeps the person's edits as a draft on this screen, checks them (locally and with the server), draws them as sentences (StoryView),
// opens a step's form beside the page when a step is pressed (the existing Inspector is the editor), adds a step through the picker, and carries Test, Turn on, Run now, Ask Vyre and the "..." menu.
// Until the server holds a draft next to what is live, an On Automation's edits are saved by an explicit Save, and the page says so.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { renameDuplicate } from "../../chats/menus/kinds-b.ts";
import { createMenuApiB } from "../../chats/menus/actions-b.ts";
import { TextAsk } from "../../chats/menus/TextAsk.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { isPhoneWidth } from "../../../../../../ui/src/SidePane/layout.ts";
import { loadProductCatalog, unlistedAppLine } from "../catalog/model.ts";
import type { CatalogStep, CatalogTrigger } from "../catalog/model.ts";
import { CANVAS, CONFIG, SIDEBAR, useAutomationsData, useScreenOrRead, useScreenQuery } from "../canvas/data.tsx";
import { Inspector } from "../canvas/Inspector.tsx";
import {
  addAfter,
  kindOfKey,
  addTrigger,
  removeTrigger,
  check,
  describeTrigger,
  iconOfKey,
  duplicateStep,
  moveStep,
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
import { givenBy } from "../builder/insert-data.ts";
import { inputValues } from "../builder/step-values.ts";
import type { TestResult } from "../story/model.ts";
import { useWhenText } from "../../../../../../ui/src/Time/index.tsx";
import { look } from "./look.ts";
import { More } from "../canvas/fields.tsx";
import { LiveEvents } from "../operations/EventsView.tsx";
import { Packages } from "../operations/PackagesView.tsx";
import { Dependencies } from "../operations/DependenciesView.tsx";
import { CohortMigration } from "../versions/CohortMigration.tsx";
import { sendsFromLine } from "../canvas/senders.ts";
import type { SenderLine } from "../canvas/senders.ts";
import { pausedWhy } from "../first/from-list.ts";
import { AutomationsPage as Page } from "./Page.tsx";
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
  /** A run's page opens one step's form to fix it: only that form is drawn, nothing else of the builder. */
  stepOnly?: boolean;
}

export function BuilderPage({
  automationId,
  runsBody,
  initialSelected = null,
  initialPromote = false,
  initialTab = "steps",
  stepOnly = false,
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
  const serverDraft = (q.data as { draft?: ServerDraft }).draft;
  // what the Assistant proposed and nobody has accepted yet (AUTOMATIONS-BUILD-RC29 phase 2): drawn on the page, saved nowhere
  const proposal = (q.data as { proposal?: ServerProposal }).proposal;
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
      serverDraft={serverDraft ?? null}
      proposal={proposal ?? null}
      versions={versions.status === "ready" ? versions.data.versions : []}
      runsBody={runsBody}
      initialSelected={initialSelected}
      initialPromote={initialPromote}
      initialTab={initialTab}
      stepOnly={stepOnly}
    />
  );
}

interface ServerDraft {
  definition: Definition;
  rev: number;
  baseVersion: number;
}
interface ServerProposal {
  definition: Definition;
  summary: string;
}

function Body({
  a,
  canEdit,
  serverDraft,
  proposal,
  versions,
  runsBody,
  initialSelected,
  initialPromote,
  initialTab,
  stepOnly,
}: {
  a: GetOut["automation"];
  canEdit?: boolean;
  serverDraft: ServerDraft | null;
  proposal: ServerProposal | null;
  versions: VersionsOut["versions"];
  runsBody: ReactNode;
  initialSelected: string | null;
  initialPromote: boolean;
  initialTab: Tab;
  stepOnly: boolean;
}): ReactElement {
  const data = useAutomationsData();
  const winW = useWindowDimensions().width;
  const phone = isPhoneWidth(winW);
  const { element, show } = useMenu();
  const locked = a.kind === "space" && (canEdit === undefined ? data.canSpace === false : !canEdit);
  const [tab, setTab] = useState<Tab>(phone ? "runs" : initialTab);
  const [renaming, setRenaming] = useState(false);
  // on a phone a run and its fix work; building (the steps page) says it opens on a computer
  const phoneFix = phone && initialSelected !== null;
  // the draft lives on the server, saved as the person edits (AUTOMATIONS-BUILD-RC29 1c); this is the copy being typed into
  const [draft, setDraft] = useState<Definition | null>(
    a.status === "on" && serverDraft ? serverDraft.definition : null,
  );
  // the rev of the server's draft this screen last read or wrote: a write carries it
  const rev = useRef<number | null>(a.status === "on" && serverDraft ? serverDraft.rev : null);
  const undo = useRef<Definition[]>([]);
  // the version a draft was STARTED on: every write sends this base, never the live version, so another person's save is never overwritten
  const base = useRef<number | null>(a.status === "on" && serverDraft ? serverDraft.baseVersion : null);
  const whenText = useWhenText();
  const [conflict, setConflict] = useState(false);
  const [testRun, setTestRun] = useState<{
    runId: string;
    caseName: string;
    results: Record<string, TestResult>;
    done?: boolean;
  } | null>(null);
  const [confirmTheirs, setConfirmTheirs] = useState(false);
  // a proposal is what the page shows until a person accepts or discards it; their own draft and the live steps are untouched underneath
  const def: Definition = proposal ? proposal.definition : (draft ?? a.definition);
  const [sel, setSel] = useState<string | null>(initialSelected);
  const [focusNeed, setFocusNeed] = useState<string | null>(null);
  // the last real event of this Automation's trigger: the samples "Insert data" shows beside each name
  const [pastEvent, setPastEvent] = useState<Record<string, unknown> | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void data.call("automations.test_events", { automationId: a.id }).then(
      (o) => {
        const ev = (o as { events?: { payload?: Record<string, unknown> }[] }).events?.[0]?.payload;
        const inner = ev && typeof ev["input"] === "object" ? (ev["input"] as Record<string, unknown>) : ev;
        if (live) setPastEvent(inner);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data, a.id]);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<{ after: string | null; x: number; y: number } | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  // what Connect an app lists, decided on the server: the Vault items this person may use whose app their Assistant can set up
  const [vaultOffers, setVaultOffers] = useState<{ itemId: string; appName: string }[]>([]);
  const sheetApps = vaultOffers.map((o) => ({
    id: o.appName.toLowerCase(),
    name: o.appName,
    connected: false,
    mayUse: false,
    vault: { item: "Saved in your Vault", use: "use" as const, assistant: "cleared" as const },
  }));
  useEffect(() => {
    if (!connectOpen) return undefined;
    let live = true;
    void data.call("automations.connect_options", {}).then(
      (o) => live && setVaultOffers((o as { vault?: { itemId: string; appName: string }[] }).vault ?? []),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [connectOpen, data]);
  const [promoteOpen, setPromoteOpen] = useState(initialPromote);
  const [packagesOpen, setPackagesOpen] = useState(false);
  // what this Automation sends from, and how many of its runs failed: both were on the old page's head
  const [senders, setSenders] = useState<readonly SenderLine[]>([]);
  useEffect(() => {
    let live = true;
    void data.call("automations.senders", { automationId: a.id }).then(
      (o) => live && setSenders((o as { senders?: SenderLine[] })?.senders ?? []),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data, a.id, a.version, a.status]);
  const sendsFrom = sendsFromLine(senders);
  const list = useScreenQuery<{ automations: readonly { id: string; failedRuns?: number }[] }>(
    SIDEBAR,
    "automations",
    {},
  );
  const failedRuns = list.status === "ready" ? (list.data.automations.find((x) => x.id === a.id)?.failedRuns ?? 0) : 0;
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [catalog, setCatalog] = useState<{
    steps: CatalogStep[];
    all: CatalogStep[];
    triggers: CatalogTrigger[];
    checked: boolean;
  } | null>(null);

  // the catalogue read can fail or be slow: the page says so and offers Retry, never a silent press
  const [catalogFail, setCatalogFail] = useState<string | null>(null);
  const [catalogTick, setCatalogTick] = useState(0);
  useEffect(() => {
    let live = true;
    setCatalogFail(null);
    void loadProductCatalog((cap, input) => data.call(cap, input)).then((res) => {
      if (live && !res.ok) setCatalogFail(res.message);
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
  }, [data, catalogTick]);
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
      if (proposal) {
        setNote("Accept the draft to change it yourself, or ask for a change.");
        return;
      }
      if (base.current === null) base.current = a.version;
      undo.current.push(def);
      setDraft(next);
    },
    [def, locked, draft, a.version, proposal],
  );
  const save = useCallback(async (): Promise<void> => {
    if (!draft || saving || conflict || locked) return;
    setSaving(true);
    const sent = draft;
    try {
      const out = (await data.call("automations.draft.save", {
        automationId: a.id,
        definition: sent,
        ...(rev.current === null ? { expectedVersion: base.current ?? a.version } : { expectedRev: rev.current }),
      })) as { automation: { version: number; status: string }; draft?: ServerDraft };
      if (out.draft) {
        // an On Automation: the server holds the draft next to what is live
        rev.current = out.draft.rev;
        base.current = out.draft.baseVersion;
      } else {
        // an Off one is its own draft: what was sent is now the Automation
        rev.current = null;
        base.current = out.automation.version;
        setDraft((now) => (now === sent ? null : now));
        if (draft === sent) undo.current = [];
      }
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (
        code === "validation.version_conflict" ||
        /changed this automation|newer version|version_conflict/i.test(String((e as Error)?.message ?? ""))
      ) {
        // nothing was overwritten and nothing is retried on the new version: the person chooses
        setConflict(true);
      } else setNote(e instanceof Error ? e.message : "That did not save. Your edits are still here.");
    }
    setSaving(false);
  }, [draft, saving, conflict, locked, data, a.id, a.version]);
  // every edit is saved as a draft after a short pause: no Save button. A On Automation's edit stays a draft until Make live
  const [savedDraft, setSavedDraft] = useState<Definition | null>(
    a.status === "on" && serverDraft ? serverDraft.definition : null,
  );
  useEffect(() => {
    if (!draft || draft === savedDraft || locked || conflict) return undefined;
    const t = setTimeout(() => {
      void save().then(() => setSavedDraft(draft));
    }, 700);
    return () => clearTimeout(t);
  }, [draft, savedDraft, locked, conflict, save]);
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
  // the files and folders a step names are shown by their names: read once each, kept
  const [thingNames, setThingNames] = useState<Readonly<Record<string, string>>>({});
  const wanted = useMemo(() => {
    const out = new Set<string>();
    const walk = (v: unknown): void => {
      if (typeof v === "string") {
        if (/^(fil|fld)_[0-9a-f]{8,}$/.test(v.trim())) out.add(v.trim());
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    for (const n of def.nodes) {
      walk(n.input);
      // a record is read with its type, so the pair travels together
      const rid = n.input?.["recordId"];
      const rtype = n.input?.["type"];
      if (typeof rid === "string" && /^rec_[0-9a-f]{8,}$/.test(rid) && typeof rtype === "string")
        out.add(`${rid}@${rtype}`);
    }
    return [...out].sort().join(",");
  }, [def]);
  useEffect(() => {
    let live = true;
    for (const pair of wanted.split(",").filter((x) => x.includes("@"))) {
      const [rid, rtype] = pair.split("@") as [string, string];
      if (thingNames[rid] !== undefined) continue;
      void data.call("records.get", { type: rtype, recordId: rid }).then(
        (out) => {
          const rec = (out as { record?: { fields?: Record<string, unknown>; title?: string; name?: string } }).record;
          const f = rec?.fields ?? {};
          const name = [f["name"], f["title"], rec?.title, rec?.name].find((x) => typeof x === "string" && x !== "");
          if (live && typeof name === "string") setThingNames((cur) => ({ ...cur, [rid]: name }));
        },
        () => undefined,
      );
    }
    for (const id of wanted.split(",").filter((x) => x !== "" && !x.includes("@") && thingNames[x] === undefined)) {
      const folder = id.startsWith("fld_");
      void data.call(folder ? "files.folder.get" : "files.get", folder ? { folderId: id } : { fileId: id }).then(
        (out) => {
          const o = out as { file?: { name?: string }; folder?: { name?: string }; name?: string };
          const name = (folder ? o.folder?.name : o.file?.name) ?? o.name;
          if (live && typeof name === "string" && name !== "") setThingNames((cur) => ({ ...cur, [id]: name }));
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, data]);
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
          id === "trigger" ? "Trigger" : (full[def.nodes.find((n) => n.id === id)?.key ?? ""]?.title ?? id),
        canUse: (app) => usable.has(app) || !isGatedApp(app),
        nameOfId: (id) => thingNames[id] ?? data.name(id),
        iconOf: (id) =>
          id === "trigger"
            ? "bolt"
            : def.nodes.find((n) => n.id === id)
              ? iconOfKey(def.nodes.find((n) => n.id === id)!.key)
              : undefined,
        sample: Object.fromEntries(
          Object.entries(pastEvent ?? {}).flatMap(([k, v]) =>
            typeof v === "string" || typeof v === "number" ? [[`trigger.${k}`, String(v)] as const] : [],
          ),
        ),
        ...(catalog?.checked
          ? { isKnown: (key: string) => full[key] !== undefined || kindOfKey(key) !== "plain" }
          : {}),
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
  }, [def, catalog, pickIn, issues, noAccess, connectNeeds, pastEvent, data, thingNames]);
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
        proposed: proposal !== null,
        dirty: proposal === null && draft !== null && a.status === "on",
        saveMode: "draft",
        test: testRun ? { caseName: testRun.caseName, results: testRun.results } : null,
      }),
    [a, view, draft, def, triggerRows, testRun, proposal],
  );

  const makeLive = useCallback(async (): Promise<void> => {
    if (!draft || saving) return;
    if (errors.length > 0) {
      setNote(`Fix ${errors.length === 1 ? "the problem" : `the ${errors.length} problems`} before this goes live.`);
      setSel(model.rows.flatMap((r) => (r.kind === "step" && r.need ? [r.id] : []))[0] ?? null);
      return;
    }
    setSaving(true);
    try {
      if (draft !== savedDraft)
        await data
          .call("automations.draft.save", {
            automationId: a.id,
            definition: draft,
            ...(rev.current === null ? { expectedVersion: base.current ?? a.version } : { expectedRev: rev.current }),
          })
          .then((o) => {
            rev.current = (o as { draft?: ServerDraft }).draft?.rev ?? null;
          });
      await data.call("automations.make_live", {
        automationId: a.id,
        ...(rev.current !== null ? { expectedRev: rev.current } : {}),
      });
      setDraft(null);
      setSavedDraft(null);
      rev.current = null;
      base.current = null;
      undo.current = [];
      setNote("It is live. Runs already started finish as they were.");
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "validation.version_conflict") setConflict(true);
      else setNote(e instanceof Error ? e.message : "That did not go live. Your draft is still here.");
    }
    setSaving(false);
  }, [draft, savedDraft, saving, data, a.id, a.version, errors, model]);

  const flash = (t: string): void => setNote(t);
  // drop this screen's copy only: after a conflict the server's draft may be someone else's and stays
  const dropLocal = (): void => {
    rev.current = null;
    setSavedDraft(null);
    setDraft(null);
    base.current = null;
    undo.current = [];
    setConflict(false);
    setConfirmTheirs(false);
  };
  // the Assistant's proposal: Accept writes it as the person's own (an on Automation keeps it as their draft until Make live); Discard throws it away
  const acceptProposal = async (): Promise<void> => {
    try {
      const out = (await data.call("automations.proposal.accept", { automationId: a.id })) as {
        draft?: ServerDraft;
      };
      undo.current = [];
      setConflict(false);
      if (out.draft) {
        setDraft(out.draft.definition);
        setSavedDraft(out.draft.definition);
        rev.current = out.draft.rev;
        base.current = out.draft.baseVersion;
        setNote("Accepted as your draft. It is not live until you press Make live.");
      } else {
        setDraft(null);
        setSavedDraft(null);
        rev.current = null;
        base.current = null;
        setNote("Accepted. Nothing is on yet.");
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That was not accepted. The draft is still here.");
    }
  };
  const discardProposal = async (): Promise<void> => {
    try {
      // an empty Automation that proposing made goes to Trash with its proposal: the page then leaves it as it does after Move to Trash
      const res = (await data.call("automations.proposal.discard", { automationId: a.id })) as { removed?: boolean };
      if (res?.removed) data.nav.leave?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That was not discarded.");
    }
  };
  const discardMine = (): void => {
    void data.call("automations.draft.discard", { automationId: a.id }).catch(() => undefined);
    dropLocal();
  };
  const keepMineAsCopy = async (): Promise<void> => {
    if (!draft) return;
    try {
      await data.call("automations.create", { name: `${a.name} (my edits)`, definition: draft });
      flash("Your edits are kept as a copy in your Automations");
      dropLocal();
    } catch (e) {
      flash(e instanceof Error ? e.message : "No copy was made. Your edits are still here.");
    }
  };
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
  // Test tries the draft on a real past event, step by step (AUTOMATIONS-BUILD-RC29 1f)
  const test = async (): Promise<void> => {
    try {
      if (draft && draft !== savedDraft) await save();
      const past = (await data.call("automations.test_events", { automationId: a.id })) as {
        events: { runId: string; at: number; payload: Record<string, unknown> }[];
      };
      const event = past.events[0];
      const started = (await data.call("automations.test", {
        automationId: a.id,
        ...(a.status === "on" && draft ? { draft: true } : {}),
        ...(event ? { eventRunId: event.runId } : {}),
      })) as { runId: string };
      setTestRun({
        runId: started.runId,
        caseName: event ? caseOf(event.payload, whenText(event.at, Date.now())) : "an example event",
        results: {},
      });
    } catch (e) {
      flash(e instanceof Error ? e.message : "The test did not start.");
    }
  };
  useEffect(() => {
    if (!testRun || testRun.done) return undefined;
    let live = true;
    let tries = 0;
    const tick = async (): Promise<void> => {
      tries += 1;
      try {
        const got = (await data.call("runs.steps", { runId: testRun.runId })) as {
          steps: { step: string; state: string; error?: { message: string } }[];
        };
        const results: Record<string, TestResult> = {};
        for (const st of got.steps) {
          if (st.state === "succeeded") {
            const io = (await data.call("runs.step_io", { runId: testRun.runId, step: st.step }).catch(() => null)) as {
              input?: unknown;
            } | null;
            const node = def.nodes.find((n) => n.id === st.step);
            let values: readonly (readonly [string, string])[] = [];
            try {
              values = node ? inputValues(node.key, io?.input, (id) => thingNames[id] ?? data.name(id)) : [];
            } catch {
              values = [];
            }
            results[st.step] = { status: "ok", line: "Done", values };
          } else if (st.state === "failed" || st.state === "stopped")
            results[st.step] = { status: "stop", line: st.error?.message ?? "Stopped here", values: [] };
        }
        const finished = got.steps.length >= def.nodes.length || got.steps.some((x) => x.state === "failed");
        if (live)
          setTestRun((t) => (t && t.runId === testRun.runId ? { ...t, results, done: finished || tries > 25 } : t));
        if (live && !finished && tries <= 25) setTimeout(() => void tick(), 900);
      } catch {
        if (live) setTestRun((t) => (t ? { ...t, done: true } : t));
      }
    };
    void tick();
    return () => {
      live = false;
    };
  }, [testRun?.runId]);
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
    else if (action === "rowmenu" && id) {
      const p = pos(e);
      show(
        [
          { label: "Duplicate", onSelect: () => edit(duplicateStep(def, id).def) },
          { label: "Move up", onSelect: () => edit(moveStep(def, id, -1)) },
          { label: "Move down", onSelect: () => edit(moveStep(def, id, 1)) },
          { separator: true },
          {
            label: "Delete",
            danger: true,
            onSelect: () => {
              edit(removeStep(def, id));
              if (sel === id) setSel(null);
              flash("Deleted. Undo is in the menu at the top.");
            },
          },
        ],
        p.x,
        p.y,
        "other",
      );
    } else if (action === "test") void test();
    else if (action === "primary") {
      const label = model.head.primary?.label;
      if (label === "Turn on") void setEnabled(true);
      else if (label === "Run now") void runNow();
      else if (label === "Turn off") void setEnabled(false);
    } else if (action === "secondary") void setEnabled(false);
    else if (action === "bar") {
      if (id === "Make live") void makeLive();
      else if (id === "Done") setTestRun(null);
      else if (id === "Run again") void test();
      else if (id === "Accept") void acceptProposal();
      else if (id === "Change") data.nav.ask(a.id);
      else if (id === "Discard") {
        if (proposal) void discardProposal();
        else discardMine();
      }
    } else if (action === "open" && id) {
      // a step of a kind this version does not know is drawn, never opened: it has no form here, and Save keeps it as it was
      const node = def.nodes.find((n) => n.id === id);
      const foreign =
        node !== undefined &&
        catalog?.checked === true &&
        !catalog.all.some((st) => st.key === node.key) &&
        kindOfKey(node.key) === "plain";
      if (!foreign) setSel(id === sel ? null : id);
    } else if (action === "need" && id) {
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
      } else {
        setFocusNeed(id);
        setSel(id);
      }
    } else if (action === "trigger") {
      const p = pos(e);
      const triggers = catalog?.triggers ?? [];
      const entries: MenuEntry[] =
        catalog === null
          ? [{ label: "Loading what can start this", onSelect: () => undefined }]
          : triggers.length === 0
            ? [{ label: "Nothing is available to start this", onSelect: () => undefined }]
            : triggers
                // a Personal Space has no web request trigger, and a trigger nobody can use is not offered
                .filter(
                  (t) => t.availability !== "unavailable" && !(data.personalSpace === true && t.key === "webhook"),
                )
                .map((t) => ({
                  label: t.availability === "preview" ? `${t.title} (Preview)` : t.title,
                  onSelect: () => {
                    edit(addTrigger(def, t.key));
                    setSel(def.triggers.length === 0 ? "trigger" : `trigger:${def.triggers.length}`);
                  },
                }));
      show(entries, p.x, p.y, "other");
    } else if (action === "add" || action === "insert") {
      const p = pos(e);
      if (pickIn === null) {
        show(
          catalogFail
            ? [
                { label: `${catalogFail}`, onSelect: () => undefined },
                { label: "Retry", onSelect: () => setCatalogTick((n) => n + 1) },
              ]
            : [{ label: "Loading the steps you can add", onSelect: () => undefined }],
          p.x,
          p.y,
          "other",
        );
        return;
      }
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
    // the new step's form opens with the cursor in its first empty field, so typing goes there and not into the list's search
    setFocusNeed(added.id);
  };
  const openMore = (e: unknown): void => {
    const p = pos(e);
    const menuApi = createMenuApiB(data);
    const items: MenuEntry[] = [
      // the same Rename and Duplicate as the row's own menu in the list
      ...(locked
        ? []
        : [
            ...renameDuplicate(
              { canEdit: true },
              {
                rename: () => setRenaming(true),
                duplicate: () =>
                  void menuApi
                    .automationDuplicate(a.id)
                    .then(() => flash("A copy is in your Automations"))
                    .catch((x: unknown) => flash(x instanceof Error ? x.message : "No copy was made")),
              },
            ),
            {
              label: a.status === "on" ? "Turn Off" : "Turn On",
              onSelect: () => void setEnabled(a.status !== "on"),
            } as MenuEntry,
            { separator: true } as MenuEntry,
          ]),
      { label: "History", onSelect: () => setTab("history") },
      { label: "Move running work to this version", onSelect: () => setTab("history") },
      { label: "Make a copy to share", onSelect: () => setPackagesOpen(true) },
      { label: "Import a copy", onSelect: () => setPackagesOpen(true) },
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
      ...(locked || !model.rows.some((r) => r.kind === "trigger")
        ? []
        : [{ label: "Add another thing that starts this", onSelect: () => onAction("trigger") }]),
      ...(locked
        ? []
        : [
            {
              label: "Undo last edit",
              onSelect: () => {
                const prev = undo.current.pop();
                if (prev) {
                  const same = JSON.stringify(prev) === JSON.stringify(a.definition);
                  setDraft(same ? null : prev);
                  if (same) {
                    base.current = null;
                    discardMine();
                  }
                }
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
    return r && r.kind === "step" ? { text: r.sentence.text, app: r.app } : undefined;
  })();
  // the row's own orange line and button: the form's bar says the same and does the same
  const needOfRow = (nodeId: string): { needButton?: string; onNeed?: () => void } => {
    const r = model.rows.find((x) => x.kind === "step" && x.id === nodeId);
    return r && r.kind === "step" && r.need
      ? { needButton: r.need.button, onNeed: () => onAction("need", nodeId) }
      : {};
  };
  const given = useMemo(() => {
    if (!selNode || !catalog) return [];
    const at = def.nodes.findIndex((n) => n.id === selNode.id);
    const trig = catalog.triggers.find((t) => t.key === def.triggers[0]?.key);
    return givenBy({
      triggerTitle: trig?.title ?? "What starts this",
      event: pastEvent ?? trig?.sample,
      steps: def.nodes.slice(0, Math.max(0, at)),
      titleOf: (n) => n.title?.trim() || catalog.all.find((c) => c.key === n.key)?.title || n.key,
      outputOf: (key) => catalog.all.find((c) => c.key === key)?.output,
    });
  }, [selNode, catalog, def, pastEvent]);
  const inspect = !locked && (selNode !== null || trigSel);
  const stepSchema = selNode && catalog ? catalog.all.find((s) => s.key === selNode.key)?.input : undefined;
  const inspector = inspect ? (
    <Inspector
      automationId={a.id}
      embedded
      mode="basic"
      onMode={() => undefined}
      samples={{}}
      version={a.version}
      def={def}
      node={selNode}
      {...(headingOf ? { heading: headingOf.text, mark: headingOf.app } : {})}
      autoFocusNeed={focusNeed !== null && focusNeed === sel}
      {...(selNode ? needOfRow(selNode.id) : {})}
      given={given}
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
      onRemoveTrigger={(i) => {
        edit(removeTrigger(def, i));
        setSel(null);
      }}
      onDelete={() => {
        if (selNode) {
          edit(removeStep(def, selNode.id));
          setSel(null);
        }
      }}
      onAsk={(bundle) => data.nav.ask(a.id, bundle)}
    />
  ) : null;

  if (stepOnly)
    return (
      <View style={s.fill} testID="step-only">
        {inspector}
      </View>
    );
  const tabs = phone
    ? [{ id: "runs", label: "Runs", ...(failedRuns > 0 ? { badge: failedRuns } : {}) }]
    : [
        { id: "steps", label: "Steps" },
        { id: "runs", label: "Runs", ...(failedRuns > 0 ? { badge: failedRuns } : {}) },
        { id: "settings", label: "Settings" },
        ...(tab === "history" ? [{ id: "history", label: "History" }] : []),
      ];
  return (
    <Page
      title={a.name}
      subtitle={`${a.status === "paused" && pausedWhy(a) ? `Paused. ${pausedWhy(a)}` : model.head.state}`}
      tabs={tabs}
      tab={tab}
      onTab={(t) => setTab(t as Tab)}
      onMenu={openMore}
      action={phone ? undefined : <StoryActions story={model} readOnly={locked} on={(x, id) => onAction(x, id)} />}
    >
      {conflict ? (
        <View style={s.conflict} testID="save-conflict" accessibilityRole="alert">
          <Text style={look.body}>
            Someone else changed this while you were editing. Nothing of theirs was overwritten.
          </Text>
          {confirmTheirs ? (
            <View style={s.conflictRow}>
              <Text style={look.quiet}>Seeing theirs discards your changes.</Text>
              <Pressable testID="conflict-discard" accessibilityRole="button" onPress={dropLocal}>
                <Text style={look.btnText}>Discard mine</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.conflictRow}>
              <Pressable testID="conflict-theirs" accessibilityRole="button" onPress={() => setConfirmTheirs(true)}>
                <Text style={look.btnText}>See theirs</Text>
              </Pressable>
              <Pressable testID="conflict-copy" accessibilityRole="button" onPress={() => void keepMineAsCopy()}>
                <Text style={look.btnText}>Keep mine as a copy</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
      {sendsFrom ? (
        <Text style={[look.quiet, s.note, !sendsFrom.ok && look.warn]} testID="sends-from">
          {sendsFrom.text}
        </Text>
      ) : null}
      {locked ? (
        <Text style={[look.quiet, s.note]} testID="read-only-note">
          You can read this Automation. Only people who can edit Space Automations can change it.
        </Text>
      ) : null}
      {note ? (
        <Text style={[look.quiet, s.note]} testID="builder-note">
          {note}
        </Text>
      ) : null}
      {phone && phoneFix ? <View style={s.fill}>{inspector}</View> : null}
      {phone && !phoneFix ? (
        <>
          <Text style={[look.quiet, s.note]} testID="phone-build-line">
            Building opens on a computer. Runs and their fixes work here.
          </Text>
          {runsBody}
        </>
      ) : null}
      {!phone && tab === "steps" ? (
        <View style={s.split}>
          <View style={s.main}>
            <StoryView story={model} headless readOnly={locked} on={onAction} />
          </View>
          {inspector ? <View style={phone ? s.fill : s.side}>{inspector}</View> : null}
        </View>
      ) : null}
      {!phone && tab === "runs" ? (
        <View style={s.pane}>
          <AnalyticsPanel automationId={a.id} />
          {runsBody}
          <More head="Event log" testID="runs-event-log">
            <LiveEvents />
          </More>
        </View>
      ) : null}
      {!phone && tab === "settings" ? (
        <View style={s.pane}>
          <AutomationConfig automationId={a.id} embedded readOnly={locked} />
          <Dependencies automationId={a.id} />
          <Pressable testID="settings-copies" accessibilityRole="button" onPress={() => setPackagesOpen(true)}>
            <Text style={look.btnText}>Make a copy to share, or import one</Text>
          </Pressable>
        </View>
      ) : null}
      {tab === "history" ? (
        <View style={s.pane} testID="versions-list">
          <CohortMigration automationId={a.id} currentVersion={a.version} />
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
          apps={sheetApps}
          known={ADDABLE_APPS}
          onAdd={(c) => {
            // a known app goes through the shared connect flow over this page; any other starts the Describe flow
            if (c.kind === "known" && openConnect) {
              setConnectOpen(false);
              void openConnect({ kind: "connector", service: c.id }).then((made) => {
                if (!made) return;
                setCatalogTick((n) => n + 1);
                flash(`${c.label} is connected. Its steps are in Your apps.`);
              });
              return;
            }
            setConnectOpen(false);
            data.nav.buildConnector?.();
          }}
          onSetup={(id) => {
            const o = vaultOffers.find((x) => x.appName.toLowerCase() === id);
            setConnectOpen(false);
            if (o)
              void Promise.resolve(data.nav.setUpConnector?.({ itemId: o.itemId, appName: o.appName })).catch(
                () => undefined,
              );
          }}
          onAsk={() => setConnectOpen(false)}
          onDescribe={() => {
            setConnectOpen(false);
            data.nav.buildConnector?.();
          }}
          onClose={() => setConnectOpen(false)}
        />
      ) : null}
      {packagesOpen ? (
        <Overlay label="Copies to share" onClose={() => setPackagesOpen(false)} testID="packages-overlay">
          <Packages />
        </Overlay>
      ) : null}
      {promoteOpen ? (
        <Overlay label="Promote to Space" onClose={() => setPromoteOpen(false)} testID="promote-overlay">
          <PromoteSheet automation={a} onClose={() => setPromoteOpen(false)} />
        </Overlay>
      ) : null}
      {element}
      {renaming ? (
        <TextAsk
          title="Rename this Automation"
          label="Name"
          action="Rename"
          initial={a.name}
          onDone={(name) => {
            setRenaming(false);
            void createMenuApiB(data)
              .automationRename(a.id, name)
              .catch((x: unknown) => flash(x instanceof Error ? x.message : "That did not change"));
          }}
          onClose={() => setRenaming(false)}
        />
      ) : null}
    </Page>
  );
}

/** The apps the shared connect flow signs in to (shell/connect/sheets.tsx ConnectorSheet): what Add an app can search for. */
const ADDABLE_APPS: readonly { id: string; name: string }[] = [
  { id: "google", name: "Google Workspace" },
  { id: "microsoft", name: "Microsoft 365" },
  { id: "github", name: "GitHub" },
  { id: "dropbox", name: "Dropbox" },
];

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
  conflict: {
    gap: 8,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: "var(--hover)" as string,
  },
  conflictRow: { flexDirection: "row", gap: 16, alignItems: "center" },
  split: { flex: 1, flexDirection: "row", minHeight: 0 },
  main: { flex: 1, minWidth: 0 },
  side: { width: 400, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  fill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "var(--win)" as string },
  pane: { flex: 1, padding: 16 },
  note: { paddingHorizontal: 16, paddingBottom: 4 },
});

/** Who a past event was about, in its own words, and when: "Sam Reyes, Tue 9:00 AM". */
function caseOf(whole: Record<string, unknown>, when: string): string {
  const inner = whole?.["input"];
  const payload = inner && typeof inner === "object" ? (inner as Record<string, unknown>) : whole;
  for (const k of ["name", "fullName", "title", "subject", "from", "email", "summary"]) {
    const v = payload?.[k];
    if (typeof v === "string" && v.trim()) return `${v.trim().slice(0, 40)}, ${when}`;
  }
  return `an earlier event, ${when}`;
}
