// Frozen props for ui/Row (spec UI rows, ARCH 10.1).
// Hover and selection paint this row, full width. The second line sits under the title.
// Ruling 36: optional leading and trailing slots (avatar, icon, chevron, controls) sit inside the row, so hover and selection still paint edge to edge.

import type { ReactNode } from "react";

export interface RowProps {
  id?: string;
  title: string;
  note?: string;
  /** Accent-coloured lead-in before the note on the same line (Draft ready, Waiting on you). Shown only with a note. */
  noteLead?: string;
  /** Colour of the lead-in: the accent (default) or the warning colour ("Unsure match"). */
  noteLeadTone?: "accent" | "warning";
  selected?: boolean;
  hovered?: boolean;
  /** Muted text after the title on the same line (an org next to a name). Truncates before the title does. */
  titleSuffix?: string;
  /** Small icons or tags drawn right after the title (and suffix) on the title line: star, bell, DND, Bounced. They keep their size when the title truncates. */
  titleMarks?: ReactNode;
  /** Two-line variant, 62 px: the title line and a note of up to two lines (Inbox rows). Default is the 28 or 44 px row. */
  tall?: boolean;
  /** Semibold title (unread chats and channels). */
  emphasis?: boolean;
  /** Before the title (avatar, icon, chevron). Keeps its own width; the title starts after it. */
  leading?: ReactNode;
  /** After the title, right aligned (count, level picker, controls). */
  trailing?: ReactNode;
  onPress?: () => void;
}
