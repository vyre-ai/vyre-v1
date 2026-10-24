// Frozen props for ui/RichEditor. ARCH 5.6 and R6, F9.
// One component for the Yjs document. Web and the desktop shell mount
// TipTap. The phone mounts a WebView until a native editor exists.
// `markdown` is the snapshot for search. The doc is the source of truth.

/** Phone layouts pass `compact`. Desktop passes `regular`. ARCH 7.11. */
export type Density = "regular" | "compact";

/** `suggest` is the tracked-change layer. `read` is view access. */
export type RichEditorMode = "edit" | "suggest" | "read";

export interface RichEditorProps {
  docId: string;
  mode: RichEditorMode;
  placeholder: string;
  markdown: string;
  density: Density;
}

export const frozenRichEditorProps = {
  docId: "doc_agent_md",
  mode: "edit",
  placeholder: "Write",
  markdown: "",
  density: "compact",
} as const satisfies RichEditorProps;
