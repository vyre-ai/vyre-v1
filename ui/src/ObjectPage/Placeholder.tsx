// F9 stand-in. The place paints `text` in a box labelled `label`.

import type { Density, ObjectPageProps } from "./props.ts";

export const OBJECT_PAGE_LABEL = "ObjectPage";

export interface LabelledPlaceholder {
  label: typeof OBJECT_PAGE_LABEL;
  text: string;
  density: Density;
}

export function ObjectPagePlaceholder(props: ObjectPageProps): LabelledPlaceholder {
  const tab = props.tabs.find((item) => item.id === props.activeTabId);
  const tabLabel = tab ? tab.label : props.activeTabId;
  const text = `${OBJECT_PAGE_LABEL} ${props.density}: ${props.name}, ${tabLabel}`;
  return { label: OBJECT_PAGE_LABEL, text, density: props.density };
}
