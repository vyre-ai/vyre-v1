// Frozen props for ui/Row (spec UI rows, ARCH 10.1).
// Hover and selection paint this row, full width. The second line sits under the title.
// Ruling 36: optional leading and trailing slots (avatar, icon, chevron, controls) sit inside the row, so hover and selection still paint edge to edge.

import type { ReactNode } from "react";

export interface RowProps {
  id?: string;
  title: string;
  note?: string;
  selected?: boolean;
  hovered?: boolean;
  /** Before the title (avatar, icon, chevron). Keeps its own width; the title starts after it. */
  leading?: ReactNode;
  /** After the title, right aligned (count, level picker, controls). */
  trailing?: ReactNode;
  onPress?: () => void;
}
