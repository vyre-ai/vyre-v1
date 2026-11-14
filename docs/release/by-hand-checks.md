# Checks to make by hand in a release build (what CI cannot see)

## Desktop artifact page (Mac and Windows), added 13 Nov 2026
The native artifact page is kept while the Share sheet or a menu is open: it steps off-screen and comes back (apps/desktop/src-tauri/src/artifact_view.rs). CI compiles it (workflow `desktop`, job `desktop (<os>)`, "Rust unit tests", "Build the shell") but no one has seen it run. In the built app, on a Mac and on Windows:
1. Open Share on an artifact that has a counter in it: after closing the sheet the counter keeps its value (the page was not reloaded).
2. No flash and no reload when the sheet or the "..." menu opens or closes.
3. The page is not drawn over the sheet or the menu while it is open.
4. Keyboard focus: with the sheet open, typing goes to the sheet's field, not to the off-screen page; after closing, keys go where they did before.
5. Audio and video: a page that plays sound or video is quiet (or keeps playing, say which) while the sheet is open, and nothing doubles when it comes back.
6. Close the tab, reopen the artifact: the page loads (a new one-time address), no "This link has ended".

## Links and sign-in return (added 14 Nov 2026), walked only in part
Not walked by anyone in a release build; check by hand with two people on a Space that has a public address:
1. Share an artifact with a second person (not an agent), Copy link in the Share sheet, open it signed out in a second browser: it asks to sign in, and after sign-in lands on the artifact, not Home.
2. A member the artifact is NOT shared with opens the same link: a plain "You don't have access" page with a way to ask, never a blank or an error page.
3. A one-use artifact link (the address of an opened artifact tab) opened a second time says in words that the link has ended, with a way back; inside Vyre it never appears.
4. In the desktop app, Console, Google sign-in and GitHub sign-in setup show the Space's own address to paste, and signing in to a connection returns to the app.
5. In the desktop app on a Space with no public address: Copy link in a menu says "opens in Vyre on this computer only"; the Share sheet says there is no link to give.
