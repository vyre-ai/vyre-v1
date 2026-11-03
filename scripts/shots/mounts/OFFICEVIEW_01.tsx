// Mount for OFFICEVIEW_01 (lane l-officeview, rc.17): Office files from a SharePoint library in the Files viewer. ?view=docx (a Word engagement letter: headings, bold and italic, nested bullets,
// numbered steps, a fee table with its header, a picture's place, under the DOCX tile with SharePoint's mark and Open in Word), pptx (a deck as slide cards with titles, bullets, a table, a picture
// and speaker notes), locked (a password-protected Word file: the no-preview line with Open in Word). The words are the Markdown the previews module reads from such files.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { FileViewer } from "../../../apps/app/src/places/files/viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../../../apps/app/src/places/files/viewer/data.tsx";
import { createSampleViewer } from "../../../apps/app/src/places/files/viewer/sample.ts";
import type { ViewerData } from "../../../apps/app/src/places/files/viewer/model.ts";

export const title = "Office files in the viewer";

const SHAREPOINT = { mountId: "mnt_sp", provider: "SharePoint" };

const LETTER = [
  "# Engagement letter",
  "Dear Ms Lin, thank you for choosing Salvo Law. This letter sets out the work we will do for you in the sale of **12 Elm Street, Roseville**, and what it costs. Please read it with care: the *closing date* in the contract is ***31 October 2026***.",
  "## Scope of work",
  "- Review the purchase contract and the seller's disclosures\n  - County records and the title report\n  - Permits for the 2019 addition\n- Prepare the deed and the closing statement\n- Attend the closing",
  "## How we will close",
  "1. You sign the engagement letter\n2. We order the title search\n  1. The title company sends its report\n  2. We clear any liens with the seller\n3. You sign at closing and we record the deed",
  "## Fees",
  "| Item | Who pays | Cost |\n| --- | --- | --- |\n| Title search | Buyer | $120 |\n| Deed preparation | Buyer | $350 |\n| Recording \\| county | Buyer | $80 |\n| Closing attendance | Shared | $400 |",
  "[Image: Signature of Dana Salvo]",
  "Questions about this letter? Reply to this email or see [our terms](https://salvolaw.example/terms).",
].join("\n\n");

const DECK = [
  "# Slide 1: Q4 review",
  "Salvo Law, October 2026",
  "# Slide 2: Where the leads come from",
  "- **Search**: 48 leads\n  - Roseville practice page\n  - Sacramento car accident page\n- Referrals: 21 leads\n- Social: 9 leads",
  "Notes: Lead with the number, then the source.\nSearch doubled after the Roseville page went live.",
  "# Slide 3: Cost per lead",
  "| Channel | Spend | Leads | Cost per lead |\n| --- | --- | --- | --- |\n| Search | $2,400 | 48 | $50 |\n| Social | $900 | 9 | $100 |",
  "[Image: Bar chart of cost per lead by channel]",
  "Notes: Social costs twice as much per lead.",
  "# Slide 4: Next quarter",
  "- Move $500 from social to search\n- Add a Folsom practice page\n- Ask every closed client for a review",
].join("\n\n");

type View_ = "docx" | "pptx" | "locked";

function Viewer({ view }: { view: View_ }): ReactNode {
  const s = useMemo(() => {
    const v = createSampleViewer();
    const row = v.rows.get("f_note")!;
    row.comments = [];
    const name = view === "docx" ? "Engagement letter - 12 Elm Street.docx" : view === "pptx" ? "Q4 review.pptx" : "Settlement terms (locked).docx";
    const kind = view === "pptx" ? "presentation" : "document";
    const mime = view === "pptx" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    row.data = { ...row.data, file: { ...row.data.file, name, kind, mime, size: 48_200, source: SHAREPOINT }, text: view === "docx" ? LETTER : view === "pptx" ? DECK : "", pages: view === "pptx" ? 4 : undefined, canEdit: true } as ViewerData;
    const app = view === "pptx" ? "PowerPoint" : "Word";
    const inner = v.data.call;
    return { ...v.data, pathOf: () => "Shared / Client matters", openUrl: () => undefined, call: async (cap: string, input: unknown): Promise<unknown> => (cap === "mounts.file_link" ? { link: { openIn: app, webUrl: "https://firm.sharepoint.com/", type: view === "pptx" ? "powerpoint" : "word", edit: [] } } : inner(cap, input)) };
  }, [view]);
  return <FilesViewerDataProvider value={s}><FileViewer fileId="f_note" /></FilesViewerDataProvider>;
}

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const v = q.get("view");
  const view: View_ = v === "pptx" || v === "locked" ? v : "docx";
  return <View style={{ flex: 1, minHeight: 0 }} testID={`officeview-${view}`}><Viewer view={view} /></View>;
}

// The page reads its query after it is live (rule 25).
export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
