# The shared pieces: what to use, and the mistake to avoid

One piece per job. The ratchet `scripts/lint/one-component.test.ts` (run in the CI gates job) fails when a copy is declared outside a piece's home folder, and its baseline may only go down. A plain rename is not caught: do not rely on it, use the piece.

**Dialog / Sheet** (`ui/src/Dialog`): the one frame for anything that asks a question. Props: `title`, `onClose`, `size` (s, m, l, full); `actions`, `note`; full only: `header`, `bar`, `captureKeys {chord, hint}` (`closeChord(mac, "terminal")`). Mistake: a second veil or `position: fixed` card outside `ui/Overlay` (it ends up under or over the wrong layer); with `captureKeys` do not also close on Escape yourself, the surface owns it. Ratchet: `Sheet`, `FormSheet` declared elsewhere.

**Tooltip** (`ui/src/Tooltip`): the one tip, on hover and keyboard focus after 350 ms. Props: `text` (a new line makes two lines), `cut` (only when the text is really cut), `open` (a list whose cursor is a row; or `showTip(el, text)`). Every `title` already flows through it and moves to `aria-label`. Mistake: drawing your own hover box, or a tip inside a scrolled list positioned by hand: the tip is placed from the element's box and drawn in the overlay layer, so just wrap the element. Ratchet: none by name; `no-raw-context-menu` and review.

**Status** (`ui/src/Status`): a dot and a few words for something that runs. Props: `tone` (ok quiet warn bad mine), `label`, `action` (+ `alt`); `note`, `slot`, `children`, `menu`; `inline` for a Row's trailing slot, `bar` for one fixed line. Mistake: a pill with a fill, or colours picked by hand (`var(--ok)` beside `var(--warn)`): tones are the only palette. Ratchet: `Status`, `StatusLabel`, `StatusDot`.

**Page** (`ui/src/Page`): one head and one scroll column. Props: `title`, `subtitle`, `tabs`/`tab`/`onTab`; `action`, `menu`, `status`, `back`, `bare`, `kind`. Mistake: more than seven tabs (it throws), a `kind="side"` whose first tab is not `details` (it throws), or drawing "Loading" in a Page: put a Loadable in the children. Ratchet: `Page` declared elsewhere.

**LiveSurface** (`ui/src/LiveSurface`): a live picture, stream or terminal in a fixed box. Props: `kind`, `aspect`, `state` (starting live asleep failed), `source` (frames arrive; never poll), `still`, `onPress`, `mode`. Mistake: a timer that fetches a screenshot: give it a `source`, and let `visible` or the page's own visibility let it go. Ratchet: `LiveSurface`, `LiveScreen`.

**Loadable and useLoad** (`ui/src/States/Loadable.tsx`, `apps/app/src/load`): turn a read into loading, a plain error with Retry, empty, or content. `useLoad({ screen: [id, name, state] } | { cap, input }, { soft, keepPrevious, enabled })`, then `<Loadable load what isEmpty empty loading>`. Mistake: reading `status === "ready"` and drawing "Loading" for anything else (a failed read then waits for ever); or a load that can never succeed: hooks that cannot answer give `load.cannot_read` and no Retry, do not add your own. `stale` means the last refresh failed and the old answer stays; draw nothing yourself. The place's data provider must feed `ScreensProvider` (and `CapCallProvider` for lists and changes). Ratchet: a declared `useScreenQuery` or `useRead`.

**useLoadList / useChange** (`apps/app/src/load`): cursor paging (page 1 live, later pages once, one request per page) and one change at a time with an optional optimistic patch. Mistake: a toggle that calls `call` directly: use `useChange` with `optimistic`, so on, off, on ends on the last press and a failure goes back to what the server last confirmed. Never optimistic for anything the Gate can hold (a send, a grant).

**Switch and Field** (`ui/src/Switch`, `ui/src/Field`): one switch (Space and Enter, disabled, `labelled`); a Row with one or two controls. Mistake: a new switch with its own colours, or `title` on a Pressable (see above). Ratchet: `Switch`, `Field`, `Select`, `Choice`, `Stepper`.

**MoreRow** (`ui/src/MoreRow`): the row that opens a capped list in place ("N more" / "Show less"). Props: `count`, `open`, `onToggle`. Mistake: using it for paging: paging stays `useLoadList`. Ratchet: `MoreRow`.

**Group** (`ui/src/Group`, being added by lane b-cmd to the contract's words): a titled block of rows with its own hairlines. Props: `title`, `count`, `action`, `empty`. Mistake: drawing hairlines in each row. Ratchet: `Section`.

**Safe to adopt now / wait (reviewer, 14 Nov):** adopt now: Tooltip, Loadable and useLoad (reads and failures), useLoadList, useChange, Switch, Status, the Sheet's sizes and `bar`, MoreRow. Wait for the review to clear: Page and LiveSurface until their fixes are confirmed; the Sheet's focus return until the browser check passes. Whichever it is, a `title` prop on a Pressable, View or Text never reaches the page (react-native-web drops it): use `dataSet: { tt: text }`, the guard test `scripts/lint/no-title-prop.test.ts` fails otherwise.

Before merging: run `node --import tsx --test scripts/lint/one-component.test.ts`, the lint (`node scripts/lint/run.ts --files <changed>`), and look at a picture of every visible change in both skins.
