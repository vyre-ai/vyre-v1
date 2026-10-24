// Frozen props for ui/Row (spec UI rows, ARCH 10.1).
// Hover and selection paint this row, full width. The second line sits under the title.

export interface RowProps {
  id?: string;
  title: string;
  note?: string;
  selected?: boolean;
  hovered?: boolean;
  onPress?: () => void;
}
