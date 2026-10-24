// F9 stand-in. The place paints `text` in a box labelled `label`.

import type { Density, RichEditorProps } from "./props.ts";

export const RICH_EDITOR_LABEL = "RichEditor";

export interface LabelledPlaceholder {
  label: typeof RICH_EDITOR_LABEL;
  text: string;
  density: Density;
}

export function RichEditorPlaceholder(props: RichEditorProps): LabelledPlaceholder {
  const text = `${RICH_EDITOR_LABEL} ${props.density}: ${props.docId}, ${props.mode}`;
  return { label: RICH_EDITOR_LABEL, text, density: props.density };
}
