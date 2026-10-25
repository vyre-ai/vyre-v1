// Mount for P-L9_05: ?part=editor (a document with two other people's cursors), ?part=read (read access), ?part=live (TipTap on the same Yjs document).
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Awareness, RichEditor, Y, importMarkdown, sendAwareness, setLocalCursor } from "../../../ui/src/RichEditor/index.tsx";

export const title = "RichEditor";

const DOC = [
  "# Rivera intake notes",
  "",
  "Elena sent the **signed** engagement letter and asked to move the signing to the *30th*. See the [lease](https://example.com/lease).",
  "",
  "- Send Elena a new time today",
  "- Lena reviews the lease the same day",
  "",
  "> Keep every change in the matter record.",
  "",
].join("\n");

export default function Mount() {
  const { part = "editor" } = useLocalSearchParams<{ part?: string }>();
  const doc = useMemo(() => { const d = new Y.Doc(); importMarkdown(d, DOC); return d; }, []);
  const [aware, setAware] = useState<Awareness | null>(null);
  useEffect(() => {
    const me = new Awareness(doc);
    const maya = new Awareness(new Y.Doc());
    const omar = new Awareness(new Y.Doc());
    setLocalCursor(maya, { name: "Maya Chen", color: "#e8590c" }, 60);
    setLocalCursor(omar, { name: "Omar Haddad", color: "#2f9e44" }, 95);
    sendAwareness(maya, me);
    sendAwareness(omar, me);
    setAware(me);
    return () => { me.destroy(); maya.destroy(); omar.destroy(); };
  }, [doc]);
  if (aware === null) return <View style={{ flex: 1 }} />;
  return (
    <View style={{ flex: 1, minHeight: 520 }}>
      <RichEditor
        docId="doc_intake" mode={part === "read" ? "read" : "edit"} placeholder="Write" markdown="" density="regular"
        doc={doc} awareness={aware} header={{ name: "Rivera notes.md", meta: "Projects / Rivera matter \u00b7 Docs \u00b7 Yesterday, 4:16 pm", version: 3, detailsOpen: false, ask: { place: "files", context: { kind: "file", id: "f_notes", title: "Rivera notes.md", access: "edit" }, agents: [{ id: "assistant", name: "Assistant", assistant: true }, { id: "docs", name: "Docs", role: "Writes and files documents" }, { id: "intake", name: "Intake" }], suggested: "docs", onAsk: () => undefined } }} engine={part === "live" ? "tiptap" : "static"} user={{ name: "Irfad Imtiaz", color: "#4c6ef5" }}
      />
    </View>
  );
}
