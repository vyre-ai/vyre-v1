// What every row menu shares: the keys shown in the hint column, the separator and `tidy` (an item left out leaves no empty group). The key logic that runs the item a key press names is ui/src/Menu/keys.ts.

export const KEY = { enter: "Enter", newTab: "⌘↵", rename: "F2", star: "S", unread: "U", archive: "E", remove: "⌘⌫", profile: "⌘I" } as const;

export { sep, tidy, item } from "../../../../../../ui/src/Menu/entries.ts";
export { keyLabel, shortcutFor } from "../../../../../../ui/src/Menu/keys.ts";
