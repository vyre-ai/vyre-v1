# Checks to make by hand in a release build (what CI cannot see)

## Desktop artifact page (Mac and Windows), added 13 Nov 2026
The native artifact page is kept while the Share sheet or a menu is open: it steps off-screen and comes back (apps/desktop/src-tauri/src/artifact_view.rs). CI compiles it (workflow `desktop`, job `desktop (<os>)`, "Rust unit tests", "Build the shell") but no one has seen it run. In the built app, on a Mac and on Windows:
1. Open Share on an artifact that has a counter in it: after closing the sheet the counter keeps its value (the page was not reloaded).
2. No flash and no reload when the sheet or the "..." menu opens or closes.
3. The page is not drawn over the sheet or the menu while it is open.
4. Keyboard focus: with the sheet open, typing goes to the sheet's field, not to the off-screen page; after closing, keys go where they did before.
5. Audio and video: a page that plays sound or video is quiet (or keeps playing, say which) while the sheet is open, and nothing doubles when it comes back.
6. Close the tab, reopen the artifact: the page loads (a new one-time address), no "This link has ended".
