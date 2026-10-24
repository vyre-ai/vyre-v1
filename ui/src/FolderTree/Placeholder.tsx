// F9 stand-in. The place paints `text` in a box labelled `label`.
// Real layout lands with the UI lane. Props stay frozen.

import type { Density, FolderTreeProps } from "./props.ts";

export const FOLDER_TREE_LABEL = "FolderTree";

export interface LabelledPlaceholder {
  label: typeof FOLDER_TREE_LABEL;
  text: string;
  density: Density;
}

export function FolderTreePlaceholder(props: FolderTreeProps): LabelledPlaceholder {
  const text = `${FOLDER_TREE_LABEL} ${props.density}: ${props.resourceType}, ${props.nodes.length} folders`;
  return { label: FOLDER_TREE_LABEL, text, density: props.density };
}
