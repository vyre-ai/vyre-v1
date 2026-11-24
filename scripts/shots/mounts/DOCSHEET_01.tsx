// Mount for lane r42-docs: the New document sheet as the record's Files tab opens it, in each state the walk needs. ?part=templates (the templates for this kind of record), fill (the page filled from the
// record, the missing fields amber, Make waiting), filled (everything typed, Make ready), made (the PDF made, Send for signature offered), none (no templates yet), failed (the list could not be read).
// The query is read after mount (rule 25), so the first frame is empty and the client draws the same one.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { DocumentSheet } from "../../../apps/app/src/places/files/document/DocumentSheet.tsx";
import { initial, step } from "../../../apps/app/src/places/files/document/model.ts";
import type { DocState, Preview, TemplateRow } from "../../../apps/app/src/places/files/document/model.ts";

export const title = "New document";

const AGREEMENT: TemplateRow = { fileId: "fil_a", name: "Service agreement.md", fields: 4, recordType: "customer" };
const NDA: TemplateRow = { fileId: "fil_b", name: "Mutual NDA.docx", fields: 3 };
const OFFER: TemplateRow = { fileId: "fil_c", name: "Statement of work.docx", fields: 6, recordType: "customer" };
const LIST = [AGREEMENT, NDA, OFFER];

/** A line of the page with the words that came from the record marked, found by their text. */
function marked(
  text: string,
  parts: [string, string][],
): { text: string; filled: { from: number; to: number; field: string }[] } {
  return {
    text,
    filled: parts.map(([w, field]) => ({ from: text.indexOf(w), to: text.indexOf(w) + w.length, field })),
  };
}

const PREVIEW: Preview = {
  fields: [
    { name: "firm.name", kind: "text", required: true },
    { name: "client.name", kind: "text", required: true },
    { name: "client.email", kind: "text", required: true },
    { name: "matter.fee", kind: "money", required: true },
    { name: "signing_date", kind: "date", required: true },
  ],
  excerpt: [
    { text: "Service agreement", filled: [] },
    marked("This agreement is between Northwind Traders and ______, dated 19 November 2026.", [
      ["Northwind Traders", "firm.name"],
      ["19 November 2026", "signing_date"],
    ]),
    { text: "The fee is ______ for the first year.", filled: [] },
  ],
  missing: ["client.name", "matter.fee"],
  signers: ["client", "firm"],
  problems: [],
};

function stateOf(part: string): DocState {
  const list = step(initial(), { t: "templates", list: LIST });
  if (part === "none") return step(initial(), { t: "templates", list: [] });
  if (part === "failed")
    return step(initial(), { t: "templates_failed", error: "The Space did not answer. Try again." });
  if (part === "templates") return list;
  let s = step(list, { t: "pick", template: AGREEMENT, today: "2026-11-19" });
  const token = s.phase === "fill" ? s.token : 0;
  s = step(s, { t: "previewed", token, preview: PREVIEW });
  if (part === "fill") return s;
  s = step(s, { t: "edit", name: "client.name", value: "Imran Ibarra" });
  s = step(s, { t: "edit", name: "matter.fee", value: "1500" });
  if (part === "filled") return s;
  return {
    phase: "made",
    templates: LIST,
    template: AGREEMENT,
    made: { fileId: "fil_9", name: "Service agreement - Ibarra.pdf", signers: ["client", "firm"] },
  };
}

const call = async (): Promise<unknown> => ({});

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => {
    setPart(
      new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ??
        "fill",
    );
  }, []);
  return (
    <View style={{ height, backgroundColor: "var(--win)" as string }}>
      {part ? (
        <DocumentSheet
          key={part}
          call={call}
          recordId="rec_1"
          recordType="customer"
          folderId="fld_1"
          today="2026-11-19"
          start={stateOf(part)}
          onClose={() => undefined}
          onOpen={() => undefined}
          onSign={() => undefined}
        />
      ) : null}
    </View>
  );
}
