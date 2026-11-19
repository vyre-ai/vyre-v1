// Mount for lane r42-docs-editor: the document page in the states the walk needs. ?part=template (blanks as chips, the picker's Field button), fill (chips read the record, amber for what it lacks),
// suggest (an agent's and a person's suggestions, the pane beside the page, one card open), agent (a draft arriving while the person's caret stays where it is).
// The query is read after mount (rule 25), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { DocController, MarkdownEditor, SuggestionsPane } from "../../../ui/src/RichEditor/index.tsx";
import type { FieldDef } from "../../../ui/src/RichEditor/index.tsx";

export const title = "Document page";

const FIELDS: FieldDef[] = [
  { tag: "firm.name", label: "Firm name", group: "Space" },
  { tag: "client.name", label: "Client name", group: "Customer" },
  { tag: "client.email", label: "Client email", group: "Customer" },
  { tag: "matter.fee", label: "Fee", group: "Customer", detail: "money" },
  { tag: "signing_date", label: "Signing date", group: "Signing", detail: "date" },
];
const TEMPLATE =
  "# Service agreement\n\nThis agreement is between {firm.name} and {client.name}, dated {signing_date}.\n\nThe fee is {matter.fee} for the first year.\n\n{sign:client} || {sign:firm}\n{date:client} || {date:firm}\n";
const T1 = "2026-11-19T09:12:00Z";
const SUGGESTED = `# Service agreement\n\nThis agreement is between Northwind Traders and Imran Ibarra, dated 19 November 2026.\n\nThe fee is {~~$4,000~>$4,800~~}{>>Docs agent|${T1}<<} for the first year{++, payable in two parts++}{>>Imran Ibarra|${T1}<<}.\n\n{--This agreement renews each year.--}{>>Docs agent|${T1}<<}\n`;
const OPENING = "# Service agreement\n\nThis agreement is between Northwind Traders and Imran Ibarra.\n";
const DRAFTED = `${OPENING}\n## Term\n\nThe term is twelve months from the signing date.\n\n## Fee\n\nThe fee is $4,800, payable in two parts.\n`;

const RECORD: Record<string, string | null> = {
  "firm.name": "Northwind Traders",
  "client.name": "Imran Ibarra",
  "client.email": null,
  "matter.fee": null,
  signing_date: "19 November 2026",
};

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  const [part, setPart] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const controller = useMemo(() => new DocController(), []);
  useEffect(() => {
    const p = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "template";
    setPart(p);
    setValue(p === "suggest" ? SUGGESTED : p === "agent" ? OPENING : TEMPLATE);
    if (p === "agent") {
      const t = setTimeout(() => setValue(DRAFTED), 900);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);
  const doc = useMemo(
    () => ({
      fields: FIELDS,
      author: "Imran Ibarra",
      remoteAuthor: "Docs agent",
      controller,
      ...(part === "fill" || part === "suggest" || part === "agent" ? { resolve: (tag: string) => (tag in RECORD ? (RECORD[tag] ?? null) : null) } : {}),
    }),
    [part, controller],
  );
  return (
    <View style={{ height, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {part ? (
          <MarkdownEditor key={part} value={value} onChange={setValue} label="Service agreement" doc={doc} toggle={false} testID="docedit" />
        ) : null}
      </View>
      {part === "suggest" ? (
        <View style={{ width: 320, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string }}>
          <SuggestionsPane controller={controller} />
        </View>
      ) : null}
    </View>
  );
}
