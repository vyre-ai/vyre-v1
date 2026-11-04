// A chat opened on a thing starts with that thing's core tools listed, without a tool_search: an Ask about a file lists the file reads, a goal chat the goal tools, an Inbox chat the mail and calendar
// reads, a Vault chat the vault reads. The same idea as CORE_READ_TOOLS (the Inbox reads every turn lists), but by where the chat is. Reads and the few writes that place is for; nothing here widens
// what the asker may do (the tool session still filters by access and the Gate still holds what it holds). Keep each list short: every listed tool is paid for on every call of the turn.
export interface PlaceFacts { kind: string; scope?: { type: string; id: string } | undefined }

const MAIL = ["inbox_thread", "inbox_mark_read", "mail_draft", "calendar_find_time", "calendar_get_event"];
const BY_SCOPE: Readonly<Record<string, readonly string[]>> = {
  task: ["tasks_get", "tasks_history", "tasks_assign", "tasks_followers_add"],
  goal: ["goals_get", "goals_list", "goals_checkin_post", "goals_progress_read", "goals_activity", "goals_update", "tasks_list"],
  project: ["projects_get", "projects_plan", "projects_list", "tasks_list", "projects_link_tasks"],
  record: ["records_query", "records_history", "records_relate", "records_comments_add", "schema_describe"],
  contact: [...MAIL, "records_get", "records_history"],
  conversation: MAIL,
  file: ["files_get", "files_comments_list", "files_comments_add", "files_move", "files_copy"],
  folder: ["files_get", "files_create", "files_move", "files_folder_create"],
  automation: ["automations_get", "runs_list", "runs_get", "automations_run"],
  run: ["runs_get", "runs_list", "automations_get"],
  agent: ["agents_get", "agents_routines_list", "agents_routine_save", "skills_list"],
  site: ["sites_list", "sites_status", "sites_logs", "sites_previews"],
  mail: MAIL,
  inbox: MAIL,
  vault: ["vault_items_list", "vault_item_get", "vault_fill", "vault_use"],
  calendar: ["calendar_find_time", "calendar_get_event", "calendar_availability", "calendar_update_event", "calendar_respond"],
};
const BY_KIND: Readonly<Record<string, readonly string[]>> = {
  helper: ["crew_message", "crew_list"],
};

/** The tool names to list for a chat in this place, in addition to the ones every turn lists. A place with no entry adds nothing. */
export function placeTools(p: PlaceFacts): string[] {
  const out = new Set<string>(BY_KIND[p.kind] ?? []);
  const scope = p.scope;
  if (scope) {
    for (const n of BY_SCOPE[scope.type] ?? []) out.add(n);
    // a Place scope names the place in its id ("mail", "vault", "calendar")
    if (scope.type === "place") for (const n of BY_SCOPE[scope.id] ?? []) out.add(n);
  }
  return [...out];
}

export const PLACE_SCOPES: readonly string[] = Object.keys(BY_SCOPE);
