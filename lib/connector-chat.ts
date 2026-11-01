// The chats that build a connector: the titles the Vault (Add to Automations) and the step picker (Build a connector) give them, the skill they run on, and the tools that skill uses.
// A CLI engine lists its tools once when it starts and cannot pick up a tool found later with tool_search, so these are listed from the first turn of such a chat.

/** The titles of the chats Add to Automations and Build a connector start. */
export const CONNECTOR_CHAT = /^(Add .+ to Automations|Build a connector)$/;
export const CONNECTOR_SKILL = "connector-builder";

/** What the connector-builder skill calls beyond the default tools. */
export const CONNECTOR_TOOLS: readonly string[] = [
  "automations_draft_connector", "automations_read_docs", "automations_try_read", "automations_connector_card",
  "connectors_list", "connectors_get", "connectors_init", "connectors_define", "connectors_test", "connectors_publish",
  "connections_list", "connections_create", "agents_builtin_skill_get",
];

/** The titles of the chats Sync to Records (Vault), Bring in from your CRM (Records) and Edit mapping (the Sync page) start, the skill they run on, and the tools it uses beyond the defaults. */
export const CRM_CHAT = /^(Sync .+ to Records|Bring my CRM into Records|Change how .+ syncs to Records)$/;
export const CRM_SKILL = "crm-sync-builder";
export const CRM_TOOLS: readonly string[] = [
  "sync_specs_sample", "sync_specs_survey", "sync_specs_validate", "sync_specs_preview", "sync_specs_apply", "sync_specs_get", "sync_specs_backfill",
  "automations_draft_connector", "automations_read_docs", "automations_connector_card", "schema_types_list", "vault_use", "vault_request", "runs_get",
];

/** The crew tools, listed from the start in a chat inside a project: a person says "give it to a teammate", never a tool name, and the CLI cannot pick up a tool found later with tool_search. */
export const CREW_TOOLS: readonly string[] = ["crew_start", "crew_list", "crew_message", "crew_stop", "crew_wait", "crew_merge", "crew_push", "projects_list", "projects_teammates_list"];
