// F9 stand-in. The place paints `text` in a box labelled `label`.

import type { Density, DiffTabProps } from "./props.ts";

export const DIFF_TAB_LABEL = "DiffTab";

export interface LabelledPlaceholder {
  label: typeof DIFF_TAB_LABEL;
  text: string;
  density: Density;
}

export function DiffTabPlaceholder(props: DiffTabProps): LabelledPlaceholder {
  const text = `${DIFF_TAB_LABEL} ${props.density}: ${props.title}, ${props.files.length} files, ${props.layout}`;
  return { label: DIFF_TAB_LABEL, text, density: props.density };
}
