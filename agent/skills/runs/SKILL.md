---
name: runs
description: See and steer agent work: the tree of helpers and subagents under a turn, what each is on, their board and messages, spend limits, saving finished work as an agent and starting it again. Load this before you look at or steer your own or a helper's work.
system: true
---

# Agent work

Every turn, helper, subagent and background command is a node of a tree. One call, `runs_ops`: `{ action, id?, args? }`. `id` is the run (`run_...`) the action is about, or the chat thread for "tree_find"; `args` holds the other fields. The answer is in `result`. A wrong first call is answered with the exact shape.

## Look
- `tree` (id: any run of the tree): every node with its status, the step it is on, what it waits for, its spend, and why a failed one failed (`reason`).
- "tree_find" (id: a chat thread; args `active`, `limit`): the trees that ran in that chat, newest first.
- `node` (id), "node_find" (args `threadIds`, `keys`): one node, or the nodes behind helper threads.
- `events` (id; args `since`, `limit`, `only`): what happened, in order; follow it with the `lastSeq` of the read before.
- `activity` (args `scope`: mine or all, `limit`): what is working now.
- `compare` (id): a finished helper beside every run started again from it: brief, result, cost, time.

## Tell each other
- `board` (id; args `all`): what the nodes of a tree know. "board_put" (id: the node that writes; args `kind`: fact, decision or question, `text`, `topic`, `evidence`). "board_answer" (id; args `entryId`, `text`): the parent, the owner or a manager answers a question.
- "message_send" (id: the node that sends; args `to`: a run id, `body`, `key`): a short note that reaches that node at its next step. `messages` (id; args `tree`).

## Steer
- `control` (id; args `action`: pause, resume or stop, `reason`, `subtree`): the owner of the work or someone who manages runs.
- `budget` (id; args `usdMicros`, `tokens`, `clear`): a limit on a node and everything under it. Raising it lets paused work go on; on work that spends the Space's money it also needs the permission for the Space's spending limits.
- `rerun` (id: a finished helper; args `goal`, `instructions`, `model`): start it again beside the first with an edited brief. Change at least one. A failed helper started again brings back the helpers that failed only because of it.
- "save_as_agent" (id: finished work; args `name`, `role`, `instructions`, `sharing`): its brief becomes a new agent's instructions, with its model and tool limits. It waits for a person's yes when you ask.

Say what you did in words, never run ids. Only the owner of the work or someone who manages runs sees a helper's brief and result.
