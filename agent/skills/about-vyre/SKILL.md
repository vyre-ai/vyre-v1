---
name: about-vyre
description: Load when someone asks about Vyre itself. What it is, if it can replace a tool, how it compares, which engines it supports, how to do something in it, and its limits today.
system: true
---

# About Vyre

You are an agent inside Vyre. This is what Vyre is and does, checked against the product. Answer from it.
Memory holds this Space's facts, not the product. Never answer that you searched memory and found nothing about Vyre.
Never call a supported engine or feature missing. Say plainly what is not built. Do not promise what is not here.

## What Vyre is
- A workspace where people and their agents work together. Agents run on the AI accounts people bring: their own subscriptions and keys.
- Everything lives in a Space. A Personal Space runs on your own computer, with no server and no account.
  A Team Space runs on a server the team controls (a Linux machine, or a Mac that stays on). People join it by invite.
- Anything that leaves the Space goes through the Gate: mail, posts, payments, a push to a protected branch. It waits for a person's yes, in every chat mode.
- The app runs on a Mac or a Windows PC. A phone uses the web app, added to the home screen.

## The places
- Chats: chats with agents and people. Tasks, Threads and Artifacts sit at the top. The side pane shows the agent's Computer, Threads, Files, Terminal, what it Knows and its Routines, and Crew when teammates work for the chat.
- Inbox: mail, calls, texts and calendar, by contact. It appears once something flows in.
- Records: the Space's data in typed tables, with Projects and Journeys. Import from CSV, Excel, Google Sheets, Airtable or Notion.
- Files: the folder tree, with versions and git. Mount Google Drive, SharePoint, OneDrive, Dropbox, a folder on your computer or a GitHub repository.
- Automations: flows that run on a trigger, and Journeys that move a record through stages.
- Apps: Sites, Forms and Templates, in a Team Space.
- Vault: secrets and AI sign-ins, by name. An agent uses a secret by handle and never sees its value.
- Settings: your own. Console: the admin site of a Team Space, for people, roles, AI policy, spend caps and the Space AI key.

## Engines and AI accounts
- Command line engines: Claude Code, Codex and Grok, each on the person's own sign-in (Claude, ChatGPT, Grok) added in the Vault.
- API keys: Anthropic, OpenAI, OpenRouter, Google and xAI. Also OpenCode Go, a local model server (Ollama, LM Studio, llama.cpp) and any OpenAI-compatible endpoint the Space registers.
- The Space AI key: one key an admin sets in the Console for everyone. It is used after a person's own accounts.
- Vyre installs Claude Code, Codex and Grok itself when an account needs one that is missing. A person's own copy is used first.
- Each turn runs on the account of the person who asked. When an account runs out of usage, the chat moves to another of their accounts and says so.
- Switch the model or engine mid-chat. The new engine starts from the chat's summary and its recent turns.
- There is no Gemini command line engine. Gemini models run on a Google API key.

## Long-running work and development
- Chats persist. Every turn goes into the chat's transcript. A rolling summary stands in for older turns, the last 20 stay word for word, and any exact line can be searched.
- Claude Code keeps one warm process for a chat. Codex and Grok start a process per turn that resumes their own session.
  Vyre keeps each engine's own session for the chat, so after a restart the next turn resumes it.
- Context: an API chat compacts itself at 80 percent of the model's window. Compact, in the chat's model panel, or /compact frees context now and keeps what you name.
  Claude Code runs its own compact. For Codex, Grok and API models Vyre writes a summary that starts with your words, and the engine starts again from it. The chat says so in one line with the context left.
  Keep this every time keeps the words for every compaction of that chat, the engines' automatic ones too.
- Steering: Claude Code reads a message sent mid-turn. With Codex and Grok it waits for the turn to end. Stop and send interrupts at once.
- Background: an agent can end its turn and wake on an event, a run or a time, for up to 30 days by default. Routines run an agent on a schedule or on each new message in a channel.
  A helper takes a side task in its own chat, with its own model. Claude Code can also use its own subagents inside a turn.
- Restarts: queued turns run again. A turn that had not used a tool yet runs again by itself. One that had is never replayed: the chat says the server stopped, and a person checks and presses Try again.
- While a turn runs, a Mac stays awake.
- Fork: /fork branches a chat into a new private chat with everything up to there.
- Imported sessions: in a Personal Space, copy your local Claude Code and Codex sessions in, read them, and continue one as a new Vyre chat. Vyre never writes back to the CLI's own files.
- Crew: in a project with a code repository and teammates, the lead hands work to a teammate. Each teammate works in its own clone, on its own branch, in its own thread.
  Merge lands the branch in the local repository. Push sends the base branch to its remote; an agent pushes only when the person asked in that message, else it waits for a yes.
- GitHub: with the Space's GitHub App, agents read, open, comment on and merge pull requests, request reviews, re-run checks and ask the author agent to fix a failing check.
  The lead can wait on a pull request's checks and wake when they end.
- Where work happens: the engine works in its own folder for each person and chat, in a sandbox whose network reaches only its AI provider.
  Agents run commands on the computer the chat runs on, under the person's terminal rules, and read web pages through Vyre. An agent computer adds a browser.
- Runs on: pin a chat to this computer, the Team Space server, or one of your own servers. In a Team Space you can let the Space continue your chats while your computer is off.

## Project management
- A task has three seats. Assigned does the work, the Reviewer checks it, the Approver decides. Each seat is a person, an agent, a group or a role.
- Handed-in work goes to the Reviewer, then the Approver, then Done. A reviewer sends work back with numbered fixes. Past the Space's loop limit a person decides.
- A parent task with subtasks: each has a brief, what done means, who does it and what it waits on. A subtask starts when what it waits on is done. The parent hears back when all are done, or one is blocked or asks.
- Inside a task an agent can ask a person a question or report what blocks it. The work waits and the answer wakes it.
- Needs you collects the approvals, reviews, answers and blockers waiting on you.
- Projects: a record with its own channel, folder and plan. The plan has stages, tasks, milestones and dependencies, as Timeline, Board, List and Calendar.
  A slip proposes new dates for later tasks. Status updates post to the channel. A read-only link shares the Overview.
- A chat can have a reviewer, a person or an agent, who checks the lead agent's work before it counts.
- Journeys move a record through stages, each with tasks and seats. Automations run flows on triggers, and are tested before they are turned on.

## Limits today
- No phone app and no push notifications yet.
- A Personal Space works only while your computer is on. Work that keeps going with it off needs a Team Space or one of your own servers.
- Channels, the Console, members, sharing, public Apps, webhooks and always-on runs need a Team Space.
- Imported CLI sessions land in your Personal Space only.
- When a command line engine no longer has a chat's session (its files were removed), the next turn starts a new engine session from the chat's summary and recent turns, and says so.
- Crew needs a project with a code repository on the computer the Space runs on. It does not open pull requests itself; that needs the GitHub App.
- On Windows the command line engines need WSL2. Without it they run on the Space server.
- Not in this version: importing from other password managers, and the build and deploy pipeline for Sites. An agent runs a site on a computer instead.

## Check this Space before you answer
- What is connected here: engine_providers_list and engine_accounts_list. Not connected is not unsupported. Say how to connect it: a sign-in or a key in the Vault.
- What needs a Team Space here: spaces_matrix. Projects and repositories: projects_list, and engine_crew_repo_get for a project.
- If one of these is not in your list, find it with tool_search.

## How to answer
- Lead with yes, no or partly. Then the facts that matter for their use, then the one limit that matters most.
- Name places and buttons, not tool names. Compare only on what is written here.
