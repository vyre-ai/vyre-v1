// Mount for REDACT_01 (lane l-redact, Redaction for AI, owner 3 Nov): the approved prototype's scenes on the real components. ?view=list (a Redacted folder: badges, "3 files need review"),
// access (the Agent access popover with what is different inside), pdf (the intake form with a selection and the Highlight, Redact, Comment bar), doc (the demand letter: highlights, redactions,
// a redaction inside a highlight, a comment, the hover card), scan (an ER record scan with boxes and Redact an area), find (the retainer with Find things to redact), request (the chat card),
// agent (Preview as agent), newver (a new version that left two redactions unplaced), activity (the file's Activity). The values are made up; every control answers through the stand-in below.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { FilesList } from "../../../apps/app/src/places/files/list/index.ts";
import { createSampleFiles, northwind } from "../../../apps/app/src/places/files/list/sample.ts";
import type { SampleSpace } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import { FileViewer } from "../../../apps/app/src/places/files/viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../../../apps/app/src/places/files/viewer/data.tsx";
import type { FilesViewerData } from "../../../apps/app/src/places/files/viewer/data.tsx";
import type { ViewerData } from "../../../apps/app/src/places/files/viewer/model.ts";
import { RedactRequestCard } from "../../../apps/app/src/places/chats/conversation/redactrequest.tsx";

export const title = "Redaction for AI";

const NOW = Date.UTC(2026, 10, 3, 9, 52, 0);
const MIN = 60_000, DAY = 86_400_000;
const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_lena: "Lena Ortiz", usr_omar: "Omar Haddad", agt_intake: "Intake", agt_docs: "Docs", assistant: "Assistant" };
const name = (id: string): string => NAMES[id] ?? id;

const INTAKE = [
  "# Client intake",
  "Northwind, personal injury, matter CV-2026-04417, Oct 22, 4:10 pm",
  "## Client",
  "Name: Elena Rivera",
  "Date of birth: 03/14/1986",
  "SSN: 512-44-8391",
  "Phone: (415) 555-0161",
  "Email: elena.rivera@fastmail.example",
  "Address: 2217 Alder Street, Apt 4, Oakland, CA 94612",
  "## Incident",
  "Date: September 28, 2026",
  "Where: Coastline Grocery, 410 Harbor Blvd, Oakland",
  "Treated at: Mercy General Hospital, emergency room",
  "Slipped on a wet floor near aisle 7 with no warning sign. Fell on her right knee and wrist. A store employee photographed the spill.",
  "## Contacts",
  "Referred by: Maya Chen",
  "Spouse: Marco Rivera, (415) 555-0178",
].join("\n");
const DEMAND = [
  "# Demand for settlement",
  "Re: claim HM-2026-118734. Your insured: Coastline Grocery, Inc. Our client: Elena Rivera.",
  "Dear Ms. Alvarez,",
  "On September 28, 2026, our client slipped on an unmarked wet floor near aisle 7 of your insured's store at 410 Harbor Blvd. Store video shows the spill sat for 40 minutes before her fall.",
  "She was taken to Mercy General Hospital, where she was diagnosed with a torn meniscus in her right knee and a sprained right wrist. She has since completed 12 sessions of physical therapy with Dr. Amara Okafor.",
  "## Damages",
  "Medical bills: ER visit $6,840, MRI $2,150, physical therapy $3,960, for a total of $12,950. Lost wages: 19 days at $286 a day, $5,434.",
  "We demand $85,000 to settle this claim. This offer stays open for 30 days.",
].join("\n");
const RETAINER = [
  "# Contingency fee agreement",
  "Northwind, matter CV-2026-04417",
  "This agreement is between Northwind (the firm) and Elena Rivera (the client) of 2217 Alder Street, Apt 4, Oakland, CA 94612.",
  "## Fee",
  "The firm's fee is 33⅓% of any recovery before a lawsuit is filed, and 40% after. If there is no recovery, the client owes no fee.",
  "## Costs",
  "The firm advances costs, repaid from the recovery after the fee. A $2,500 cost retainer is held in trust account 4471-0098-2216.",
  "## Contact",
  "The client can be reached at (415) 555-0161 or elena.rivera@fastmail.example.",
  "Signed: Elena Rivera, Oct 23. Lena Ortiz, for Northwind.",
].join("\n");
const PT = [
  "# Physical therapy progress notes",
  "Bayview Physical Therapy, 1450 Bayview Ave, Suite 3",
  "Patient: Elena Rivera. Born March 14, 1986. Kaiser member KP-88213-0475.",
  "Therapist: Dr. Amara Okafor, DPT. Sessions 1 to 12, Oct 1 to Oct 22.",
  "## Progress",
  "Right knee flexion improved from 95° to 125°. Pain went from 6/10 to 2/10. Stairs are still painful.",
  "Elena Rivera went back to work on Oct 20 with limits on standing.",
].join("\n");
const SCAN = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 750"><rect width="1000" height="750" fill="#f3efe6"/><g font-family="Courier New,monospace" fill="#2a2824"><text x="70" y="90" font-size="30" font-weight="700">MERCY GENERAL HOSPITAL</text><text x="70" y="124" font-size="18">Emergency Department, discharge summary</text><rect x="70" y="142" width="860" height="2"/><text x="70" y="196" font-size="24">PATIENT: ELENA RIVERA</text><text x="560" y="196" font-size="24">DOB: 03/14/1986</text><text x="70" y="236" font-size="24">MRN: 00-4471882</text><text x="560" y="236" font-size="24">VISIT: 09/28/2026</text><text x="70" y="306" font-size="21">CHIEF COMPLAINT: R KNEE PAIN AFTER FALL AT A GROCERY STORE.</text><text x="70" y="356" font-size="21">EXAM: SWELLING MEDIAL R KNEE. R WRIST TENDER.</text><text x="70" y="406" font-size="21">IMAGING: X-RAY NEG FOR FRACTURE. MRI ORDERED.</text><text x="70" y="456" font-size="21">DX: SUSPECTED MEDIAL MENISCUS TEAR. R WRIST SPRAIN.</text><text x="70" y="506" font-size="21">DISCHARGED 17:05 WITH SPOUSE, MARCO RIVERA, 415-555-0178.</text><text x="70" y="640" font-size="18">ATTENDING: R. NWOSU, MD</text></g></svg>`)}`;

type Mark = { markId: string; kind: "redact" | "highlight"; shape: "span" | "box" | "range" | "name"; text?: string; occurrence?: number; box?: { x: number; y: number; w: number; h: number }; label?: string; by: string; byAgent?: string; at: number; unplaced: boolean };
type Ev = { id: string; type: string; actor: string; at: number; payload: Record<string, unknown> };
interface Doc { data: ViewerData; marks: Mark[]; unplaced: Mark[]; state: "available" | "reviewed" | "needs_review" | "off"; reviewed?: { by: string; at: number; version: number }; requests: { requestId: string; agentId: string; at: number }[]; events: Ev[]; access: { value: "on" | "redact" | "off"; own: boolean; inherited: "on" | "redact" | "off"; from?: { kind: string; id: string; name: string } }; comments: unknown[] }

const vdata = (id: string, nm: string, kind: ViewerData["file"]["kind"], mime: string, text: string | undefined, o: Partial<ViewerData> = {}): ViewerData => ({
  file: { fileId: id, folderId: "fld_claim", name: nm, kind, mime, size: 184_000, version: 3, label: 1, ownerId: "usr_irfad", createdAt: NOW - 12 * DAY, updatedAt: NOW - 50 * MIN, updatedBy: "usr_irfad", thumb: false, holds: 0 },
  ...(text !== undefined ? { text } : {}), canEdit: false, canMark: true, canComment: true, pins: 0, ...o,
} as unknown as ViewerData);
const red = (id: string, text: string, label: string, by = "usr_irfad", ago = 11 * MIN, o: Partial<Mark> = {}): Mark => ({ markId: id, kind: "redact", shape: "span", text, label, by, at: NOW - ago, unplaced: false, ...o });
const hl = (id: string, text: string, by: string, ago: number): Mark => ({ markId: id, kind: "highlight", shape: "span", text, by, at: NOW - ago, unplaced: false });
const ev = (id: string, type: string, actor: string, ago: number, payload: Record<string, unknown>): Ev => ({ id, type, actor, at: NOW - ago, payload });
const CLAIM = { kind: "folder", id: "fld_claim", name: "Rivera injury claim" };

function docs(): Map<string, Doc> {
  const m = new Map<string, Doc>();
  m.set("f_intake", {
    data: vdata("f_intake", "Rivera intake form.pdf", "pdf", "application/pdf", INTAKE), state: "reviewed", reviewed: { by: "usr_irfad", at: NOW - 8 * MIN, version: 3 }, requests: [], unplaced: [],
    access: { value: "redact", own: false, inherited: "redact", from: CLAIM },
    marks: [red("m1", "Elena Rivera", "Name", "usr_irfad", 12 * MIN, { occurrence: 0 }), red("m2", "03/14/1986", "Date of birth"), red("m3", "512-44-8391", "SSN"), red("m4", "(415) 555-0161", "Phone"), red("m5", "2217 Alder Street, Apt 4", "Address"),
      red("m7", "elena.rivera@fastmail.example", "Email", "usr_irfad", 10 * MIN), red("m8", "Marco Rivera", "Name", "usr_irfad", 10 * MIN), red("n1", "Rivera", "Name", "usr_irfad", 12 * MIN, { shape: "name" }),
      hl("h1", "Slipped on a wet floor near aisle 7 with no warning sign.", "usr_maya", DAY + 70 * MIN), red("m6", "(415) 555-0178", "Phone", "usr_irfad", 22 * MIN, { byAgent: "assistant" })],
    comments: [{ commentId: "c1", fileId: "f_intake", anchor: { kind: "range", quote: "Mercy General Hospital, emergency room" }, text: "Request the full ER chart, not just the discharge summary.", by: "usr_lena", at: NOW - DAY, resolved: false, mentions: [], replies: [] }],
    events: [
      ev("e1", "file.agent_read", "svc_host", 5 * MIN, { agentId: "agt_intake", redacted: true }), ev("e2", "file.reviewed", "usr_irfad", 8 * MIN, { by: "usr_irfad" }),
      ev("e10", "file.redacted", "usr_irfad", 10 * MIN, { by: "usr_irfad", label: "Email" }), ev("e11", "file.redacted", "usr_irfad", 10 * MIN, { by: "usr_irfad", label: "Name" }), ev("e3", "file.redacted", "usr_irfad", 11 * MIN, { by: "usr_irfad", label: "Date of birth" }), ev("e4", "file.redacted", "usr_irfad", 12 * MIN, { by: "usr_irfad", label: "Name" }),
      ev("e5", "file.redacted", "usr_irfad", 22 * MIN, { by: "usr_irfad", byAgent: "assistant", label: "Phone" }), ev("e6", "file.unredacted", "usr_maya", DAY + 60 * MIN, { by: "usr_maya", label: "Date" }),
      ev("e7", "file.highlighted", "usr_maya", DAY + 70 * MIN, { by: "usr_maya" }), ev("e8", "file.comment_added", "usr_lena", DAY, {}), ev("e9", "file.agent_read", "svc_host", DAY + 2 * 60 * MIN, { agentId: "agt_docs", redacted: true }),
    ],
  });
  m.set("f_demand", {
    data: vdata("f_demand", "Demand letter, draft 2.docx", "document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", DEMAND), state: "reviewed", reviewed: { by: "usr_lena", at: NOW - 70 * MIN, version: 3 }, requests: [], unplaced: [],
    access: { value: "redact", own: false, inherited: "redact", from: CLAIM },
    marks: [hl("h1", "diagnosed with a torn meniscus in her right knee and a sprained right wrist", "usr_lena", 70 * MIN), hl("h2", "Store video shows the spill sat for 40 minutes before her fall.", "usr_lena", DAY), hl("h3", "$85,000", "usr_irfad", 30 * MIN),
      red("m1", "Elena Rivera", "Name", "usr_lena", 72 * MIN), red("m2", "torn meniscus in her right knee", "Medical", "usr_maya", DAY + 30 * MIN), red("m3", "Dr. Amara Okafor", "Name", "usr_lena", 72 * MIN)],
    comments: [{ commentId: "c2", fileId: "f_demand", anchor: { kind: "range", quote: "We demand $85,000" }, text: "Is 85 too high with only 12 PT sessions?", by: "usr_lena", at: NOW - 60 * MIN, resolved: false, mentions: [], replies: [] }],
    events: [],
  });
  m.set("f_retainer", {
    data: vdata("f_retainer", "Rivera retainer.pdf", "pdf", "application/pdf", RETAINER), state: "needs_review", requests: [], unplaced: [], access: { value: "redact", own: false, inherited: "redact", from: CLAIM }, marks: [], comments: [],
    events: [ev("e1", "file.version_added", "usr_lena", DAY, {})],
  });
  m.set("f_scan", {
    data: vdata("f_scan", "Mercy General ER record.pdf", "image", "image/png", undefined, { previewUrl: SCAN } as Partial<ViewerData>), state: "needs_review", requests: [], unplaced: [], access: { value: "redact", own: false, inherited: "redact", from: { kind: "folder", id: "fld_med", name: "Medical records" } },
    marks: [{ markId: "b1", kind: "redact", shape: "box", box: { x: 0.205, y: 0.225, w: 0.2, h: 0.05 }, label: "Name", by: "usr_irfad", at: NOW - 2 * MIN, unplaced: false }, { markId: "b2", kind: "redact", shape: "box", box: { x: 0.615, y: 0.225, w: 0.17, h: 0.05 }, label: "Date of birth", by: "usr_irfad", at: NOW - MIN, unplaced: false }],
    comments: [], events: [],
  });
  m.set("f_pt", {
    data: vdata("f_pt", "Bayview PT notes", "document", "text/markdown", PT), state: "needs_review", requests: [], access: { value: "redact", own: false, inherited: "redact", from: { kind: "folder", id: "fld_med", name: "Medical records" } }, comments: [],
    marks: [red("m1", "Elena Rivera", "Name", "usr_irfad", 12 * DAY), red("m2", "Dr. Amara Okafor", "Name", "usr_irfad", 12 * DAY), red("m3", "KP-88213-0475", "Account number", "usr_irfad", 12 * DAY), red("m4", "Bayview Physical Therapy", "Name", "usr_irfad", 12 * DAY), red("m5", "1450 Bayview Ave, Suite 3", "Address", "usr_irfad", 12 * DAY)],
    unplaced: [red("u1", "03/14/1986", "Date of birth", "usr_irfad", 12 * DAY, { unplaced: true }), red("u2", "(415) 555-0161", "Phone", "usr_irfad", 12 * DAY, { unplaced: true })],
    events: [ev("e1", "file.needs_review", "svc_host", 100 * MIN, { unplaced: 2, version: 3 })],
  });
  return m;
}

const SUGGEST: Record<string, { kind: string; label: string; text: string; count: number }[]> = {
  f_retainer: [
    { kind: "name", label: "Name", text: "Elena Rivera", count: 2 }, { kind: "email", label: "Email with a name in it", text: "elena.rivera@fastmail.example", count: 1 }, { kind: "account", label: "Account or case number", text: "CV-2026-04417", count: 1 }, { kind: "account", label: "Account or case number", text: "4471-0098-2216", count: 1 },
    { kind: "phone", label: "Phone", text: "(415) 555-0161", count: 1 }, { kind: "address", label: "Address", text: "2217 Alder Street, Apt 4", count: 1 },
    { kind: "file_name", label: "Name in the file name", text: "Rivera", count: 1 },
  ],
};
const agentText = (text: string, marks: readonly Mark[]): string => {
  let out = text;
  for (const m of [...marks].filter((x) => x.kind === "highlight" && x.text).sort((a, b) => (b.text!.length - a.text!.length))) out = out.split(m.text!).join(`==${m.text}==`);
  for (const m of [...marks].filter((x) => x.kind === "redact" && x.shape !== "name" && x.text).sort((a, b) => (b.text!.length - a.text!.length))) out = out.split(m.text!).join("[REDACTED]");
  return out;
};

function viewerData(): FilesViewerData {
  const m = docs();
  const need = (id: unknown): Doc => { const d = m.get(String(id)); if (!d) throw new Error("No such file"); return d; };
  let seq = 100;
  return {
    name, clock: () => ({ now: NOW }), agents: [{ id: "assistant", name: "Assistant", assistant: true }, { id: "agt_intake", name: "Intake" }], agentFor: () => "Intake",
    pathOf: (id) => (id === "fld_claim" ? "Projects / Rivera injury claim" : "Projects / Rivera injury claim / Medical records"), ask: () => undefined,
    async call(cap, input) {
      const i = (input ?? {}) as Record<string, unknown>;
      switch (cap) {
        case "files.viewer_data": return need(i["fileId"]).data;
        case "files.comments.list": return { comments: need(i["fileId"]).comments };
        case "files.markup.get": return { strokes: [] };
        case "memory.graph": return { nodes: [], edges: [] };
        case "files.marks.list": { const d = need(i["fileId"]); return { state: d.state, version: 3, ...(d.reviewed ? { reviewed: d.reviewed } : {}), access: d.access, marks: d.marks, unplaced: d.unplaced, names: [], requests: d.requests }; }
        case "files.agent_view": { const d = need(i["fileId"]); return { state: d.state === "needs_review" ? "needs" : "redacted", name: d.marks.some((x) => x.shape === "name" && x.text === "Rivera") ? d.data.file.name.replace("Rivera", "[REDACTED]") : d.data.file.name, path: "Projects/[REDACTED] injury claim", text: agentText(d.data.text ?? "", d.marks) }; }
        case "files.redact.detect": return { suggestions: SUGGEST[String(i["fileId"])] ?? [], textLayer: true, checkedBy: "patterns" };
        case "events.list": { const subj = i["subject"] as { id: string }; return { events: need(subj.id).events.map((e, n) => ({ ...e, seq: n + 1, sv: 1, traceId: "t", depth: 0 })) }; }
        case "files.marks.add": { const t = i["target"] as { id: string }; const d = need(t.id); d.marks.push({ markId: `m${seq++}`, kind: i["kind"] as Mark["kind"], shape: i["shape"] as Mark["shape"], ...(typeof i["text"] === "string" ? { text: i["text"] } : {}), ...(i["box"] ? { box: i["box"] as Mark["box"] } : {}), label: String(i["label"] ?? "Text"), by: "usr_irfad", at: NOW, unplaced: false } as Mark); return { mark: d.marks.at(-1) }; }
        case "files.marks.remove": { for (const d of m.values()) d.marks = d.marks.filter((x) => x.markId !== i["markId"]); return { removed: true }; }
        case "files.marks.place": { for (const d of m.values()) d.unplaced = d.unplaced.filter((x) => x.markId !== i["markId"]); return { ok: true }; }
        case "files.review": { const d = need(i["fileId"]); d.state = "reviewed"; d.reviewed = { by: "usr_irfad", at: NOW, version: 3 }; d.requests = []; return { reviewed: d.reviewed, woke: 1 }; }
        case "files.agent_access.set": return { value: "redact", own: true, inherited: "redact" };
        default: return {};
      }
    },
  };
}

/** After the viewer lands: press a few of its own controls (web), as a person would, so the scene shows the state the prototype shows. */
function useScript(steps: (root: Document) => void, ms = 700): void {
  // once, when the scene first lands
  useEffect(() => { if (typeof document === "undefined") return undefined; const t = setTimeout(() => steps(document), ms); return () => clearTimeout(t); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
}
const click = (d: Document, id: string): void => { (d.querySelector(`[data-testid='${id}']`) as HTMLElement | null)?.click(); };
const selectIn = (d: Document, word: string): void => {
  const blocks = [...d.querySelectorAll("[data-testid^='vw-block-']")] as HTMLElement[];
  for (const b of blocks) {
    const w = d.createTreeWalker(b, 4);
    for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
      const at = n.data.indexOf(word); if (at < 0) continue;
      const r = d.createRange(); r.setStart(n, at); r.setEnd(n, at + word.length);
      const sel = d.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
      b.closest("[data-testid='vw-doc']")?.parentElement?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
  }
};
const hoverMark = (d: Document, sel: string): void => { const el = d.querySelector(sel) as HTMLElement | null; el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); };

function Viewer({ fileId, script }: { fileId: string; script?: (d: Document) => void }): ReactNode {
  const v = useMemo(viewerData, []);
  useScript(script ?? (() => undefined), 900);
  return <FilesViewerDataProvider value={v}><FileViewer fileId={fileId} /></FilesViewerDataProvider>;
}

const claim: SampleSpace = {
  ...northwind,
  folders: [...northwind.folders, { id: "fld_projects", name: "Projects", parent: null, section: "space" }, { id: "fld_claim", name: "Rivera injury claim", parent: "fld_projects", section: "space" },
    { id: "fld_med", name: "Medical records", parent: "fld_claim", section: "space" }, { id: "fld_bill", name: "Billing", parent: "fld_claim", section: "space" }],
  files: [
    ...northwind.files,
    { id: "f_demand", name: "Demand letter, draft 2.docx", folder: "fld_claim", kind: "document", size: 42_000, ago: 80 * MIN, by: "usr_lena" },
    { id: "f_call", name: "Intake call, Oct 22.m4a", folder: "fld_claim", kind: "audio", size: 1_100_000, ago: 12 * DAY, by: "usr_maya" },
    { id: "f_intake", name: "Rivera intake form.pdf", folder: "fld_claim", kind: "pdf", size: 184_000, ago: 12 * DAY, by: "agt_intake" },
    { id: "f_retainer", name: "Rivera retainer.pdf", folder: "fld_claim", kind: "pdf", size: 96_000, ago: DAY, by: "usr_lena" },
  ],
};

function List({ open }: { open: boolean }): ReactNode {
  const narrow = useWindowDimensions().width < 700;   // the phone shows the list alone, as the app does
  const sample = useMemo(() => {
    const s = createSampleFiles(claim);
    s.replica.resolve("files.agent_states" as never, (() => ({
      access: { value: "redact", own: true, inherited: "on", setBy: "usr_irfad", setAt: NOW - 12 * DAY, overrides: [{ kind: "folder", id: "fld_bill", name: "Billing", value: "off" }, { kind: "file", id: "f_mri", name: "knee-mri.png", value: "off" }], files: 6 },
      needs: 3, queue: ["f_retainer", "f_scan", "f_pt"],
      files: [{ fileId: "f_demand", state: "reviewed", own: false }, { fileId: "f_call", state: "reviewed", own: false }, { fileId: "f_intake", state: "reviewed", own: false }, { fileId: "f_retainer", state: "needs_review", own: false, waiting: ["agt_intake"] }],
      folders: [{ folderId: "fld_med", value: "redact", own: false, needs: 2 }, { folderId: "fld_bill", value: "off", own: true, needs: 0 }],
    })) as never);
    return s;
  }, []);
  const data = useMemo(() => ({ ...sample.data, nameOf: name, ...(open ? { accessOpen: true } : {}) }), [sample, open]);
  return (
    <FilesDataProvider value={data}>
      <FilesStateProvider initial={{ where: { kind: "folder", id: "fld_claim" } }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {narrow ? null : <View style={{ width: 240 }}><FilesTree /></View>}
          <FilesList />
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

function Request(): ReactNode {
  const data = useMemo(() => ({ call: async (cap: string) => (cap === "files.marks.list" ? { requests: [{ requestId: "rrq_1" }] } : {}), nameOf: name, nav: { openBeside: () => undefined } as never, changes: undefined } as never), []);
  return (
    <View style={{ flex: 1, padding: 24, gap: 12, backgroundColor: "var(--win)" as string, alignItems: "flex-start" }}>
      <View style={{ alignSelf: "flex-end", maxWidth: 420, backgroundColor: "var(--me)" as string, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 13 }}>
        <ViewText>Summarise the Rivera retainer for Tuesday's consult</ViewText>
      </View>
      <ViewText bold>Intake</ViewText>
      <RedactRequestCard block={{ requestId: "rrq_1", fileId: "f_retainer", name: "Rivera retainer.pdf", agentId: "agt_intake", state: "waiting" }} agent="Intake" data={data} />
    </View>
  );
}
function ViewText({ children, bold }: { children: string; bold?: boolean }): ReactNode { return <Text style={{ color: "var(--ink)" as string, fontSize: 14, fontWeight: bold ? "600" : "400" }}>{children}</Text>; }

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const view = q.get("view") ?? "list";
  const body = view === "access" ? <List open /> : view === "request" ? <Request />
    : view === "pdf" ? <Viewer fileId="f_intake" script={(d) => selectIn(d, "Coastline Grocery")} />
    : view === "doc" ? <Viewer fileId="f_demand" script={(d) => hoverMark(d, "[data-rdx='1'][data-mark='m2']")} />
    : view === "scan" ? <Viewer fileId="f_scan" script={(d) => { click(d, "vw-tool-redact"); click(d, "vw-redact-btn"); }} />
    : view === "find" ? <Viewer fileId="f_retainer" script={(d) => { click(d, "vw-redact-btn"); setTimeout(() => click(d, "rx-find"), 250); }} />
    : view === "agent" ? <Viewer fileId="f_intake" script={(d) => { click(d, "vw-redact-btn"); setTimeout(() => click(d, "rx-preview"), 250); }} />
    : view === "newver" ? <Viewer fileId="f_pt" script={(d) => click(d, "vw-redact-btn")} />
    : view === "activity" ? <Viewer fileId="f_intake" script={(d) => click(d, "vw-activity-btn")} />
    : <List open={false} />;
  return <View style={{ flex: 1, minHeight: 0 }} testID={`redact-${view}`}>{body}</View>;
}

// The page reads its query after it is live (rule 25).
export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
