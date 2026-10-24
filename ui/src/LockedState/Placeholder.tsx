// F9 stand-in. The place paints `text` in a box labelled `label`.

import type { Density, LockedStateProps } from "./props.ts";
import { ACCESS_REQUEST_STATUS_LABEL } from "./props.ts";

export const LOCKED_STATE_LABEL = "LockedState";

export interface LabelledPlaceholder {
  label: typeof LOCKED_STATE_LABEL;
  text: string;
  density: Density;
}

export function LockedStatePlaceholder(props: LockedStateProps): LabelledPlaceholder {
  const status = ACCESS_REQUEST_STATUS_LABEL[props.status];
  const text = `${LOCKED_STATE_LABEL} ${props.density}: ${props.title}, ${status}`;
  return { label: LOCKED_STATE_LABEL, text, density: props.density };
}
