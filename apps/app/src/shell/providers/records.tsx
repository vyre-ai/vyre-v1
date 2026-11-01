// The Records place in the shell (spec 3.6): the sidebar of record types and saved views in the shell's shared place sidebar slot (P-L9d_22), and the open type as a table, board, gallery or list.
// The open type and view are the place's own state (the sidebar chooses, the views follow). On a phone the sidebar is the list and the view opens when a row is chosen. Before the Space's runtime
// exists the place draws its loading frames.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import { SCHEMA_PAGE } from "../../places/records/typeedit/index.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import { AskPane, ASK_CLOSED, askPaneReduce, makeAskVyre } from "../../places/records/askpane/index.ts";
import { RecordsAssistant } from "./records-ask.tsx";
import { RecordShareSheet } from "../../places/records/sharing/index.ts";
import type { RecordsShare, ShareTarget } from "../../places/records/sidebar/index.ts";
import { useDirectory } from "./automations-parts.tsx";

const SIDEBAR_W = 240;

/** May this person change record types and fields? In a Personal Space its owner may; in a Team Space the same permission the Console asks (schema.manage), read as whether the Console lists its Schema page for them. */
export function useCanEditSchema(rt: ShellRuntime | null): boolean {
  const [can, setCan] = useState(false);
  const personal = rt?.space.kind === "personal";
  useEffect(() => {
    if (!rt || personal) return;
    let live = true;
    void rt.call("console.nav", {}).then((out) => { if (live) setCan((out as { groups: Array<{ pages: Array<{ key: string }> }> }).groups.some((g) => g.pages.some((pg) => pg.key === SCHEMA_PAGE))); }, () => { if (live) setCan(false); });
    return () => { live = false; };
  }, [rt, personal]);
  return personal ? true : can;
}

function RecordsBody({ rt, canEdit }: { rt: ShellRuntime; canEdit: boolean }): ReactElement {
  const { target, opened } = usePlaceHash();
  const id = useOpenedId(["record", "contact", "project"], ["recordId", "projectId"]);
  const { state, dispatch } = useRecordsState();
  // Record types and the Schema map are screens of this place: the sidebar's two rows write their screen id to the hash, and choosing a type in the sidebar gives the body back to the views.
  const schemaView = target.screen === "records.types" ? "types" : target.screen === "records.schema-map" ? "map" : null;
  const previousType = useRef(state.type);
  useEffect(() => {
    if (previousType.current !== state.type && (id || schemaView)) opened({});
    previousType.current = state.type;
  }, [state.type, id, schemaView, opened]);
  // Ask Vyre opens a pane beside the page, in this tab; it never goes to Chats.
  const [pane, ask] = useReducer(askPaneReduce, ASK_CLOSED);
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
      // structure is edited in the Console, at Data > Schema
      openConsole: (type) => rt.open({ screen: "console.schema", ...(type ? { args: { type } } : {}) }),
    },
    canEdit,
    askVyre: makeAskVyre(ask, { screen: target.screen }),
    copy: (text) => { void (globalThis as { navigator?: { clipboard?: { writeText?(t: string): Promise<void> } } }).navigator?.clipboard?.writeText?.(text); },
  }), [rt, dispatch, opened, canEdit, target.screen]);
  const types = useScreenQuery<CapMap["schema.types.list"]["out"]>(SCREENS.types, "types");
  const type = target.args.type ?? effectiveType(state, typeGroups(types.status === "ready" ? types.data.types : []));
  const data = useMemo(() => {
    const base = recordsData(rt, target.screen, canEdit);
    return { ...base, ...(share ? { share } : {}), askVyre: makeAskVyre(ask, { type, screen: target.screen }), nav: { ...base.nav, openRecord: (recordId: string) => {
      const open = (): void => rt.open({ subject: { type: "record", id: recordId }, args: type ? { type } : {} });
      // an Agents row opens the agent's own page; a row with no agent behind it opens the "not set up" page
      if (type !== "agent") { open(); return; }
      void agentOfRecord(rt.call, recordId).then((r) => { if ("agent" in r) openAgent(rt, r.agent.agentId); else open(); }, open);
    } } };
  }, [rt, type, target.screen, canEdit, share]);
  return <RecordsDataProvider value={data}><View testID="records-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}><RecordsSidebarSlot />{id ? <RecordDetail key={`${id}:${target.args.type ?? ""}`} rt={rt} recordId={id} {...(target.args.type ? { type: target.args.type } : {})} fields={target.screen === "records.record-page" || target.args.recordView === "fields"} tab={target.screen === "records.project-plan" || target.args.tab === "plan" ? "plan" : target.args.tab === "files" ? "files" : target.args.tab === "chat" ? "chat" : "overview"} /> : schemaView ? <SchemaDataProvider value={schema}>{schemaView === "types" ? <RecordTypesList /> : <SchemaMap />}</SchemaDataProvider> : <RecordViews extraKinds={EXTRA_KINDS} {...(target.args.type ? { type: target.args.type } : {})} {...(target.args.kind ? { kind: target.args.kind } : {})} />}{pane.open ? <AskPane about={pane.about} onClose={() => ask({ type: "close" })}><RecordsAssistant rt={rt} about={pane.about} /></AskPane> : null}{sharing ? <RecordShareSheet target={sharing} directory={{ people: directory.people, groups: directory.groups, agents: directory.agents }} onClose={() => setSharing(null)} /> : null}</View></RecordsDataProvider>;
}

export default function RecordsPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const screen = usePlaceHash().target.screen;
  const canEdit = useCanEditSchema(rt);
  const data = useMemo(() => (rt ? recordsData(rt, screen, canEdit) : null), [rt, screen, canEdit]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720;
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
