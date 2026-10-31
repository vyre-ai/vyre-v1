// The file route reuses the shared viewer over the signed-in Space capability door.
import { useMemo, useState, useSyncExternalStore } from "react";
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
  // Ask is a dropdown of every agent the person can use: their assistant first, then the named agents.
  const live = useSyncExternalStore(rt.principals.subscribe, rt.principals.getSnapshot, rt.principals.getSnapshot);
  const agents = useMemo(() => {
    const others = live.status === "ready" ? live.data.filter((p) => p.kind === "agent" && p.id !== rt.assistant.id).map((p) => ({ id: p.id, name: p.name })) : [];
    return [{ ...rt.assistant, assistant: true }, ...others];
  }, [live, rt.assistant]);
  const data = useMemo<FilesViewerData>(() => ({
    call: rt.call, name: nameLookup(rt), clock: rt.clock,
    agents,
    openFile: (id) => rt.open({ subject: { type: "file", id } }),
    openUrl: (url) => rt.openUrl(url),
    ask: (agentId, _mode, about) => openAsk(rt, agentId, about),
  }), [rt, agents]);
  if (error) return <States kind="error" message={error} retryable onRetry={() => setError("")} />;
  return <FilesViewerDataProvider value={data}><FileViewer key={fileId} fileId={fileId} /></FilesViewerDataProvider>;
}
