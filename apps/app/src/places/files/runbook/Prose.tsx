// The words of a note or a runbook between its blocks. They are drawn by the chat's block renderer (ui/stream), so a table, a checklist, a callout or a chart in a note reads the same as in a reply. With `links`, the file
// names, [[links]] and paths in the words are links that open the file in a tab.
import type { ReactElement } from "react";
import { MarkdownText } from "../../../../../../ui/src/stream/index.ts";
import { splitRefs, withFileLinks } from "../../../../../../ui/src/Viewer/index.tsx";
import type { FileLinks } from "../../../../../../ui/src/Viewer/index.tsx";

export function Prose({ text, links }: { text: string; links?: FileLinks | undefined }): ReactElement {
  return <MarkdownText text={text} {...(links ? { renderText: (t: string) => withFileLinks(splitRefs(t), links) } : {})} />;
}
