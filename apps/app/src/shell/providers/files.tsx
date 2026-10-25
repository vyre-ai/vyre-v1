// The Files place in the shell (spec 3.5): the folder tree beside the list of the open folder, Recent, Shared with me, Trash or Knowledge. Where the list is, the selection and Quick Look are
// the place's own state. On a phone width the tree is a drawer, so only the list shows. Before the Space's runtime exists the place draws its loading frames.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";
import { FilesList, ListLoading } from "../../places/files/list/index.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree, TreeLoading } from "../../places/files/tree/index.ts";
import { filesData } from "./files-data.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";

const TREE_W = 240;

export default function FilesPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const data = useMemo(() => (rt ? filesData(rt) : null), [rt]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720;
  if (!data) {
    return (
      <View testID="files-place-loading" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        {phone ? null : <View style={{ width: TREE_W }}><TreeLoading /></View>}
        <ListLoading />
      </View>
    );
  }
  return (
    <FilesDataProvider value={data}>
      <FilesStateProvider>
        <View testID="files-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: TREE_W }}><FilesTree /></View>}
          <FilesList />
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}
