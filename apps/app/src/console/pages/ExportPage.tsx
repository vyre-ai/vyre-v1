// Console > Data > Export: Export everything (one zip, the Space owner), what it holds and what it never holds, and Records only (one record type as a spreadsheet, for whoever may export records).
import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Lead, Section } from "../shell/ui.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { Actions, Button, Download, Note, Select, useAction, useFileDownload, useRead } from "./shared.tsx";
import { SpaceExport } from "./SpaceExport.tsx";

export const INCLUDED: readonly (readonly [string, string, string])[] = [
  ["records", "Records", "doc"], ["files", "Files", "box"], ["memory", "Space and project memory", "learn"], ["automations", "Automations", "bolt"], ["settings", "Settings", "gear"],
];
export const NEVER: readonly (readonly [string, string])[] = [["chats", "Private chats"], ["memory", "Personal memory"], ["secrets", "Secret values"]];
const FORMATS = [{ key: "csv", title: "CSV" }, { key: "xlsx", title: "Excel" }] as const;

function RecordsOnly(): ReactElement {
  const types = useRead<CapMap["schema.describe"]["out"]>("schema.describe");
  const [open, setOpen] = useState(false), [type, setType] = useState(""), [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const download = useFileDownload();
  const action = useAction(() => undefined);
  const chosen = type || types.data?.types[0]?.key || "";
  return (
    <Section title="Export records">
      <Group>
        <Row id="export-records" title="Records only" note="Needs the Export permission" leading={<Lead><Glyph name="doc" size={16} color="var(--ink-3)" /></Lead>}
          trailing={<Button label="Export…" testID="export-records-open" onPress={() => setOpen(!open)} />} />
        {open ? (
          <View testID="export-records-form">
            <Select label="Record type" value={chosen} options={(types.data?.types ?? []).map((t) => ({ key: t.key, title: t.title }))} onChange={setType} />
            <Select label="Format" value={format} options={FORMATS.map((f) => ({ key: f.key, title: f.title }))} onChange={(v) => setFormat(v === "xlsx" ? "xlsx" : "csv")} />
            <Actions>
              <Button label="Export records" testID="export-records-go" disabled={!chosen || action.busy} why={!chosen ? "No record types yet" : undefined}
                onPress={() => void action.run<CapMap["records.export"]["out"]>("records.export", { type: chosen, format }, async (out) => { await download.read(out.fileId); return "The export is ready."; })} />
            </Actions>
            {download.url ? <Download url={download.url} name={download.name} label="Download" /> : null}
          </View>
        ) : null}
      </Group>
      {action.note ? <Note>{action.note}</Note> : null}
    </Section>
  );
}

export function ExportPage(): ReactElement {
  const types = useRead<CapMap["schema.describe"]["out"]>("schema.describe");
  const count = types.data?.types.length;
  return (
    <View testID="console-export">
      <SpaceExport />
      <Section title="Included">
        <Group testID="export-included">
          {INCLUDED.map(([key, title, icon]) => <Row key={key} id={`export-in-${key}`} title={title} {...(key === "records" && count !== undefined ? { note: `${count} record ${count === 1 ? "type" : "types"}` } : {})} leading={<Lead><Glyph name={icon} size={16} color="var(--ink-3)" /></Lead>} />)}
        </Group>
      </Section>
      <Section title="Never included">
        <Group testID="export-never">
          {NEVER.map(([key, title]) => <Row key={key} id={`export-out-${key}`} title={title} note="Left out" leading={<Lead><Glyph name="lock" size={16} color="var(--ink-3)" /></Lead>} />)}
        </Group>
      </Section>
      <RecordsOnly />
    </View>
  );
}
