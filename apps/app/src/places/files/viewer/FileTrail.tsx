// Where an open file is and the way out of it: a Back arrow and the path (the same Breadcrumb as the folder list), above the viewer. The path is the place the person came from (Recent, Starred,
// Shared with me, Trash, Knowledge) or the file's folders; a folder the person may not open is words, never a link. Back returns to the list as it was (the Files state keeps the place,
// the folder, the selection and the sort; the list keeps its scroll). Esc does the same when nothing else holds it: a field, a menu or dialog, a markup tool (taken first by the Viewer).
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Breadcrumb, HeadIcon } from "../Toolbar.tsx";
import type { Crumb } from "../Toolbar.tsx";
import { useFilesData, useFolderNodes } from "../tree/data.tsx";
import { useFilesState } from "../tree/state.tsx";
import { WHERE_LABEL, crumbs } from "../tree/model.ts";
import type { Where } from "../tree/model.ts";

const PLACE = "place:";

/** The crumbs above an open file. `nodes` is the folders the person can see; `file` null while it loads. */
export function fileTrail(
  where: Where,
  nodes: readonly { id: string; name: string; parentId: string | null }[],
  file: { name: string; folderId: string } | null,
): Crumb[] {
  const out: Crumb[] = [];
  if (where.kind !== "folder") {
    out.push({ key: where.kind, name: WHERE_LABEL[where.kind], id: `${PLACE}${where.kind}` });
  } else {
    out.push({ key: "root", name: "Files", id: null });
    const chain = file ? crumbs(nodes, file.folderId) : [];
    // the folders above the file the person can see; when the first of them has a parent they cannot see, the trail starts there
    for (const f of chain) out.push({ key: f.id, name: f.name, id: f.id });
    // a file in a folder the person cannot see (shared to them, a chat card): nothing to link to between Files and the file
  }
  out.push({ key: "file", name: file?.name ?? "" });
  return out;
}

/** True when an Escape key press should leave the file: nothing else took it (a field, a menu or dialog, a markup tool already took it with preventDefault). */
export function escapeLeaves(e: {
  key: string;
  defaultPrevented: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}): boolean {
  if (e.key !== "Escape" || e.defaultPrevented) return false;
  const tag = (e.target?.tagName ?? "").toUpperCase();
  return !(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable === true);
}

export function FileTrail({ fileId, onBack }: { fileId: string; onBack(): void }): ReactElement {
  const data = useFilesData();
  const { state, dispatch } = useFilesState();
  const nodes = useFolderNodes();
  const [file, setFile] = useState<{ name: string; folderId: string } | null>(null);
  useEffect(() => {
    let live = true;
    setFile(null);
    void (data.call("files.get", { fileId }) as Promise<{ file: { name: string; folderId: string } }>).then(
      (r) => live && setFile({ name: r.file.name, folderId: r.file.folderId }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data, fileId]);
  useEffect(() => {
    const doc = (
      globalThis as {
        document?: {
          addEventListener(t: string, f: (e: KeyboardEvent) => void): void;
          removeEventListener(t: string, f: (e: KeyboardEvent) => void): void;
          querySelector(q: string): unknown;
        };
      }
    ).document;
    if (doc === undefined) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (!escapeLeaves(e as never)) return;
      if (doc.querySelector('[role="menu"],[role="dialog"],[aria-modal="true"]') !== null) return;
      onBack();
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [onBack]);
  const visible = nodes.status === "ready" ? nodes.data : [];
  const trail = fileTrail(state.where, visible, file).map((c) =>
    // a folder the person cannot open (it is not in the folders they can see) is words
    c.id !== undefined && c.id !== null && !c.id.startsWith(PLACE) && !visible.some((n) => n.id === c.id)
      ? { ...c, plain: true }
      : c,
  );
  const go = (id: string | null): void => {
    if (id !== null && id.startsWith(PLACE)) dispatch({ type: "go", where: { kind: id.slice(PLACE.length) } as Where });
    else dispatch({ type: "go", where: { kind: "folder", id } });
    onBack();
  };
  return (
    <View style={s.bar} testID="file-trail">
      <HeadIcon icon="back" label="Back" testID="file-back" onPress={onBack} />
      <Breadcrumb crumbs={trail} onGo={go} />
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 40 },
});
