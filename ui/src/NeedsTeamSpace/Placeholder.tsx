// F9 stand-in. The place paints `text` in a box labelled `label`.
// The sentence is the product copy from VyreUI.needsTeam.

import type { Density, NeedsTeamSpaceProps } from "./props.ts";
import { NEEDS_TEAM_SPACE_LABEL } from "./props.ts";

export const NEEDS_TEAM_SPACE_COMPONENT = "NeedsTeamSpace";

export interface LabelledPlaceholder {
  label: typeof NEEDS_TEAM_SPACE_COMPONENT;
  text: string;
  density: Density;
}

export function NeedsTeamSpacePlaceholder(props: NeedsTeamSpaceProps): LabelledPlaceholder {
  const detail = props.what.length > 0 ? `, ${props.what}` : "";
  const text = `${NEEDS_TEAM_SPACE_COMPONENT} ${props.density}: ${NEEDS_TEAM_SPACE_LABEL}${detail}`;
  return { label: NEEDS_TEAM_SPACE_COMPONENT, text, density: props.density };
}
