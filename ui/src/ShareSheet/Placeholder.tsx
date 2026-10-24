// F9 stand-in. The place paints `text` in a box labelled `label`.

import type { Density, ShareSheetProps } from "./props.ts";

export const SHARE_SHEET_LABEL = "ShareSheet";

export interface LabelledPlaceholder {
  label: typeof SHARE_SHEET_LABEL;
  text: string;
  density: Density;
}

export function ShareSheetPlaceholder(props: ShareSheetProps): LabelledPlaceholder {
  const text = `${SHARE_SHEET_LABEL} ${props.density}: ${props.resourceName}, ${props.shares.length} shares`;
  return { label: SHARE_SHEET_LABEL, text, density: props.density };
}
