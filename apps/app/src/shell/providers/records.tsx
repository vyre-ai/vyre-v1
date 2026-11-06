// The Records place in the shell (spec 3.6): the sidebar of record types and saved views in the shell's shared place sidebar slot (P-L9d_22), and the open type as a table, board, gallery or list.
// The open type and view are the place's own state (the sidebar chooses, the views follow). On a phone the sidebar is the list and the view opens when a row is chosen. Before the Space's runtime
// exists the place draws its loading frames.
import { isPhoneWidth } from "../../../../../ui/src/SidePane/layout.ts";
import { isProjectTab } from "../../places/records/projectpage/tabs.ts";
import { adminTarget } from "./settings-admin.ts";
import { useConsolePages } from "../reach/viewer.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebarSlot, RecordsStateProvider, SidebarLoading } from "../../places/records/sidebar/index.ts";
import { TableLoading } from "../../places/records/table/index.ts";
import { usePlaceHash, useOpenedId } from "../hash/context.tsx";
import { RecordDetail } from "./record-detail.tsx";
import { agentOfRecord, openAgent } from "./agent-record.tsx";
import { useRecordsState } from "../../places/records/sidebar/state.tsx";
import { useScreenQuery } from "../../places/records/sidebar/data.tsx";
import { SCREENS, effectiveType, typeGroups } from "../../places/records/sidebar/model.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import type { ShellRuntime } from "./runtime.tsx";
import { RecordViews } from "../../places/records/views-a/index.ts";
import { EXTRA_KINDS } from "../../places/records/views-b/index.tsx";
import { RecordTypesList, SchemaDataProvider, SchemaMap } from "../../places/records/schemamap/index.ts";
import type { SchemaData } from "../../places/records/schemamap/index.ts";
import { recordsData } from "./records-data.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import { ASK_SCOPE, makeAskVyre, openRecordsAsk } from "../../places/records/askpane/index.ts";
import type { AskPaneAction } from "../../places/records/askpane/index.ts";
import { closeAskPane, openAskPane } from "../ask/pane.ts";
import { SyncPage, editMappingOpening } from "../../places/records/sync/index.ts";
import { RecordShareSheet } from "../../places/records/sharing/index.ts";
import type { RecordsShare, ShareTarget } from "../../places/records/sidebar/index.ts";
import { useDirectory } from "./automations-parts.tsx";

const SIDEBAR_W = 240;

/** May this person change record types and fields? In a Personal Space its owner may; in a Team Space the same permission the Console asks (schema.manage), read as whether the Console lists its Schema page for them. */
export function useCanEditSchema(rt: ShellRuntime | null): boolean {
  const pages = useConsolePages(rt);
  return rt?.space.kind === "personal" ? true : pages?.has("schema") === true;
}

/** May this person manage connections (the Sync page's buttons, Edit mapping, Remove)? A member sees the dot and nothing more. connectors.list needs the permission, so its answer is the test. */
export function useCanManageSync(rt: ShellRuntime | null): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    if (!rt || rt.plainRole === true) return;   // a Member or Guest holds no connectors.manage: nothing to ask
    let live = true;
    void rt.call("connectors.list", { limit: 1 }).then(() => { if (live) setCan(true); }, () => { if (live) setCan(false); });
    return () => { live = false; };
  }, [rt]);
  return can;
}

function RecordsBody({ rt, canEdit }: { rt: ShellRuntime; canEdit: boolean }): ReactElement {
  const { target, opened } = usePlaceHash();
  const id = useOpenedId(["record", "contact", "project"], ["recordId", "projectId"]);
  const { state, dispatch } = useRecordsState();
  // Record types and the Schema map are screens of this place: the sidebar's two rows write their screen id to the hash, and choosing a type in the sidebar gives the body back to the views.
  const schemaView = target.screen === "records.types" ? "types" : target.screen === "records.schema-map" ? "map" : null;
  // the Sync page of a synced type is a screen of this place too
  const syncType = target.screen === "records.sync" ? target.args.type ?? null : null;
  const previousType = useRef(state.type);
  useEffect(() => {
    if (previousType.current !== state.type && (id || schemaView || syncType)) opened({});
    previousType.current = state.type;
  }, [state.type, id, schemaView, syncType, opened]);
  // Ask Vyre opens the shared pane beside the page, in this tab; it never goes to Chats. The record type's name is read when the button is pressed.
  const typeTitle = useRef<(key: string) => string | undefined>(() => undefined);
  const ask = useCallback((a: AskPaneAction): void => {
    if (a.type === "close") closeAskPane("records");
    else openRecordsAsk(a.about, a.about.type ? typeTitle.current(a.about.type) : undefined);
  }, []);
  // Sharing: a Team Space only (a Personal Space has no one to share with). The sheet is the Files Share sheet with the Records line on top.
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const directory = useDirectory(rt);
  const team = rt.space.kind !== "personal";
  const share = useMemo<RecordsShare | undefined>(() => (team ? { open: setSharing } : undefined), [team]);
  const schema = useMemo<SchemaData>(() => ({
    screens: rt.screens,
    call: rt.call,
    nav: {
      openType: (key) => { dispatch({ type: "open", key }); opened({}); },
      // structure is edited in the Console, at Data > Schema: the door is there only for a person who can open that page (canEdit is console.nav listing it)
      ...(rt.space.kind !== "personal" && canEdit ? { openConsole: (type?: string) => rt.open(adminTarget("console.schema", type ? { type } : {})) } : {}),
    },
    canEdit,
    askVyre: makeAskVyre(ask, { screen: target.screen }),
    copy: (text) => { void (globalThis as { navigator?: { clipboard?: { writeText?(t: string): Promise<void> } } }).navigator?.clipboard?.writeText?.(text); },
  }), [rt, dispatch, opened, canEdit, target.screen]);
  const types = useScreenQuery<CapMap["schema.types.list"]["out"]>(SCREENS.types, "types");
  const type = target.args.type ?? effectiveType(state, typeGroups(types.status === "ready" ? types.data.types : []));
  typeTitle.current = (key) => (types.status === "ready" ? types.data.types.find((x) => x.key === key)?.plural : undefined);
  const canSync = useCanManageSync(rt);
  const data = useMemo(() => {
    const base = recordsData(rt, target.screen, canEdit);
    const { openSync, bringInCrm, ...plainNav } = base.nav;
    const nav = canSync ? base.nav : plainNav;
    void openSync; void bringInCrm;
    return { ...base, ...(share ? { share } : {}), askVyre: makeAskVyre(ask, { type, screen: target.screen }), nav: { ...nav, openAgent: (agentId: string) => openAgent(rt, agentId), openRecord: (recordId: string) => {
      const open = (): void => rt.open({ subject: { type: "record", id: recordId }, args: type ? { type } : {} });
      // an Agents row opens the agent's own page; a row with no agent behind it opens the "not set up" page
      if (type !== "agent") { open(); return; }
      void agentOfRecord(rt.call, recordId).then((r) => { if ("agent" in r) openAgent(rt, r.agent.agentId); else open(); }, open);
    } } };
  }, [rt, type, target.screen, canEdit, canSync, share]);
  return <RecordsDataProvider value={data}><View testID="records-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}><RecordsSidebarSlot />{id ? <RecordDetail key={`${id}:${target.args.type ?? ""}`} rt={rt} recordId={id} {...(target.args.type ? { type: target.args.type } : {})} fields={target.screen === "records.record-page" || target.args.recordView === "fields"} tab={target.screen === "records.project-plan" ? "plan" : isProjectTab(target.args.tab) ? target.args.tab : "overview"} /> : schemaView ? <SchemaDataProvider value={schema}>{schemaView === "types" ? <RecordTypesList /> : <SchemaMap />}</SchemaDataProvider> : syncType ? <SyncPage key={syncType} type={syncType} call={rt.call} title={(types.status === "ready" ? types.data.types.find((x) => x.key === syncType)?.plural : undefined) ?? syncType} nav={{ openRecords: (ty) => { dispatch({ type: "open", key: ty }); opened({}); }, editMapping: (a) => openAskPane({ thing: { kind: ASK_SCOPE, id: `sync:${a.type}`, title: `How ${a.type} syncs` }, first: editMappingOpening(a) }, "records"), closed: () => opened({}) }} canManage /> : <RecordViews extraKinds={EXTRA_KINDS} {...(target.args.type ? { type: target.args.type } : {})} {...(target.args.kind ? { kind: target.args.kind } : {})} />}{sharing ? <RecordShareSheet target={sharing} directory={{ people: directory.people, groups: directory.groups, agents: directory.agents }} spaceName={rt.space.name} meId={rt.me.id} onClose={() => setSharing(null)} /> : null}</View></RecordsDataProvider>;
}

export default function RecordsPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const screen = usePlaceHash().target.screen;
  const canEdit = useCanEditSchema(rt);
  const data = useMemo(() => (rt ? recordsData(rt, screen, canEdit) : null), [rt, screen, canEdit]);
  const width = useWindowDimensions().width;
  const phone = isPhoneWidth(width);
  if (!data) {
    return (
      <View testID="records-place-loading" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        {phone ? null : <View style={{ width: SIDEBAR_W }}><SidebarLoading /></View>}
        <TableLoading />
      </View>
    );
  }
  return (
    <RecordsDataProvider value={data}>
      <RecordsStateProvider>
        <RecordsBody rt={rt!} canEdit={canEdit} />
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}
