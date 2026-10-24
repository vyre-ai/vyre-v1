// Frozen props for ui/SidePane and ui/Pane (spec 3.0, D57, ARCH 7).
// Every pane header has exactly one toggle, and it is the far-left child.
// An inner toggle stays hidden while this side pane is open.

export interface PaneToggle {
  open: boolean;
  onPress?: () => void;
}

export interface PaneTab {
  key: string;
  title: string;
  icon?: string;
  pinned?: boolean;
}

export interface PaneProps {
  toggle: PaneToggle;
  title?: string;
  tabs?: readonly PaneTab[];
  activeTab?: string;
}

export interface SidePaneProps extends PaneProps {
  /** Width is remembered per pane key. */
  paneKey: string;
  min?: number;
  max?: number;
}

/** Prototype drag floor, in px. */
export const SIDE_PANE_MIN = 280;

/** Prototype drag cap, as a fraction of the window. */
export const SIDE_PANE_MAX = 0.7;

/** Frozen header order. Index 0 is the far left. */
export const PANE_HEADER_ORDER = ["toggle", "tabs"] as const;

export function paneToggleLabel(open: boolean): string {
  return open ? "Hide the pane" : "Show the pane";
}

export function sidePaneMin(props: SidePaneProps): number {
  return props.min ?? SIDE_PANE_MIN;
}

export function sidePaneMax(props: SidePaneProps): number {
  return props.max ?? SIDE_PANE_MAX;
}
