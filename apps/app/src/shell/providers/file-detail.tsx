// The file route reuses the shared viewer over the signed-in Space capability door.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { attemptKey } from "./files-review.ts";
import { States } from "../../../../../ui/src/States/index.tsx";
import { FileViewer } from "../../places/files/viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../../places/files/viewer/data.tsx";
import type { FilesViewerData } from "../../places/files/viewer/data.tsx";
import { nameLookup } from "./records-live.ts";
import { openAsk } from "./ask.ts";
import type { ShellRuntime } from "./runtime.tsx";

export function FileDetail({ rt, fileId }: { rt: ShellRuntime; fileId: string }): ReactElement {
  const [error, setError] = useState("");
  const data = useMemo<FilesViewerData>(() => ({
    call: rt.call, name: nameLookup(rt), clock: rt.clock,
    agents: [{ ...rt.assistant, assistant: true }],
    openFile: (id) => rt.open({ subject: { type: "file", id } }),
    ask: (agentId, _mode, about) => openAsk(rt, agentId, about),
  }), [rt]);
  if (error) return <States kind="error" message={error} retryable onRetry={() => setError("")} />;
  return <FilesViewerDataProvider value={data}><FileViewer key={fileId} fileId={fileId} /></FilesViewerDataProvider>;
}
