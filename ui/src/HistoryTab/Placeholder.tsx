// F9 stand-in. The place paints `text` in a box labelled `label`.

import type { Density, HistoryTabProps } from "./props.ts";

export const HISTORY_TAB_LABEL = "HistoryTab";

export interface LabelledPlaceholder {
  label: typeof HISTORY_TAB_LABEL;
  text: string;
  density: Density;
}

export function HistoryTabPlaceholder(props: HistoryTabProps): LabelledPlaceholder {
  const text = `${HISTORY_TAB_LABEL} ${props.density}: ${props.resourceType}, ${props.versions.length} versions`;
  return { label: HISTORY_TAB_LABEL, text, density: props.density };
}
