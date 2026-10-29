---
name: agent-computer
description: Your own computer. When you have one, how to wake it, drive Chrome and the terminal on it, use the Vault there, and what is held.
system: true
---

# Your computer

An agent computer is a small desktop with Chrome, a Terminal and Files, owned by you. It sleeps when idle and wakes when you use it. Its Files folder is your own Vyre folder.
The person can watch it live, take over ("You are in control"), record, and give it back. It exists only if the context block says you have one.

## State
- `computers_list` and `computers_get` give its state: asleep, waking, working, takeover, error; the caption of what it is doing; the open tabs.
  `computers_wake` wakes it. `computers_sleep` is refused while a task runs. If a person has taken over, wait; do not fight for control.
- No computer? `computers_provision` for yourself, only when the work needs a browser or a place to run tools. It costs disk and attention; say why.

## Browser
- Open with `chrome_open` (it reuses the open tab; do not open a tab per step). `chrome_snapshot` reads the page as an accessibility tree with element refs.
  Prefer it to screenshots. Act with `chrome_act` (click, press, select, scroll) or `chrome_click`, `chrome_type`, `chrome_fill`, then `chrome_wait`.
- `chrome_screenshot` shows the person what you see. `chrome_state` gives the URL and title. `chrome_console` and `chrome_net` help when a page misbehaves.
- A send, post or payment is held and returns an id. Say what is waiting; the person approves with `chrome_send`. Do not retry. Esc stops everything until the person answers; then `chrome_resume`.
- Prefer a capability to driving a page. If Vyre has a tool for the thing (records, mail, calendar), use it. Use the browser for sites that have no API.
- Sites with a recorded recipe: look in your Files `recipes/` first; a recorded backend call is faster and steadier than clicking.

## Terminal
- `terminal_run` runs a command in a session and waits. `terminal_open` starts a session; `terminal_read` and `terminal_input` drive a long one; `terminal_interrupt` stops it.
  The session survives its tab, and the person can attach to it. Give `idempotencyKey` and a `timeoutSec`.
- Secrets: only as `#Handle.field` in `env`, from `vault_use`. Output is scrubbed. Never `echo` a secret and never write one to a file.

## Habits
- Say what you are doing on the computer in the caption-sized sentence a person watching would want. Take a screenshot at the end of a task that changed a page.
- Sign-ins live on the profile disk. `computers_sessions_list` shows them. Ask the person to sign in by taking over; do not type their password.
- Record or skill-from-step: `computers_skill_from_step` makes a skill from a point in a session when the person asks to keep what you just did.
