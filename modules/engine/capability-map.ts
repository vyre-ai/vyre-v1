// A one-page map of what an agent can reach, one line per area, in the stable section of every turn. The tools are many (about 1,500) and only 65 are listed; the rest are loaded with tool_search.
// A model that does not know a tool exists searches by guess. This names, per area, the tools a task starts with, so it asks for them by their own name in one search. Keep it about 1.5k tokens;
// every tool named here must exist (modules/engine/tests/capability-map.test.ts), and every area of the catalog must have a line.
export const CAPABILITY_MAP = [
  "What you can reach. Listed tools you can call now; any other tool below is loaded by tool_search with its exact name (one search, then call it).",
  "- Mail: mail_message_search, mail_message_get, mail_thread_get, mail_send, mail_draft, inbox_counts, inbox_list_by_thread, inbox_thread, inbox_mark_read.",
  "- Calendar: calendar_list_events, calendar_find_time, calendar_availability, calendar_get_event, calendar_create_event, calendar_update_event, calendar_respond. Google and Microsoft: google_calendar_*, ms_calendar_*.",
  "- Meetings and calls: meetings_list, meetings_get, zoom_meetings_create, telephony_call_list, telephony_call_get, transcript_search.",
  "- Records (people, companies, deals): records_query, records_get, records_create, records_update, records_history, records_relate, records_comments_add, schema_describe, views_list.",
  "- Files: files_list, files_read, files_write, files_get, files_create, files_move, files_copy, files_delete, files_folder_create, files_comments_add, changesets_get; Docs and Sheets: sheets_create, sheets_append_rows.",
  "- Tasks: tasks_my_work, tasks_needs_you, tasks_list, tasks_get, tasks_create, tasks_update, tasks_assign, tasks_delegate, task_submit, task_ask, task_block; in a task thread you finish with one of the task_ tools.",
  "- Goals: goals_list, goals_get, goals_create, goals_checkin_post, goals_progress_read, goals_update, goals_complete, goals_pause, goals_resume, goals_folder.",
  "- Projects: projects_list, projects_get, projects_create, projects_plan, projects_reschedule, projects_link_tasks.",
  "- Memory and notes: memory_search, memory_remember, memory_propose, memory_forget, memory_profile, notes_search, notes_get, notes_create, read_note.",
  "- Vault (secrets): vault_items_list, vault_item_get, vault_use, vault_request, vault_fill, vault_item_reveal. You never see a secret's value; ask with vault_request.",
  "- Chat: chat_post, chat_thread, chat_search, chat_messages_list, chat_recent, ask_question, plan_propose, threads_add_agent, channels_list, channels_create.",
  "- Helpers (crew): crew_start, crew_list, crew_message, crew_stop, crew_merge, crew_push; handoff for passing work to another agent.",
  "- Agents and skills: agents_list, agents_get, agents_routine_save, agents_routines_list, skills_list, load_skill, plugins_browse.",
  "- Flows and runs: automations_list, automations_get, automations_create, automations_run, runs_list, runs_get, journeys_start, scheduler_list, forms_list.",
  "- Browser (Chrome): chrome_open, chrome_snapshot, chrome_act, chrome_click, chrome_fill, chrome_type, chrome_screenshot, chrome_tabs, chrome_wait.",
  "- Computer and terminal: terminal_run, terminal_open, terminal_read, screen_screenshot, screen_click, computer_files_read, computers_list, runbooks_run.",
  "- Sites and apps: sites_build, sites_deploy, sites_previews, sites_list, artifact_publish, kits_list, portal_post; payments: stripe_customer_list, stripe_checkout_create_session.",
  "- Code: git_status, git_diff, git_commit, git_branch, github_issue_get, github_pull_request_get, github_pull_request_create.",
  "- Search and links: search_query, read_link, open_tab, tasks_by_key, goals_search_past, memory_search for what the Space already knows.",
  "- People and access: people_status, message_person, access_request, access_share, notifications_away_get.",
  "- Contacts and outreach: contacts_resolve, contacts_preferences_get, contacts_suppression_check, email_builder_create, telephony_send_sms, comms_senders_list, bookings_list.",
  "- Reading pattern: a list tool returns ids and names; read one with its matching get tool (tasks_list then tasks_get, goals_list then goals_get, vault_items_list then vault_item_get, calendar_list_events then calendar_get_event, mail_message_search then mail_message_get).",
  "- Import, sources, connections: import_get, sources_list, connections_list, connectors_list, providers_list.",
].join("\n");
