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
  { id: "h", tag: "h1", text: "Referral fee" },
  { id: "p1", tag: "p", text: "Northwind pays a referral fee once, when the matter is signed. The fee is shown on the first invoice." },
  { id: "l1", tag: "li", text: "No fee for family referrals" },
  { id: "l2", tag: "li", text: "Fee is waived when the client came through Maya" },
];
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
const SHEET = { cols: ["Client", "Source", "Fee", "Status"], rows: [["Elena Rivera", "Maya Chen", "$0", "Signed"], ["Omar Haddad", "Referral", "$1,200", "Consult"], ["Ana Ortiz", "Website", "$900", "Intake"], ["Lee Park", "Referral", "$1,500", "Signed"]] } as const;

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
      {kind === "image" ? <Viewer fileId="img2" title="offer-banner.png" kind="image" boxes={BOXES} strokes={STROKES} find={find} ask={ask} {...(tool === "draw" || tool === "comment" ? { tool } : {})} /> : null}
      {kind === "md" ? <Viewer fileId="n-fee" title="Referral fee.md" kind="document" blocks={MD} find={find} ask={ask} /> : null}
      {kind === "code" ? <Viewer fileId="bl-py" title="fee.py" kind="document" blocks={CODE} find={find} ask={ask} /> : null}
      {kind === "csv" ? <Viewer fileId="csv1" title="clients.csv" kind="csv" sheet={SHEET} find={find} ask={ask} /> : null}
      {kind === "plan" ? <Viewer fileId="plan1" title="Intake plan" kind="plan" editing blocks={PLAN} find={find} ask={ask} /> : null}
    </View>
  );
}
