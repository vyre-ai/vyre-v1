// Mount for P-L9e_02: a Files file open in the shared Viewer over the sample files. Query (read after mount, ruling 25): ?file=image (default) | md | csv | code, ?pane=side.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { FileViewer } from "../../../apps/app/src/places/files/viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../../../apps/app/src/places/files/viewer/data.tsx";
import { createSampleViewer } from "../../../apps/app/src/places/files/viewer/sample.ts";

export const title = "Files viewer";
const IDS: Record<string, string> = { image: "f_offer", md: "f_note", csv: "f_fees", code: "f_code" };

export default function Mount(): ReactNode {
  const sample = useMemo(() => createSampleViewer(), []);
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  if (!q) return null;
  return (
    <FilesViewerDataProvider value={sample.data}>
      <View style={{ flex: 1, height: "100%" as unknown as number, backgroundColor: "var(--win)" as string }}>
        <FileViewer fileId={IDS[q.get("file") ?? "image"] ?? "f_offer"} pane={q.get("pane") === "side" ? "side" : "main"} />
      </View>
    </FilesViewerDataProvider>
  );
}
