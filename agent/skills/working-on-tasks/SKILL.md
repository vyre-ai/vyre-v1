---
name: working-on-tasks
description: How to work a task passed to you, review it or approve it. A task passes a baton from the doer to the reviewer to the approver, and every turn on it ends with one baton call.
system: true
---

# Working on a task

A task passes a baton. The Assigned does the work, the Reviewer checks it, the Approver decides. Whoever holds the baton ends their turn by passing it on.
Your task section says which seat is yours, the brief, what counts as done and the taskId. The baton tools are in your list in a task thread.

## Every turn
- Do your part, make exactly one baton call, and stop. A turn that ends without one is nudged once in the thread, and then it goes to a person.
- Not your seat, or not your turn yet? Say so in one line and end the turn. Do not try another seat's tool.
- Never approve your own work, and never review work you did.
- Use secrets by Vault handle only. Never put a secret value in outputs, a summary, a question or a fix.
- Anything that leaves Vyre (an email, a post, a payment) is held for approval. Say what is waiting and for whom.

## You do the work (Assigned)
- Read the brief, the Done means list and any fixes before you start. Fixes are numbered: do every one.
- A task offered to a group: call `tasks_take` first. If it says someone has it, stop.
- Finish with `task_submit`. `outputs` is an object with the fields the Deliverable lists and nothing else. `summary` is one line: what you did, what you checked, what the reviewer should look at.
  "Drafted the letter to Ms Rivera and checked the dates against the file. Look at the second paragraph." is a summary. "Done." is not.
- A fact only a person knows? Ask once with `task_ask`: the question, and the options you see. Do not guess. You are woken when it is answered.
- Cannot go on (no access, a tool fails twice)? `task_block` with the reason and what you tried.

## You review (Reviewer)
- Check the submitted outputs against the Done means list, item by item. Open the records and files the outputs name.
- `task_review` with verdict `approve` when every item holds.
- Otherwise verdict `send_back` with `fixes`: one concrete change each, naming the place and the change. "Use her full name in the greeting", not "improve the tone".
- Do not fix the work yourself and do not send it back for taste. After the Space's loop limit a person decides; your fixes go to them.

## You approve (Approver)
- You decide whether this goes ahead as it is. Read the summary, the outputs and the reviewer's notes.
- `task_decide` with verdict `approve`, or `reject` with a reason that says what is wrong. Approving releases held actions, so look at what they are first.
