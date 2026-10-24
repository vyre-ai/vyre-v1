// Frozen props for ui/TabStrip (spec 3.0, 4.7, ARCH 7.0).
// One strip for main tabs and for the side pane. The pane toggle is not part of this strip.

export interface TabSpec {
  key: string;
  title: string;
  icon?: string;
  pinned?: boolean;
}

export interface TabStripProps {
  tabs: readonly TabSpec[];
  active: string;
  onSelect?: (key: string) => void;
  onClose?: (key: string) => void;
  onReorder?: (keys: readonly string[]) => void;
  /** Extra entries for the tab menu. ui/Menu appends Report a problem when that menu is a context menu. */
  menu?: (key: string) => readonly { label: string; icon?: string }[];
  onPlus?: () => void;
  plusTitle?: string;
}

export function activeTab(props: TabStripProps): TabSpec | undefined {
  return props.tabs.find((tab) => tab.key === props.active);
}
