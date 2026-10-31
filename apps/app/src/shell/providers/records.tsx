// The Records place in the shell (spec 3.6): the sidebar of record types and saved views in the shell's shared place sidebar slot (P-L9d_22), and the open type as a table, board, gallery or list.
// The open type and view are the place's own state (the sidebar chooses, the views follow). On a phone the sidebar is the list and the view opens when a row is chosen. Before the Space's runtime
// exists the place draws its loading frames.
import { useEffect, useMemo, useRef } from "react";
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

const SIDEBAR_W = 240;

function RecordsBody({ rt }: { rt: ShellRuntime }): ReactElement {
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
  const schema = useMemo<SchemaData>(() => ({
    screens: rt.screens,
    call: rt.call,
    nav: {
      openType: (key) => { dispatch({ type: "open", key }); opened({}); },
      // structure is edited in the Console, at Data > Schema
      openConsole: (type) => rt.open({ screen: "console.schema", ...(type ? { args: { type } } : {}) }),
    },
    copy: (text) => { void (globalThis as { navigator?: { clipboard?: { writeText?(t: string): Promise<void> } } }).navigator?.clipboard?.writeText?.(text); },
  }), [rt, dispatch, opened]);
  const types = useScreenQuery<CapMap["schema.types.list"]["out"]>(SCREENS.types, "types");
  const type = target.args.type ?? effectiveType(state, typeGroups(types.status === "ready" ? types.data.types : []));
  const data = useMemo(() => {
    const base = recordsData(rt, target.screen);
    return { ...base, nav: { ...base.nav, openRecord: (recordId: string) => {
      const open = (): void => rt.open({ subject: { type: "record", id: recordId }, args: type ? { type } : {} });
      // an Agents row opens the agent's own page; a row with no agent behind it opens the "not set up" page
      if (type !== "agent") { open(); return; }
      void agentOfRecord(rt.call, recordId).then((r) => { if ("agent" in r) openAgent(rt, r.agent.agentId); else open(); }, open);
    } } };
  }, [rt, type, target.screen]);
  return <RecordsDataProvider value={data}><View testID="records-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}><RecordsSidebarSlot />{id ? <RecordDetail key={`${id}:${target.args.type ?? ""}`} rt={rt} recordId={id} {...(target.args.type ? { type: target.args.type } : {})} fields={target.screen === "records.record-page" || target.args.recordView === "fields"} tab={target.screen === "records.project-plan" || target.args.tab === "plan" ? "plan" : target.args.tab === "files" ? "files" : target.args.tab === "chat" ? "chat" : "overview"} /> : schemaView ? <SchemaDataProvider value={schema}>{schemaView === "types" ? <RecordTypesList /> : <SchemaMap />}</SchemaDataProvider> : <RecordViews extraKinds={EXTRA_KINDS} {...(target.args.type ? { type: target.args.type } : {})} {...(target.args.kind ? { kind: target.args.kind } : {})} />}</View></RecordsDataProvider>;
}

export default function RecordsPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const screen = usePlaceHash().target.screen;
  const data = useMemo(() => (rt ? recordsData(rt, screen) : null), [rt, screen]);
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
        <RecordsBody rt={rt!} />
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}
