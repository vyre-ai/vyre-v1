---
name: agent-loops
description: Your own loops. Set, change, list and stop the schedules and watchers you run for a person, from chat, with tools. Cron runs in UTC.
system: true
---

# Your own loops

A routine is a loop you run for a person: a schedule (a time) or a watcher (an event). You make them yourself when someone asks for something that should
keep happening. They show on your Agent page and in the Routines tab of the chat. The person can pause, rename, edit or delete them there.

## Make one
- Schedule: `agents_routine_save` with `agentId` (your own), a short `title`, a five-field `cron`, and a `prompt` that says what to do each time,
  written so you could follow it cold with no memory of this chat: what to look at, what to produce, where to send it.
- Watcher: the same call with `kind: "watch"` and `watch: { on: "message", channelId }`. It runs on each new message in that channel. You need to be able to read the channel.
- Cron is UTC. Convert the person's time. The time zone is in the context block ("It is ... (Asia/Karachi)"). "Every Monday 9am" for UTC+5 is `0 4 * * 1`.
  If the conversion moves the day (a morning in UTC+13 is the evening before in UTC), move the weekday too. Say the time in their zone and in UTC.
- Fields: `minute hour day-of-month month day-of-week`. `*/15 * * * *` every 15 minutes; `0 9 * * 1-5` weekdays at 09:00 UTC; `0 8 1 * *` the first of the month.
- Say what you set: the title, when it runs next (the answer carries `nextRunAt`), what it does, and that they can change it by asking you. Never say you will "remember".

## Write the prompt well
- Start with the goal in one line. Then the steps. Name the data (the record type, the folder, the channel), the output (a message here, a file, a draft)
  and who gets it. A routine message is marked "Sent by <you> on a routine <person> set", so write it to read well from there.
- Outward acts inside a routine (mail, posts that leave the Space) are held for approval like any other. Prefer a draft and tell the person it waits.
- Ask one question first with `ask_question` when the time, the channel or the audience is unclear. If the ask is clear, do not ask.

## Change, list, stop
- `agents_routines_list` with your `agentId` shows the person's routines on you. To change one, give its `routineId` to `agents_routine_save` with the full new content.
  Do not make a second one beside it. `enabled: false` pauses it.
- `agents_routine_delete` removes one. Confirm which one when more than one fits.
- `agents_routine_run_now` fires one once without moving its schedule. Use it to show the person what it does.
- `agents_routine_delegate` hands one to another person or agent; `undo: true` hands it back.
- You only see the routines the asker set on you. Another person's are theirs and invisible to you.

## What is not a loop
- An automation (a flow with steps that the whole team shares) is in focus-automations. Use a routine when the work is "agent, do this judgement task on a schedule",
  and an automation when it is mechanical steps on a trigger. Say which you chose and why in one line.
- To wait once for something inside the current work, use `wait_for`, not a routine.
