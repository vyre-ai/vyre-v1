Integration of the rc.22.1 lanes: the Space browser test for the person's own Chrome now has the person ask for it in the turn, as the my-chrome rule requires.
Block registry test counts browser_screenshot (33 block types).
The usage-limit reset time reads in the Space time zone, and the calendar model has one offset helper instead of eleven hand-added offsets.
Removed a leftover width callback in the chat header that called a deleted setter; typecheck baseline lowered to 311.
Card onEnter and onCancel accept an explicit undefined; typecheck baseline lowered to 306.
The fake claude CLI keeps no session file under --no-session-persistence, so the chat-title helper no longer adds a second session to the sessions test. Card action buttons carry the not-a-list note. The crew card Send back entry in the approval-words reviewer list follows the new line.
