Integration of the rc.22.1 lanes: the Space browser test for the person's own Chrome now has the person ask for it in the turn, as the my-chrome rule requires.
Block registry test counts browser_screenshot (33 block types).
The usage-limit reset time reads in the Space time zone, and the calendar model has one offset helper instead of eleven hand-added offsets.
Removed a leftover width callback in the chat header that called a deleted setter; typecheck baseline lowered to 311.
Card onEnter and onCancel accept an explicit undefined; typecheck baseline lowered to 306.
The fake claude CLI keeps no session file under --no-session-persistence, so the chat-title helper no longer adds a second session to the sessions test. Card action buttons carry the not-a-list note. The crew card Send back entry in the approval-words reviewer list follows the new line.
The room pack live test reads the digest from the last tag with the pack on, not from the median-by-time run, which on a slow runner can be the first tag (it starts the digest and carries none).
Files menu actions (Trash, Restore, folder delete, folder move) tell the person when the Space refuses them. The usage-limit cause test pins the clock and checks later today, tomorrow and a date.
Status cards on a quiet line get their row style (it was used but never defined); the block registry test counts result_card, progress_card and status_card (36).
A terminal live viewer that has stopped gets no more lines, even those its tmux client had already written (the tmux heavy test "the viewer that left gets nothing more" no longer depends on timing).
The calendar pull reads the stored rows of each page of provider events in one query instead of one per event, so a second pass over 5,000 unchanged events is quick and writes nothing.
