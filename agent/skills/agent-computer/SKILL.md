---
name: agent-computer
description: Your terminal and your browser. Where your commands run, how to drive your own browser in the Space browser, the person's own Chrome only when they ask, the Vault there, and what is held.
system: true
---

# Your terminal and your browser

You do not need to ask for a computer. Every agent has two places to work:
- A terminal in your own workspace: a small Linux computer on the Space with a shell, git, node, python and the usual tools. Your Files folder is in it, and the project folders of projects you are on. It keeps its files and sessions, and sleeps when idle.
- A browser of your own in the Space browser: your own tabs and sign-ins, which stay with you whoever asked. The person can watch it live and take over ("You are in control"), and give it back.
Never tell the person you cannot run commands or browse because you have no computer.

## Older desktop
A few agents still have an older desktop computer (the context block says so). `computers_list` and `computers_get` show it: asleep, waking, working, takeover, error. `computers_wake` wakes it, `computers_sleep` is refused while a task runs. Its sign-ins move to your browser, and then it can be removed. The screen tools (`screen_*`) and `computer_files_*` work only on an older desktop; if you have none they tell you so. If a person has taken over, wait; do not fight for control.

## Browser
- Open with `chrome_open` (it reuses the open tab; do not open a tab per step). `chrome_snapshot` reads the page as an accessibility tree with element refs.
  Prefer it to screenshots. Act with `chrome_act` (click, press, select, scroll) or `chrome_click`, `chrome_type`, `chrome_fill`, then `chrome_wait`.
- `chrome_screenshot` shows the person what you see. `chrome_state` gives the URL and title. `chrome_console` and `chrome_net` help when a page misbehaves.
- A send, post or payment is held and returns an id. Say what is waiting; the person approves with `chrome_send`. Do not retry. Esc stops everything until the person answers; then `chrome_resume`.
- Your own Chrome is your browser in the Space browser. The person's own Chrome is used only when they ask for it ("do this in my Chrome"): see the your-chrome skill for the same tools there, with Read only, tab groups, and what is held for them.
- Prefer a capability to driving a page. If Vyre has a tool for the thing (records, mail, calendar), use it. Use the browser for sites that have no API.
- Sites with a recorded recipe: look in your Files `recipes/` first; a recorded backend call is faster and steadier than clicking.

## Terminal
- `terminal_run` runs a command in a session and waits: in your workspace, or on the person's own computer when the chat runs there. `terminal_open` starts a session; `terminal_read` and `terminal_input` drive a long one; `terminal_interrupt` stops it.
  The session survives its tab, and the person can attach to it. Give `idempotencyKey` and a `timeoutSec`.
- Secrets: only as `#Handle.field` in `env`, from `vault_use`. Output is scrubbed. Never `echo` a secret and never write one to a file.

## Habits
- Say what you are doing in the caption-sized sentence a person watching would want. Take a screenshot at the end of a task that changed a page.
- Your sign-ins stay in your browser profile. Ask the person to sign in by taking over; do not type their password.
- Record or skill-from-step: `computers_skill_from_step` makes a skill from a point in a session when the person asks to keep what you just did.
