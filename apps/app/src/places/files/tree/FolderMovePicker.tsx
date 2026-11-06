// Move a folder: browse the whole folder tree (press a folder to go into it, the path above goes back up) or search every folder by name, then Move Here.
// Reads files.list (the folders of one folder) and files.folder.search; moves with folders.move, the call Files already uses for a drop.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { each } from "../../../shell/sidebar/model.ts";
import { pathInto } from "./model.ts";

export interface FolderMovePickerProps {
  /** The folder being moved: it and everything inside it are never offered. */
  moving: { id: string; name: string };
  call(cap: string, input: unknown): Promise<unknown>;
  onMove(parentId: string | null): void;
  onClose(): void;
}
type Row = { folderId: string; name: string; path?: string };

export function FolderMovePicker({ moving, call, onMove, onClose }: FolderMovePickerProps): ReactElement {
  const [at, setAt] = useState<{ id: string | null; trail: readonly { id: string | null; name: string }[] }>({ id: null, trail: [{ id: null, name: "Top of Files" }] });
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setRows(null); setErr(false);
    const query = q.trim();
    const read = query === ""
      ? call("files.list", at.id === null ? {} : { folder: at.id }).then((o) => (o as { folders?: Row[] } | null)?.folders ?? [])
      : call("files.folder.search", { q: query, scope: "folders", limit: 50 }).then((o) => (o as { folders?: Row[] } | null)?.folders ?? []);
    void read.then((r) => { if (live) setRows(r.filter((f) => f.folderId !== moving.id)); }, () => { if (live) setErr(true); });
    return () => { live = false; };
  }, [at.id, q, call, moving.id]);
  const enter = (f: Row): void => { setQ(""); setAt((a) => ({ id: f.folderId, trail: pathInto(a.trail, a.id, f.folderId, f.name) })); };
  const goTo = (i: number): void => setAt((a) => ({ id: a.trail[i]!.id, trail: a.trail.slice(0, i + 1) }));
  const here = at.trail[at.trail.length - 1]!;
  return (
    <Dialog title={`Move ${moving.name}`} onClose={onClose} testID="folder-move" width={460}
      actions={[{ label: "Cancel", onPress: onClose }, { label: q.trim() === "" ? `Move to ${here.name}` : "Move here", primary: true, disabled: q.trim() !== "", why: "Pick a folder from the search first", onPress: () => onMove(at.id) }]}>
      <TextInput testID="folder-move-search" accessibilityLabel="Search folders" placeholder="Search folders" placeholderTextColor="var(--ink-4)" value={q} onChangeText={setQ} style={st.field} />
      {q.trim() === "" ? (
        <View style={st.trail} testID="folder-move-trail">
          {each(at.trail, (c, i) => <Pressable key={`${c.id ?? "top"}`} accessibilityRole="button" onPress={() => goTo(i)} disabled={i === at.trail.length - 1}><Text style={[st.crumb, i === at.trail.length - 1 && st.crumbOn]}>{i === 0 ? c.name : ` / ${c.name}`}</Text></Pressable>)}
        </View>
      ) : null}
      <ScrollView style={st.list} testID="folder-move-list">
        {err ? <Text style={st.note}>Could not read the folders. Try again.</Text> : rows === null ? <Text style={st.note}>Reading…</Text> : rows.length === 0 ? <Text style={st.note}>{q.trim() === "" ? "No folders here." : "No folder by that name."}</Text>
          : each(rows, (f) => (
            <Pressable key={f.folderId} accessibilityRole="button" accessibilityLabel={`Open ${f.name}`} testID={`folder-move-${f.folderId}`} onPress={() => enter(f)} style={st.row}>
              <Text style={st.name} numberOfLines={1}>{f.name}</Text>{f.path ? <Text style={st.path} numberOfLines={1}>{f.path}</Text> : null}
            </Pressable>
          ))}
      </ScrollView>
    </Dialog>
  );
}

const st = StyleSheet.create({
  field: { height: 36, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, color: "var(--ink)" as string, fontSize: 14 },
  trail: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  crumb: { fontSize: 12.5, color: "var(--ink-3)" as string },
  crumbOn: { color: "var(--ink)" as string, fontWeight: "600" },
  list: { maxHeight: 280, marginTop: 8 },
  row: { height: 36, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center" },
  name: { fontSize: 14, color: "var(--ink)" as string },
  path: { fontSize: 11.5, color: "var(--ink-3)" as string },
  note: { fontSize: 13, color: "var(--ink-3)" as string, paddingVertical: 12, paddingHorizontal: 8 },
});
