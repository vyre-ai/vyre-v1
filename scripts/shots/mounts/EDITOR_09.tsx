// Mount for l-editor: a project Overview page in the shared Markdown editor with two live blocks, the "/" menu offering "Live block", and read mode (?mode=read) that keeps the live blocks drawn.
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { MarkdownEditor, liveBlockNode } from "../../../ui/src/RichEditor/index.tsx";

export const title = "Editor live blocks";

const PAGE = [
  "<!--b:blk_a1-->", "# Q4 launch", "",
  "<!--b:blk_b2-->", "The launch is on track. Invoices and open tasks below stay current.", "",
  "<!--b:blk_c3-->", ':::live {"type":"records","spec":{"type":"invoice","title":"Invoices"},"view":"table"}', "",
  "<!--b:blk_d4-->", ':::live {"type":"tasks","spec":{"status":"open"},"view":"list"}', "",
].join("\n");
const ROWS: Record<string, string[][]> = { records: [["INV-104", "Rivera Holdings", "$4,200"], ["INV-105", "Acme Legal", "$1,150"]], tasks: [["Send Josh the meeting link"], ["Review the fee agreement"], ["Book the venue"]] };

export default function Mount() {
  const [q, setQ] = useState<{ mode: string } | null>(null);
  const [v, setV] = useState(PAGE);
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => { setQ({ mode: new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("mode") ?? "edit" }); }, []);
  if (q === null) return <View style={{ flex: 1 }} />;
  return (
    <View style={{ flex: 1, padding: 28 }}>
      <Text testID="md-out" style={{ fontSize: 10, color: "var(--ink-3)", marginBottom: 8 }} numberOfLines={2}>{v.replace(/\n/g, " | ")}</Text>
      <View style={{ maxWidth: 720 }}>
        <MarkdownEditor
          label="Overview" value={v} onChange={setV} mode={q.mode === "read" ? "read" : "edit"} bare
          liveBlockView={(a, ro) => (
            <View testID={`lb-${a.type}`} style={{ borderWidth: 1, borderColor: "var(--line-2)", borderRadius: 10, padding: 10, marginVertical: 6, backgroundColor: "var(--raised)" }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: "var(--ink)" }}>{(a.spec as { title?: string } | null)?.title ?? a.type}{`  ·  ${a.view}${ro ? "" : "  ·  settings"}`}</Text>
              {(ROWS[a.type] ?? [["(unknown block kept as written)"]]).map((r, i) => <Text key={i} style={{ fontSize: 13, color: "var(--ink-2)", paddingVertical: 2 }}>{r.join("   ")}</Text>)}
            </View>
          )}
          suggest={{ trigger: "/", label: "Insert", items: [{ id: "live", label: "Live block", detail: "Tasks, records, goals" }, { id: "h2", label: "Heading" }], onQuery: (s) => setMenu(s), insertNode: (it) => (it.id === "live" ? liveBlockNode("tasks", { status: "open" }, "list") : null) }}
        />
      </View>
      <Text testID="menu-state" style={{ fontSize: 10, color: "var(--ink-3)" }}>{menu === null ? "" : `menu: ${menu}`}</Text>
    </View>
  );
}
