// The Records data context (sidebar and views) built from the Space's runtime. Lists the screens declare come through the screen hooks; the table's capabilities through capLive.
import type { RecordsData } from "../../places/records/sidebar/index.ts";
import { capLive, nameLookup } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

export function recordsData(rt: ShellRuntime): RecordsData {
  return {
    screens: rt.screens,
    live: (cap, input) => capLive(rt, cap, input as Record<string, unknown>),
    call: rt.call,
    connection: rt.connection,
    nameOf: nameLookup(rt),
    nav: {
      openRecord: (recordId) => rt.open({ subject: { type: "record", id: recordId } }),
      openRecordTypes: () => rt.open({ screen: "records.types" }),
      openSchemaMap: () => rt.open({ screen: "records.schema-map" }),
    },
  };
}
