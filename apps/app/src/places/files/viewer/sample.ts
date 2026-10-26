// The sample behind the Files Viewer tests and screenshots: four files from the prototype (an image with a marked box, a note, a CSV and a script) answered by an in-memory stand-in for
// the Files capabilities. Writes change what the next read returns, so every control in a mount really works. The values are made up.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { FilesViewerData } from "./data.tsx";
import type { FileComment, ViewerData } from "./model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const MIN = 60_000;

type FileRow = { data: ViewerData; comments: FileComment[]; strokes: CapMap["files.markup.get"]["out"]["strokes"] };

const file = (id: string, name: string, kind: ViewerData["file"]["kind"], mime: string, o: Partial<ViewerData> = {}): ViewerData => ({
  file: { fileId: id, folderId: "fld_brand", name, kind, mime, size: 4_200, version: 3, label: 0, ownerId: "usr_maya", createdAt: SAMPLE_NOW - 9 * 86_400_000, updatedAt: SAMPLE_NOW - 42 * MIN, updatedBy: "usr_maya", thumb: true, holds: 0 },
  canEdit: true, canMark: true, canComment: true, pins: 0, ...o,
});

const PICTURE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 750"><rect width="1000" height="750" fill="#e8ecf4"/><rect x="80" y="240" width="440" height="240" rx="14" fill="#c9d4ee"/><text x="110" y="330" font-family="sans-serif" font-size="46" fill="#33415c">Free consult</text><text x="110" y="390" font-family="sans-serif" font-size="30" fill="#52618a">Book this week</text></svg>')}`;
const NOTE = "# Consult fee\nThe standard consult fee is **$250**. It was $200 until Oct 8.\n## Rules\n- Referrals from partner firms get the first consult free\n- Anyone else: quote $250 and say a person confirms it\n";
const CSV = "Client,Amount,Status\nRivera,$1200,Paid\nChen,$300,Open\nOrtiz,$900,Open\n";
const CODE = 'def fee(matter):\n    if matter.referred_by == "maya":\n        return 0\n    return matter.total * 0.1\n';

export interface SampleViewer {
  data: FilesViewerData;
  calls: { cap: string; input: unknown }[];
  /** the opened files and asks the viewer sent out */
  opened: string[];
  asked: string[];
  rows: Map<string, FileRow>;
  failNext(cap: string, message?: string): void;
}

export function createSampleViewer(): SampleViewer {
  const rows = new Map<string, FileRow>();
  rows.set("f_offer", { data: file("f_offer", "Offer.png", "image", "image/png", { previewUrl: PICTURE, pins: 1 }), strokes: [{ color: "#e5484d", width: 3, points: [[0.12, 0.7], [0.2, 0.74], [0.3, 0.72], [0.38, 0.76]] }], comments: [
    { commentId: "c1", fileId: "f_offer", anchor: { kind: "area", box: { x: 0.08, y: 0.32, w: 0.44, h: 0.32 } }, pin: 1, text: "Is this offer still live?", by: "usr_maya", at: SAMPLE_NOW - 30 * MIN, resolved: false, mentions: [] },
  ] });
  rows.set("f_note", { data: file("f_note", "Consult fee.md", "markdown", "text/markdown", { text: NOTE }), strokes: [], comments: [
    { commentId: "c2", fileId: "f_note", anchor: { kind: "range", quote: "The standard consult fee is **$250**" }, text: "Confirm this with Maya before it goes out.", by: "usr_omar", at: SAMPLE_NOW - 3 * 60 * MIN, resolved: false, mentions: [] },
  ] });
  rows.set("f_fees", { data: file("f_fees", "Fees.csv", "spreadsheet", "text/csv", { text: CSV, canEdit: false }), strokes: [], comments: [] });
  rows.set("f_code", { data: file("f_code", "fee.py", "code", "text/x-python", { text: CODE }), strokes: [], comments: [] });
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const asked: string[] = [];
  const failing = new Map<string, string>();
  let seq = 10;
  const need = (id: unknown): FileRow => { const r = rows.get(String(id)); if (!r) throw new Error("No such file"); return r; };
  const names: Record<string, string> = { usr_maya: "Maya Chen", usr_omar: "Omar Haddad", usr_irfad: "Irfad Imtiaz", agt_intake: "Intake", assistant: "Assistant" };
  const data: FilesViewerData = {
    async call(cap, input) {
      calls.push({ cap, input });
      const why = failing.get(cap);
      if (why !== undefined) { failing.delete(cap); throw new Error(why); }
      const i = input as Record<string, unknown>;
      switch (cap) {
        case "files.viewer_data": return need(i["fileId"]).data;
        case "files.comments.list": return { comments: need(i["fileId"]).comments };
        case "files.markup.get": return { strokes: need(i["fileId"]).strokes };
        case "files.markup.save": need(i["fileId"]).strokes = (i["strokes"] as FileRow["strokes"]); return { ok: true };
        case "files.comments.add": {
          const r = need(i["fileId"]);
          const anchor = i["anchor"] as FileComment["anchor"];
          const pin = anchor.kind === "area" ? r.comments.filter((c) => c.anchor.kind === "area").length + 1 : undefined;
          const comment: FileComment = { commentId: `c${++seq}`, fileId: String(i["fileId"]), anchor, ...(pin ? { pin } : {}), text: String(i["text"]), by: "usr_irfad", at: SAMPLE_NOW, resolved: false, mentions: [] };
          r.comments.push(comment);
          return { comment };
        }
        case "files.comments.resolve": for (const r of rows.values()) for (const c of r.comments) if (c.commentId === i["commentId"]) c.resolved = Boolean(i["resolved"]); return { ok: true };
        case "files.save": {
          const r = need(i["fileId"]);
          if (i["baseVersion"] !== r.data.file.version) throw new Error("Someone else saved this file first. Reload to see it.");
          r.data = { ...r.data, text: String(i["text"]), file: { ...r.data.file, version: r.data.file.version + 1, updatedAt: SAMPLE_NOW } };
          return { file: { version: r.data.file.version } };
        }
        default: throw new Error(`no handler for ${cap}`);
      }
    },
    name: (id) => names[id] ?? id,
    clock: () => ({ now: SAMPLE_NOW }),
    pathOf: () => "Marketing / Brand",
    agents: [{ id: "assistant", name: "Assistant", assistant: true }, { id: "agt_intake", name: "Intake" }],
    ask: (agentId, _mode, about) => void asked.push(`${agentId}:${about.kind}:${about.id}`),
    openFile: (id) => void opened.push(id),
    siblings: () => [{ id: "f_offer", title: "Offer.png" }],
  };
  return { data, calls, opened, asked, rows, failNext: (cap, message = `${cap} failed`) => void failing.set(cap, message) };
}
