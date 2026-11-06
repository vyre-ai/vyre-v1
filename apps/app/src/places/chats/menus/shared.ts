// What every row menu shares: the keys shown in the hint column, the separator and `tidy` (an item left out leaves no empty group). The key logic that runs the item a key press names is ui/src/Menu/keys.ts.

export const KEY = { enter: "Enter", newTab: "⌘↵", rename: "F2", star: "S", unread: "U", archive: "E", remove: "⌘⌫", profile: "⌘I" } as const;

import { item } from "../../../../../../ui/src/Menu/entries.ts";

export { sep, tidy, item } from "../../../../../../ui/src/Menu/entries.ts";
export { keyLabel, shortcutFor } from "../../../../../../ui/src/Menu/keys.ts";

/** Star / Remove star: the one spelling for putting a chat, agent, channel, project, file or record in your list. */
export const starItem = (starred: boolean, star: (on: boolean) => void, hint: string = KEY.star): ReturnType<typeof item> => (starred ? item("Remove star", () => star(false), { hint }) : item("Star", () => star(true), { hint }));
