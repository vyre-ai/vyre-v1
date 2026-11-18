// A file's page and a record's page, loaded when one is opened (r39). The Chats place shows them in its side pane and its workspace, but a visit that opens a chat never does: statically imported they put the file
// viewer, the editors, the record page and the project page (about a megabyte of the first signed-in download) in front of the first screen.
import { Suspense, lazy } from "react";
import type { ComponentProps, ReactElement } from "react";
import type { FileDetail as FileDetailPage } from "./file-detail.tsx";
import type { RecordDetail as RecordDetailPage } from "./record-detail.tsx";

const File = lazy(() => import("./file-detail.tsx").then((m) => ({ default: m.FileDetail })));
const Record = lazy(() => import("./record-detail.tsx").then((m) => ({ default: m.RecordDetail })));

export function FileDetail(props: ComponentProps<typeof FileDetailPage>): ReactElement {
  return (
    <Suspense fallback={null}>
      <File {...props} />
    </Suspense>
  );
}

export function RecordDetail(props: ComponentProps<typeof RecordDetailPage>): ReactElement {
  return (
    <Suspense fallback={null}>
      <Record {...props} />
    </Suspense>
  );
}
