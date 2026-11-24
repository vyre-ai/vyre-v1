The agent can no longer lift a pause a person made. After you take over a tab, only Give back on the bar releases it. After you press Stop or Esc, the agent goes on only once you have written to it in the chat. An agent can no longer give back the controls of a computer or a terminal you hold.
An agent started by a routine or a wake cannot go on after you stopped it, even if you wrote something in the chat since. Only a turn your own message started can.
An agent that has no chat to read (a routine, an automation) can be resumed after your Stop only from the bar. An agent's own stop never replaces your Stop, Esc or take-over, and your Stop or Esc during a take-over leaves the take-over until you give it back.
An interrupt you start with your own words lifts your Stop like a message does, and the message is found by its id however long the chat is.
Your Stop or take-over of a tab now survives Chrome restarting the extension's background worker: the agent stays stopped and the bar's Give back still works.
A Stop of yours is kept even if you close its tab; closing the tab of a take-over counts as giving it back.
While the extension is still reading back your Stop after a restart, the agent's calls are refused rather than allowed.
If Chrome's storage fails after the extension restarts, the agent stays stopped and the extension keeps trying; pressing Give back or Resume on the bar still frees it.
While Chrome's storage is down after an extension restart, a Stop you press is kept only in memory; if the extension restarts a second time before storage is back, it is lost. Buttons on the bar act only on your own click or key, never on a click a page script makes.
A saved pause record with one bad entry keeps every good one (only the bad entry is dropped); past 200 the newest 200 are kept.
