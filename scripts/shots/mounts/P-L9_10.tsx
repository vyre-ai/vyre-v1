// Mount for P-L9_10: the Viewer over the prototype's sample files. Query (read after mount, ruling 25): ?kind=image|md|csv|code|plan, ?find=text, ?tool=draw|comment.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Viewer } from "../../../ui/src/Viewer/index.tsx";
import type { DocBlock, MarkupBox } from "../../../ui/src/Viewer/index.tsx";

export const title = "Viewer";

const BOXES: readonly MarkupBox[] = [{ id: "b1", x: 0.08, y: 0.32, w: 0.44, h: 0.32, text: "Is this offer still live?" }];
const STROKES = [{ points: [[0.12, 0.7], [0.2, 0.74], [0.3, 0.72], [0.38, 0.76]] as const }];
const MD: readonly DocBlock[] = [
  { id: "meta", tag: "meta", text: "kind\tdecision\nvalid_from\t2026-10-03\nlearned\t2026-10-08 2:02 pm\nsource\tchat Pricing review, you" },
  { id: "h", tag: "h1", text: "Consult fee" },
  { id: "p1", tag: "p", text: "The standard consult fee is **$250**. It was $200 until Oct 8; that fact is closed off, not deleted." },
  { id: "h2a", tag: "h2", text: "Rules" },
  { id: "l1", tag: "li", text: "Referrals from partner firms get the first consult free" },
  { id: "l2", tag: "li", text: "Anyone else: quote $250 and say a person confirms it" },
  { id: "h2b", tag: "h2", text: "Evidence" },
  { id: "l3", tag: "li", text: "[[Pricing landscape]] shows six nearby firms between $0 and $300" },
  { id: "h2c", tag: "h2", text: "Links" },
  { id: "l4", tag: "li", text: "[[Maya Chen]]" },
  { id: "l5", tag: "li", text: "[[Elena Rivera]]" },
];
const DETAILS = {
  rows: [["Path", "Agents / Intake / memory / notes"], ["Kind", "Note"], ["Size", "471 B"], ["Modified", "Oct 22 at 5:40 pm"], ["Made by", "Intake"], ["Version", "v1"]] as const,
  sections: [
    { title: "Remembered facts", count: 3, items: [{ id: "f1", title: "The standard consult fee is $200.", note: "Closed off Oct 8 · from you" }, { id: "f2", title: "The standard consult fee is $250.", note: "Learned Oct 8 · from you" }, { id: "f3", title: "Referrals from partner firms get the first consult free.", note: "Learned Oct 20 · from you" }] },
    { title: "Links to", count: 3, items: [{ id: "k1", title: "Pricing landscape" }, { id: "k2", title: "Maya Chen" }, { id: "k3", title: "Elena Rivera" }] },
  ],
};
const CODE: readonly DocBlock[] = [
  { id: "c1", tag: "code", text: "def fee(matter):" },
  { id: "c2", tag: "code", text: "    if matter.referred_by == \"maya\":" },
  { id: "c3", tag: "code", text: "        return 0" },
  { id: "c4", tag: "code", text: "    return matter.total * 0.1" },
];
const PLAN: readonly DocBlock[] = [
  { id: "p0", tag: "h1", text: "Intake plan" },
  { id: "p1", tag: "h2", text: "Week one" },
  { id: "p2", tag: "li", text: "Run the conflict check before the consult" },
  { id: "p3", tag: "li", text: "Send the engagement letter" },
];
const SHEET = { cols: ["Firm", "Consult", "Free first", "Miles", "Source"], rows: [["Harlow & Price", "$300", "No", "4.2", "harlowprice.example"], ["Grant Legal", "$0", "30 min", "6.8", "grantlegal.example"], ["Meyer Law", "$250", "No", "3.1", "meyerlaw.example"], ["Ortega Partners", "$200", "No", "11.5", "ortegapartners.example"], ["Lane & Co", "n/a", "Call", "9.0", "laneco.example"], ["Whitfield Law", "$250", "No", "14.2", "whitfieldlaw.example"], ["Brook Legal", "$0", "Yes", "8.4", "brooklegal.example"], ["Carver & Diaz", "$275", "No", "5.9", "carverdiaz.example"], ["North Street Law", "$0", "Yes", "7.7", "northstreet.example"]] } as const;
const IMG_SRC = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%201000%20750%22%3E%3Crect%20width%3D%221000%22%20height%3D%22750%22%20fill%3D%22%23F6F5EF%22/%3E%3Crect%20width%3D%221000%22%20height%3D%2295%22%20fill%3D%22%233B5B33%22/%3E%3Ctext%20x%3D%2230%22%20y%3D%2262%22%20font-family%3D%22Georgia%2Cserif%22%20font-size%3D%2234%22%20font-weight%3D%22700%22%20fill%3D%22%23fff%22%3EGrant%20Legal%3C/text%3E%3Ctext%20x%3D%22560%22%20y%3D%2258%22%20font-family%3D%22Arial%22%20font-size%3D%2220%22%20fill%3D%22%23E8F0E4%22%3EPractice%20%20%20Team%20%20%20Pricing%20%20%20Contact%3C/text%3E%3Ctext%20x%3D%2230%22%20y%3D%22190%22%20font-family%3D%22Georgia%2Cserif%22%20font-size%3D%2246%22%20fill%3D%22%23222%22%3EPricing%3C/text%3E%3Crect%20x%3D%2230%22%20y%3D%22235%22%20width%3D%22450%22%20height%3D%22270%22%20rx%3D%2218%22%20fill%3D%22%23fff%22%20stroke%3D%22%23E3E3DC%22/%3E%3Crect%20x%3D%22520%22%20y%3D%22235%22%20width%3D%22450%22%20height%3D%22270%22%20rx%3D%2218%22%20fill%3D%22%23fff%22%20stroke%3D%22%23E3E3DC%22/%3E%3Ctext%20x%3D%2260%22%20y%3D%22300%22%20font-family%3D%22Arial%22%20font-size%3D%2224%22%20fill%3D%22%23555%22%3EInitial%20consultation%3C/text%3E%3Ctext%20x%3D%2260%22%20y%3D%22380%22%20font-family%3D%22Arial%22%20font-size%3D%2246%22%20font-weight%3D%22700%22%20fill%3D%22%233B5B33%22%3EFirst%2030%20minutes%20free%3C/text%3E%3Ctext%20x%3D%22550%22%20y%3D%22300%22%20font-family%3D%22Arial%22%20font-size%3D%2224%22%20fill%3D%22%23555%22%3ERetainer%3C/text%3E%3Ctext%20x%3D%22550%22%20y%3D%22380%22%20font-family%3D%22Arial%22%20font-size%3D%2246%22%20font-weight%3D%22700%22%20fill%3D%22%233B5B33%22%3ECustom%3C/text%3E%3Crect%20x%3D%2230%22%20y%3D%22560%22%20width%3D%22940%22%20height%3D%22140%22%20rx%3D%2218%22%20fill%3D%22%23ECECE6%22/%3E%3Ctext%20x%3D%2260%22%20y%3D%22640%22%20font-family%3D%22Arial%22%20font-size%3D%2226%22%20fill%3D%22%23555%22%3EFirst%2030%20minutes%20free%3C/text%3E%3C/svg%3E";
const SIBS = [{ id: "i1", title: "grant-fees" }, { id: "i2", title: "grant-fees 2" }, { id: "i3", title: "grant-fees 3" }];

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  if (q === null) return <View style={{ flex: 1 }} />;
  const kind = q.get("kind") ?? "image";
  const find = q.get("find") ?? "";
  const tool = q.get("tool");
  const ask = { place: "files", context: { kind: "file", id: "f1", title: "File", access: "edit" as const }, agents: [{ id: "asst", name: "Assistant", assistant: true }, { id: "docs", name: "Docs", role: "Reviews and drafts documents" }], onAsk: () => undefined };
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {kind === "image" ? <Viewer fileId="img2" title="grant-fees.png" src={IMG_SRC} kind="image" kindLabel="PNG" subtitle="Agents / Research / downloads · Research · Yesterday 4:31 pm" agentName="Research" siblings={SIBS} current="i2" boxes={BOXES} strokes={STROKES} find={find} ask={ask} {...(tool === "draw" || tool === "comment" ? { tool } : {})} /> : null}
      {kind === "md" ? <Viewer fileId="n-fee" title="consult-fee.md" kind="document" kindLabel="MD" subtitle="Agents / Intake / memory / notes · Intake · Oct 22" details={DETAILS} detailsOpen blocks={MD} find={find} ask={ask} /> : null}
      {kind === "code" ? <Viewer fileId="bl-py" title="fee.py" kind="document" kindLabel="PY" subtitle="Agents / Billing" blocks={CODE} find={find} ask={ask} /> : null}
      {kind === "csv" ? <Viewer fileId="csv1" title="competitors.csv" kind="csv" kindLabel="CSV" subtitle="Agents / Research / work / done / pricing · Research · Yesterday 4:40 pm" saved={3} edit initialCell={{ r: 2, c: 1 }} sheet={SHEET} find={find} ask={ask} /> : null}
      {kind === "plan" ? <Viewer fileId="plan1" title="Intake plan" kind="plan" kindLabel="PLAN" saved={3} editing blocks={PLAN} find={find} ask={ask} /> : null}
    </View>
  );
}
