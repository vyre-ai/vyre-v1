// The measurement set for tool discovery: real tasks an agent is asked, each with the tools it needs in order and the words a model would plausibly type into tool_search for each (a first try, then a
// refined one after the first fails). The ranking, the listed set and the loading are the real code (agent/src/tools); only the model is scripted. Add a task by adding a row; keep the tool names real
// (the script checks that every one is in the catalog).
export interface Place { kind: "chat" | "thread" | "channel" | "ask" | "run" | "helper" | "console"; scope?: { type: string; id: string } }
export interface Step { tool: string; natural: string; refined: string }
export interface Task { id: string; area: string; prompt: string; place: Place; steps: Step[] }

const chat: Place = { kind: "chat" };
const inTask: Place = { kind: "thread", scope: { type: "task", id: "tsk_1" } };
const inGoal: Place = { kind: "thread", scope: { type: "goal", id: "gol_1" } };
const inProject: Place = { kind: "thread", scope: { type: "project", id: "prj_1" } };
const inInbox: Place = { kind: "ask", scope: { type: "place", id: "mail" } };
const inVault: Place = { kind: "ask", scope: { type: "place", id: "vault" } };
const inFile: Place = { kind: "ask", scope: { type: "file", id: "fil_1" } };
const inRecord: Place = { kind: "ask", scope: { type: "record", id: "rec_1" } };

export const TASKS: Task[] = [
  // Inbox
  { id: "inbox-what-came-in", area: "inbox", prompt: "What came in about the Clio Grow setup?", place: chat, steps: [{ tool: "inbox_list_by_thread", natural: "inbox threads", refined: "list email threads inbox" }, { tool: "mail_thread_get", natural: "read email thread", refined: "mail thread get messages" }] },
  { id: "inbox-unread", area: "inbox", prompt: "How many unread emails do I have?", place: inInbox, steps: [{ tool: "inbox_counts", natural: "unread count", refined: "inbox unread counts" }] },
  { id: "inbox-summarise-thread", area: "inbox", prompt: "Summarise the thread with Josh.", place: inInbox, steps: [{ tool: "inbox_thread", natural: "conversation with contact", refined: "inbox thread contact history" }, { tool: "mail_thread_get", natural: "email thread messages", refined: "mail thread get" }] },
  { id: "inbox-find-email", area: "inbox", prompt: "Find the email from Rivera about the retainer.", place: chat, steps: [{ tool: "mail_message_search", natural: "search email", refined: "mail message search" }, { tool: "mail_message_get", natural: "get email message", refined: "mail message get body" }] },
  { id: "inbox-mark-read", area: "inbox", prompt: "Mark the Rivera conversation as read.", place: inInbox, steps: [{ tool: "inbox_mark_read", natural: "mark read", refined: "inbox mark conversation read" }] },
  // Calendar
  { id: "cal-today", area: "calendar", prompt: "What is on my calendar tomorrow?", place: chat, steps: [{ tool: "calendar_list_events", natural: "calendar events", refined: "list calendar events" }] },
  { id: "cal-free-time", area: "calendar", prompt: "Find a free 30 minutes with Priya this week.", place: chat, steps: [{ tool: "calendar_find_time", natural: "find free time", refined: "calendar find time availability" }, { tool: "calendar_create_event", natural: "create calendar event", refined: "calendar create event" }] },
  { id: "cal-event-detail", area: "calendar", prompt: "Who is coming to the 3pm call?", place: chat, steps: [{ tool: "calendar_list_events", natural: "calendar events today", refined: "list calendar events" }, { tool: "calendar_get_event", natural: "event attendees", refined: "calendar get event" }] },
  { id: "cal-respond", area: "calendar", prompt: "Accept the Friday invite.", place: chat, steps: [{ tool: "calendar_respond", natural: "accept invite", refined: "calendar respond invitation" }] },
  // Records
  { id: "rec-find-company", area: "records", prompt: "Find the company Rivera Holdings and tell me its owner.", place: chat, steps: [{ tool: "records_query", natural: "search records", refined: "records query" }, { tool: "records_get", natural: "get record", refined: "records get" }] },
  { id: "rec-update-field", area: "records", prompt: "Set the stage of Rivera Holdings to Won.", place: inRecord, steps: [{ tool: "records_update", natural: "update record", refined: "records update field" }] },
  { id: "rec-history", area: "records", prompt: "What changed on this record last week?", place: inRecord, steps: [{ tool: "records_history", natural: "record changes history", refined: "records history" }] },
  // Files
  { id: "files-list-folder", area: "files", prompt: "What is in the Clients folder?", place: chat, steps: [{ tool: "files_list", natural: "list files", refined: "files list folder" }] },
  { id: "files-read-doc", area: "files", prompt: "Read the fee agreement and tell me the retainer.", place: inFile, steps: [{ tool: "files_read", natural: "read file", refined: "files read content" }] },
  { id: "files-move", area: "files", prompt: "Move the signed letter into Clients/Rivera.", place: chat, steps: [{ tool: "files_list", natural: "list files", refined: "files list" }, { tool: "files_move", natural: "move file", refined: "files move folder" }] },
  // Tasks
  { id: "tasks-mine", area: "tasks", prompt: "What is on my plate today?", place: chat, steps: [{ tool: "tasks_my_work", natural: "my tasks", refined: "tasks my work" }, { tool: "tasks_get", natural: "get task", refined: "tasks get detail" }] },
  { id: "tasks-create", area: "tasks", prompt: "Create a task to send Josh the meeting link, due Friday.", place: chat, steps: [{ tool: "tasks_create", natural: "create task", refined: "tasks create" }] },
  { id: "tasks-needs-you", area: "tasks", prompt: "What is waiting on me?", place: chat, steps: [{ tool: "tasks_needs_you", natural: "waiting on me", refined: "tasks needs you" }] },
  { id: "tasks-submit", area: "tasks", prompt: "(in a task thread) finish the task with the result.", place: inTask, steps: [{ tool: "task_submit", natural: "submit task", refined: "task submit result" }] },
  // Goals
  { id: "goals-list", area: "goals", prompt: "How are the goals going?", place: chat, steps: [{ tool: "goals_list", natural: "list goals", refined: "goals list" }, { tool: "goals_get", natural: "goal detail", refined: "goals get" }] },
  { id: "goals-checkin", area: "goals", prompt: "Post a check-in on this goal: signed two clients.", place: inGoal, steps: [{ tool: "goals_checkin_post", natural: "goal checkin", refined: "goals checkin post" }] },
  { id: "goals-progress", area: "goals", prompt: "What progress did this goal make since Monday?", place: inGoal, steps: [{ tool: "goals_progress_read", natural: "goal progress", refined: "goals progress read" }] },
  { id: "project-plan", area: "projects", prompt: "Show me the plan for this project.", place: inProject, steps: [{ tool: "projects_get", natural: "project plan", refined: "projects get" }] },
  // Vault
  { id: "vault-list", area: "vault", prompt: "Which logins do we keep for Clio?", place: inVault, steps: [{ tool: "vault_items_list", natural: "list vault items", refined: "vault items list" }, { tool: "vault_item_get", natural: "get vault item", refined: "vault item get" }] },
  { id: "vault-request", area: "vault", prompt: "I need the Stripe key; ask Irfad for it.", place: chat, steps: [{ tool: "vault_request", natural: "request secret", refined: "vault request" }] },
  // Chrome
  { id: "chrome-read-page", area: "chrome", prompt: "Open the Clio Grow billing page and tell me the plan.", place: chat, steps: [{ tool: "chrome_open", natural: "open url browser", refined: "chrome open" }, { tool: "chrome_snapshot", natural: "read page", refined: "chrome snapshot" }] },
  { id: "chrome-fill-form", area: "chrome", prompt: "Fill in the sign-up form with Rivera's details.", place: chat, steps: [{ tool: "chrome_fill", natural: "fill form", refined: "chrome fill" }, { tool: "chrome_click", natural: "click button", refined: "chrome click" }] },
  // Crews
  { id: "crew-start", area: "crews", prompt: "Start a helper to draft the three client letters in parallel.", place: chat, steps: [{ tool: "crew_start", natural: "start helper", refined: "crew start" }, { tool: "crew_list", natural: "list helpers", refined: "crew list" }] },
  { id: "crew-message", area: "crews", prompt: "Tell the helper working on letter two to use the new template.", place: chat, steps: [{ tool: "crew_message", natural: "message helper", refined: "crew message" }] },
];

/** Multi-part questions: the steps do not depend on each other, so a model that can call tools together asks for all of them in one step. Measured sequential against parallel (measure.ts, MULTI rows). */
export const MULTI: Task[] = [
  { id: "multi-day-plan", area: "multi", prompt: "What's on my calendar today, what needs a reply, and are any tasks overdue?", place: chat, steps: [{ tool: "calendar_list_events", natural: "calendar events", refined: "list calendar events" }, { tool: "inbox_list_by_thread", natural: "inbox threads", refined: "list email threads inbox" }, { tool: "tasks_needs_you", natural: "waiting on me", refined: "tasks needs you" }] },
  { id: "multi-status-round", area: "multi", prompt: "Give me the state of the goals, the open projects and the files in Clients.", place: chat, steps: [{ tool: "goals_list", natural: "list goals", refined: "goals list" }, { tool: "projects_list", natural: "list projects", refined: "projects list" }, { tool: "files_list", natural: "list files", refined: "files list folder" }] },
  { id: "multi-research", area: "multi", prompt: "Find Rivera in records, in memory, and see if a helper is already on it.", place: chat, steps: [{ tool: "records_query", natural: "search records", refined: "records query" }, { tool: "memory_search", natural: "search memory", refined: "memory search" }, { tool: "crew_list", natural: "list helpers", refined: "crew list" }] },
  { id: "multi-six-reads", area: "multi", prompt: "Morning round: mail, calendar, tasks, goals, vault requests and the helpers.", place: chat, steps: [{ tool: "inbox_counts", natural: "unread count", refined: "inbox counts" }, { tool: "calendar_list_events", natural: "calendar events", refined: "list calendar events" }, { tool: "tasks_my_work", natural: "my tasks", refined: "tasks my work" }, { tool: "goals_list", natural: "list goals", refined: "goals list" }, { tool: "vault_items_list", natural: "vault items", refined: "vault items list" }, { tool: "crew_list", natural: "list helpers", refined: "crew list" }] },
];
