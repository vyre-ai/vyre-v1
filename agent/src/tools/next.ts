// After a list or a search, the tool to read one item is named in the result and listed at once, so the model does not search for it. The hint is derived for the usual pair (X_list, X_search or
// X_query, then X_get) and spelled out where the names differ. agent/tests/tools.next.test.ts checks that every name here is a real tool.
export const NEXT_READS: Readonly<Record<string, readonly string[]>> = {
  inbox_list_by_thread: ["inbox_thread", "mail_thread_get"],
  inbox_thread: ["mail_thread_get"],
  mail_message_search: ["mail_message_get", "mail_thread_get"],
  calendar_list_events: ["calendar_get_event"],
  tasks_my_work: ["tasks_get"], tasks_needs_you: ["tasks_get"], tasks_list: ["tasks_get"],
  goals_list: ["goals_get", "goals_progress_read"],
  projects_list: ["projects_get"],
  vault_items_list: ["vault_item_get"],
  records_query: ["records_get", "records_history"],
  files_list: ["files_read", "files_get"],
  crew_list: ["crew_message"],
  automations_list: ["automations_get", "runs_list"],
  runs_list: ["runs_get"],
  agents_list: ["agents_get"],
  memory_search: ["read_note"],
  chat_search: ["chat_message_get", "chat_messages_list"],
  channels_list: ["channels_get"],
  sites_list: ["sites_get"],
  meetings_list: ["meetings_get"],
  notes_search: ["notes_get"],
};

/** The tools to read one item of what this tool returned, by name; the caller keeps those that exist and are offered. */
export function nextReads(tool: string): readonly string[] {
  const named = NEXT_READS[tool];
  if (named) return named;
  const m = /^(.*)_(?:list|search|query)$/.exec(tool);
  return m ? [`${m[1]}_get`] : [];
}
