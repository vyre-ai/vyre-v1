// Manifest types, ARCHITECTURE-V1.md section 3 (frozen). Changes only by the lead.
// Differences from the document, all deliberate and listed in team/v1/prep/MANIFESTS.md:
//  - `Schema` is a plain JSON Schema object (no TypeBox dependency in prep); the DSL in dsl.ts builds it.
//  - `CapabilityDef.gate` may carry `reason` (needed for the explicit `act: 'none'` form of section 3.7).

export interface JsonSchema {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'null' | Array<'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'null'>;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  description?: string;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
  examples?: unknown[];
  title?: string;
  $ref?: string;                                    // '#/$defs/<name>', only in the serialized registry
}

export type Schema = JsonSchema;                    // JSON Schema 2020-12 subset
export type Semver = string;
export type Level = 'view' | 'use' | 'edit' | 'manage';
export type Risk = 'low' | 'medium' | 'high';
export type Label = 'public' | 'internal' | 'confidential' | 'restricted';   // ranks 0..3
export type PermissionKey = string;                 // must exist in some manifest's permissions[]
export type CapName = `${string}.${string}`;        // 'records.update'
export type EventName = `${string}.${string}`;      // 'record.updated'
export type ComponentKey = string;                  // key in the @vyre/ui component registry, e.g. 'ui:RecordPage'
export type RoleName = 'owner' | 'admin' | 'developer' | 'member' | 'guest' | (string & {});
export type PlaceId = 'join' | 'home' | 'chats' | 'inbox' | 'records' | 'files' | 'apps' | 'automations' | 'vault' | 'settings' | 'console';
export type ResourceType =
  | 'space' | 'record_type' | 'record' | 'project' | 'folder' | 'file' | 'channel' | 'thread' | 'inbox' | 'mailbox'
  | 'vault_folder' | 'vault_item' | 'automation_group' | 'automation' | 'agent' | 'connector' | 'connection'
  | 'site' | 'form' | 'campaign' | 'kit' | 'terminal' | 'computer' | 'task' | 'run' | 'number' | 'domain' | 'calendar' | 'note';

export interface Manifest {
  manifest: 1;
  id: string;                          // kebab, unique: 'records', 'google'
  version: Semver;                     // module semver; bump rules in section 3.6
  title: string;
  kind: 'module' | 'connector' | 'kit';
  owner: string;                       // lane id, for review routing; checked against the lane table (12.3)
  requires?: Record<string, Semver>;   // other manifest ids this one calls (capabilities) or extends
  permissions?: PermissionDef[];
  capabilities?: CapabilityDef[];
  events?: EventDef[];
  entities?: EntityDef[];              // core synced tables
  recordTypes?: RecordTypeDef[];       // built-in record types (agents, projects, contacts ...)
  fieldTypes?: FieldTypeDef[];
  viewKinds?: ViewKindDef[];
  steps?: StepDef[];
  triggers?: TriggerDef[];
  connectors?: ConnectorDef[];
  agentTools?: AgentToolDef[];         // tools that are not 1:1 with a capability
  blocks?: BlockTypeDef[];             // native blocks agents send
  screens?: KitScreenDef[];
  health?: HealthCheckDef[];
  gateActs?: GateActKindDef[];
  taskKinds?: TaskKindDef[];
  notificationKinds?: NotificationKindDef[];
  importSources?: ImportSourceDef[];
  settings?: SettingDef[];             // per-Space policies and per-person settings rows
  retention?: RetentionDef[];
  fixtures?: { seed?: string; golden?: string[] };   // paths relative to the module
  lists?: ListDef[];                   // resource lists that get Personal / Shared with me / Space sections, folders and the share sheet (4.12)
}

// ---- 3.2 Permission, capability, error ----

export interface PermissionDef {
  key: PermissionKey;                  // 'records.edit'
  area: 'space' | 'records' | 'files' | 'chats' | 'agents' | 'automations' | 'comms' | 'vault' | 'ai' | 'server'
      | 'apps' | 'sites' | 'kits' | 'runs' | 'terminal';
  title: string;                       // matrix row label
  risk: Risk;
  defaults: Partial<Record<RoleName, boolean>>;   // built-in role columns
  appliesTo: ResourceType[];
}

export type ErrorGroup = 'auth' | 'rate_limit' | 'validation' | 'provider' | 'timeout' | 'permission' | 'internal';
export type ErrorCode = `${ErrorGroup}.${string}`;   // 'permission.above_clearance', 'validation.field_locked'

export interface CapabilityDef {
  name: CapName;
  v: number;                           // contract version, starts at 1; breaking change = new v (section 3.6)
  summary: string;                     // one line, used by docs, MCP, tool_search
  input: Schema;
  output: Schema;
  errors: ErrorCode[];                 // every code the handler may return; contract test enforces
  resource: ResourceBinding;           // what authorize checks
  permission: PermissionKey | null;    // role permission needed; null = grant-only
  level: Level | 'member';             // grant level needed on the resource; 'member': any role or grant in the Space (no level on the resource), rows are then filtered per resource by the handler (ruling 69)
  risk: Risk;
  effects: 'read' | 'write' | 'outward';       // outward = leaves the Space (send, post, pay, deploy, push)
  gate?: { act: string; when?: string; reason?: string };   // GateActKind key; `when` is an Expr over input; `act: 'none'` needs `reason`
  emits: EventName[];                  // every event the handler may append
  idempotency: 'key' | 'natural' | 'none';     // 'key' = input.idempotencyKey required
  audit?: 'always' | 'sensitive' | 'none';
  label?: 'check' | 'filter';          // how sensitivity labels apply to results (check = fail; filter = omit)
  offline?: 'patch' | 'queue' | 'online';      // sync: 'patch' = field ops, 'queue' = replay as call, 'online' = never queued
  run?: { kind: string; stoppable: boolean };  // capability starts a Run and returns {runId}
  rate?: { n: number; perSeconds: number; scope: 'principal' | 'space' };
  surfaces: {
    http?: 'auto' | { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string };
    mcp?: { toolset: Toolset; name?: string; deferred?: boolean };   // deferred = found by tool_search, not listed
    agent?: boolean | { planMode: 'allowed' | 'blocked'; blocks?: string[] };   // default: true when mcp set
    cli?: string;                      // 'vyre records query'
    outboundWebhook?: boolean;         // may be subscribed from Console > Webhooks
  };
  examples: { name: string; input: unknown; output: unknown }[];            // >= 1; drives contract tests and docs
  forbids?: { name: string; as: RoleName | 'guest-no-grant'; input: unknown; error: ErrorCode }[];  // permission matrix tests
  caller?: Caller;                     // who may call: default 'principal'. 'anonymous' (before sign-in) and 'pending' (invited, not yet a member) never reach agents
  teamOnly?: boolean;                  // refused with a `permission.needs_team` error in a Personal Space (spec 2.1 matrix)
  since: Semver;
}
/** Kind of caller a capability accepts. Pre-auth capabilities (sign-in, accept invite, pair, recovery, public forms) are not principal calls. */
export type Caller = 'principal' | 'anonymous' | 'pending';

/** A resource named in the call input; the gateway authorizes the type and id it names. */
export interface ResourceRefValue { type: ResourceType; id: string }

export type Toolset =
  | 'records' | 'files' | 'memory' | 'vault' | 'automations' | 'chats' | 'inbox' | 'sites' | 'terminal'
  | 'computer' | 'agents' | 'tasks' | 'meta' | 'engineer';

export type ResourceBinding =
  | { type: ResourceType; id: string /* JSON pointer into input, e.g. '/recordId' */; parent?: string; resolve?: 'name' | 'handle' /* the pointer holds a Vault name or handle that the gateway resolves to the id before authorize */ }
  | { type: ResourceType; create: true; parent: string }       // creation checks the parent
  | { type: 'entity'; entity: string; id: string /* JSON pointer to the row id; access comes from the EntityDef acl (parent, multi, fallback, owner) */ }
  | { type: 'dynamic'; ref: string /* JSON pointer to a {type,id} ResourceRef input */; allowed?: ResourceType[]; parent?: string }
  | { type: 'space' };

// The shared error shape, spec 4.18.
export interface VyreError {
  code: ErrorCode;
  message: string;                     // plain words, no ids
  cause?: { source: 'provider' | 'upstream' | 'internal'; provider?: string; status?: number; code?: string; message?: string };
  next: NextStep[];                    // never empty for a user-visible error
  retryable: boolean;
  traceId: string;
  details?: Record<string, unknown>;   // never secret values
}
export interface NextStep {
  kind: 'retry' | 'switch_model' | 'use_backup_key' | 'ask_access' | 'open_settings' | 'reconnect' | 'edit_input' | 'wait' | 'contact_admin' | 'report';
  label: string;
  action?: { cap: CapName; input: unknown };
}

// Trace context, 4.9. Header `x-vyre-trace: <traceId>-<spanId>-<parentSpanId>`; WebSocket frames carry `tr`.
export interface TraceContext {
  traceId: string;                     // 16 random bytes, 32 hex
  spanId: string;                      // 8 random bytes, 16 hex
  parent?: string;                     // parent span id
  links?: string[];                    // trace ids of related long-lived Runs
}

// ---- 3.3 Events, entities, record types, fields, views ----

export interface EventDef {
  name: EventName;                     // 'record.updated'
  sv: number;                          // schema version
  summary: string;
  payload: Schema;                     // no secret values; sealed fields appear as {sealed:true,changed:true}
  subject: { type: ResourceType | 'entity'; id: string /* JSON pointer in payload */ };
  vis: 'space' | 'participants' | 'owner' | 'private';  // who the sync/live filter may deliver it to (before ACL)
  e2e?: 'none' | 'owner';              // 'owner' = payload is ciphertext under the person's key
  label?: Label | 'subject';           // 'subject' = inherits the subject's label; redaction by clearance
  redact?: string[];                   // payload JSON pointers removed for readers below clearance
  trigger?: { fields?: string[]; title: string };   // usable as an Automation trigger; fields = filterable payload pointers
  notify?: string;                     // NotificationKind key
  retention?: string;                  // RetentionDef key
  replay: 'pure' | 'stub';             // 'stub' = outward effects recorded not executed in replay sandbox
}

export interface EntityDef {           // a core synced table (messages, tasks meta, files meta ...)
  key: string;                         // 'message'
  table: string;                       // projection table name, prefixed by module id
  idPrefix: string;                    // 'msg_'
  fields: Record<string, EntityFieldDef>;
  parent?: { entity: string; field: string };          // ACL inherits from parent
  acl: {
    resource: ResourceType; parentField?: string; ownerField?: string;
    multi?: boolean;                   // parentField holds many parent ids (a mail message in several mailboxes); any parent that grants is enough
    fallback?: { resource: ResourceType; field: string };   // used when parentField is empty (an unmatched conversation): access comes from this resource
  };
  sync: {
    profile: { desktop: 'all' | 'window' | 'none'; phone: 'all' | 'window' | 'none'; web: 'all' | 'window' | 'none' };
    window?: { days?: number; starred?: boolean; recentCount?: number };
    e2e?: 'none' | 'owner';
    maxLabel?: Label;                  // above this, rows are never mirrored (restricted: never on laptops)
    text?: string[];                   // fields that are Yjs docs
    protectedFields?: string[];        // go to the assistant on conflict (status, owner, money, locked, sealed)
  };
  fts?: string[];                      // fields indexed by search
  retention?: string;
}
export interface EntityFieldDef { type: string /* FieldTypeKey */; label?: Label; writeOnlyBy?: CapName[]; required?: boolean }

export interface RecordTypeDef {       // dynamic table rt_<key>; created by schema.apply at runtime or by manifests
  key: string;                         // 'contact', 'project', 'agent'
  title: string; plural: string; icon: string;
  system?: boolean;                    // cannot be dropped; some fields locked
  template?: 'project' | null;         // Journeys clone 'project'
  label: Label;
  titleField: string; summaryField?: string; statusField?: string; ownerField?: string;
  fields: FieldDef[];
  views?: SavedViewDef[];
  workspace?: boolean;                 // channel + folder + plan (Projects and Journey types only)
  group?: string;                      // sidebar group in Records
  scope?: 'space' | { site: string };  // site tables
  retention?: string;
  attribution?: boolean;               // First/Latest source field group
}
export interface FieldDef {
  key: string; type: string /* FieldTypeKey */; title: string;
  label?: Label;
  required?: boolean; unique?: boolean; default?: unknown | { expr: string };
  validate?: { expr: string; message: string };
  lockAfter?: 'approval';
  merge?: 'lww' | 'assistant' | 'text-crdt' | 'append';       // default from the field type
  writeOnlyBy?: CapName[];
  options?: Record<string, unknown>;   // validated by the field type's `options` schema
}

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'starts' | 'empty' | 'notempty' | 'between' | 'rel_in';
export interface FieldTypeDef {
  key: string;                         // 'money', 'sealed', 'ai', 'button' ... full list in spec 2.9
  title: string;
  storage: { columns: { suffix: string; sql: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB' }[] } | { derived: 'formula' | 'lookup' | 'rollup' | 'auto' | 'none' };
  value: Schema;                       // JSON shape of one value
  options?: Schema;                    // shape of FieldDef.options
  merge: 'lww' | 'assistant' | 'text-crdt' | 'append';
  sealed?: boolean;                    // value is ciphertext at rest; agents get a handle
  filterOps: FilterOp[]; sortable: boolean; groupable: boolean; indexable: boolean;
  cell: ComponentKey; editor: ComponentKey; csv: 'text' | 'json' | { codec: string };
  codec?: string;                      // named codec exported from impl.ts: parse, format, compare, toText
}

export interface ViewKindDef {
  key: 'table' | 'board' | 'calendar' | 'timeline' | 'gallery' | 'list' | 'map' | 'form' | 'chart' | (string & {});
  title: string;
  needs?: { fieldType: string; as: string }[];         // e.g. board needs a choice or status field as 'group'
  config: Schema;
  component: ComponentKey;
  query: 'rows' | 'aggregate';
}
export interface SavedViewDef { key: string; kind: string; title: string; config: unknown; shared?: boolean; filter?: unknown; sort?: unknown; group?: string }

// ---- 3.4 Steps, triggers, connectors, agent tools ----

export interface StepDef {             // an Automation / Journey / Campaign step kind
  key: string;                         // 'records.update', 'send_email', 'ai', 'wait_stage'
  title: string; category: 'data' | 'send' | 'ai' | 'control' | 'wait' | 'code' | 'sheet' | 'sign' | 'journey';
  kind: 'capability' | 'ai' | 'control' | 'wait' | 'code';
  cap?: CapName;                       // kind 'capability': the step is exactly this capability call (input mapping + templating)
  input: Schema; output: Schema;
  effects: 'read' | 'write' | 'outward';
  gateAct?: string;
  errors: ErrorCode[];
  retry: { max: number; backoff: 'none' | 'linear' | 'exp'; baseMs: number };
  idempotency: 'key' | 'natural' | 'none';
  compensate?: CapName;                // used by "Undo this run" where possible
  editor: ComponentKey;
  sample: unknown;                     // sample output for test mode
  waits?: { timeoutDefault: string; cancelsOn: EventName[] };
}
export interface TriggerDef {
  key: string;                         // 'record_change', 'schedule', 'webhook', 'form_submit', 'email_received' ...
  title: string;
  source:
    | { event: EventName; filter?: Schema }
    | { events: EventName[]; filter?: Schema }                   // several events fire the same trigger (record created, updated, deleted)
    | { schedule: true; ifMissed: ('skip' | 'run_once')[] }
    | { webhook: true; path: string }
    | { manual: true } | { button: true };
  payload: Schema;                     // what the run receives as $trigger
  sample: unknown;
  allowSelfTrigger: boolean;           // default false; chain depth limit 8 enforced by the engine
  personalOk: boolean;                 // false for webhook triggers (needs a Team Space); capabilities carry the same flag as `teamOnly` (3.2)
}

export interface ConnectorDef {
  key: string;                         // 'hubspot', 'google', 'zoom'
  title: string;
  mode: 'api' | 'mcp' | 'dwd' | 'oauth_app' | 'webhook_only';
  scope: 'person' | 'space';           // who owns a Connection
  auth:
    | { type: 'api_key'; secret: string }
    | { type: 'oauth2'; authUrl: string; tokenUrl: string; scopes: string[]; pkce: boolean }
    | { type: 'service_account_dwd'; scopes: string[] }
    | { type: 'client_credentials'; tokenUrl: string; scopes: string[] }
    | { type: 'hmac_webhook'; header: string; algo: 'sha256' | 'sha1'; secret: string }
    | { type: 'github_app'; appIdSecret: string; privateKeySecret: string; permissions: Record<string, 'read' | 'write'>; installation: 'org' | 'repo' };   // installation tokens minted per call, 1 hour
  domains: string[];                   // the only egress hosts (enforced by ctx.http)
  secrets: { name: string; description: string }[];    // names only, resolved from the Vault
  sources?: { key: string; path: string; verify: 'hmac' | 'signature' | 'none'; event: EventName; dedupe: string /* JSON pointer */ }[];
  syncedTypes?: SyncedTypeDef[];
  actions?: CapName[];                 // capabilities this connector contributes
  rate: { rps: number; burst: number };
  health: string;                      // HealthCheckDef key
  tests: string;                       // folder of recorded responses
}
export interface SyncedTypeDef {
  type: string;                        // record type key
  remote: string;                      // remote object name
  fields: { key: string; remote: string; dir: 'pull' | 'push' | 'both' | 'off'; transform?: string }[];
  match: string[]; createAtSource: boolean; deletes: 'off' | 'soft' | 'travel';
  conflict: 'newest' | 'source' | 'vyre' | 'ask';
  polling: { activeSec: number; idleSec: number; dormantSec: number }; nightlyReconcile: boolean;
}

export interface AgentToolDef {        // agent-only tools (capability-backed tools come from capabilities[])
  name: string;                        // 'terminal_run', 'ask_question', 'plan_propose', 'wait_for'
  summary: string;
  input: Schema; output: Schema;
  cap?: CapName;                       // if backed by a capability, input/output default to it
  local?: 'terminal' | 'chrome' | 'screen' | 'files' | 'none';   // where it executes
  effects: 'read' | 'write' | 'outward';
  planMode: 'allowed' | 'blocked';
  blocks?: string[];                   // BlockType keys the result renders as
  deferred?: boolean;
  examples: { input: unknown; output: unknown }[];
}

// ---- 3.5 Blocks, Kit screens, health, Gate acts, tasks, notifications ----

export interface BlockTypeDef {        // spec "native blocks"; unknown types render as a generic block with the trace id
  type: string;
  v: number;
  data: Schema;
  actions?: { key: string; label: string; cap: CapName; input: Record<string, string> /* pointers into block data */ }[];
  opens?: { tab: string; input: Record<string, string> };     // "open as tab"
  waitsForAnswer?: boolean;            // question, plan: the turn parks until answered
  component: ComponentKey;
  fallback: string;                    // text template for CLI/mail/phone-notification rendering
}

export type LayoutNode =
  | { t: 'stack' | 'row'; gap?: number; children: LayoutNode[] }
  | { t: 'list' | 'table' | 'board'; bind: string; row: LayoutNode; empty?: string }
  | { t: 'text'; value: string; style?: string }
  | { t: 'field'; bind: string; field: string }
  | { t: 'button'; label: string; action: string }
  | { t: 'use'; component: ComponentKey; props?: Record<string, string> }
  | { t: 'when'; expr: string; then: LayoutNode; else?: LayoutNode };

export interface ListDef {             // spec 2.4: every list of things is organised the same way
  type: ResourceType;
  title: string; plural: string;
  items: CapName;                      // capability that lists items (receives {section, folder})
  folders: boolean;                    // folders with counts in the sidebar
  newItemStartsPersonal: true;         // fixed by the spec; present so a lint can assert nobody sets it false
  shareLevels: Level[];                // which of view/use/edit/manage the share sheet offers (vault: use/edit/manage)
}

export interface KitScreenDef {
  id: string;                          // 'inbox.contact-tab'
  place: PlaceId | 'shell';
  slot: 'main' | 'side' | 'sidebar' | 'sheet' | 'tab' | 'popover';
  caller?: Caller;                     // screens shown before sign-in ('anonymous') or before membership ('pending'); they may call capabilities of the same caller kind
  builtin?: ComponentKey;              // built-in screens bind to a registered component
  layout?: LayoutNode;                 // declarative screens (Kit-authored)
  queries: Record<string, { cap: CapName; input: Record<string, string>; live: boolean; local?: 'sql' }>;
  actions: Record<string, { cap: CapName; input: Record<string, string>; confirm?: string; undo?: boolean }>;
  states: { empty: { line: string; primary?: string }; offline: { line: string }; error: { line: string; primary: string } };
  menus?: { target: string; items: { label: string; icon: string; action: string; keys?: string; when?: string }[] }[];
  keys?: { combo: string; action: string; when?: string }[];
  needs?: PermissionKey[];
  perf?: { firstPaintMs: number; completeMs: number };         // checked by the perf harness
  ask?: { suggestions: Partial<Record<Level, string[]>> };     // Ask pane greeting and chips by the viewer's level (4.13)
}

export interface HealthCheckDef {
  key: string;
  title: string;
  cap: CapName;                        // cheap idempotent read; returns {state, detail?}
  intervalSec: number; timeoutMs: number;
  states: { degradedWhen?: string; downWhen?: string };        // Expr over result/latency
  dependsOn?: string[];
  pauses?: ('automations' | 'sync' | 'sends' | 'campaigns')[]; // visible reason shown on the paused thing
  next: string;                        // plain next step shown when not healthy
}

export interface GateActKindDef {
  key: string;
  title: string; risk: Risk;
  preview: { blocks: { type: string; from: string /* template over input */ }[] };    // exact preview
  approvers: { default: string /* 'role:admin' | 'owner' | 'asker' */; peopleOnly: boolean; agentOkFor?: Risk };
  timeout: { afterHours: number; onTimeout: 'drop' | 'escalate'; escalateTo: 'delegate' | 'role'; emailBackstopHours: number };
  appliesTo: { actors: ('agent' | 'automation' | 'campaign')[]; humanToo: boolean };   // humanToo: launches, promotes, protected pushes, exports
  sendsOnApprove: CapName;             // re-invoked with an approval token bound to the payload hash
}

export interface TaskKindDef {
  key: 'work' | 'approve' | 'review' | 'answer' | 'unblock' | 'signature' | (string & {});
  title: string;
  needsYou: boolean;                   // appears in Needs you when Ready
  slots: ('assigned' | 'reviewer' | 'approver')[];
  initial: TaskState;
  closeOn: 'complete' | 'act';
  actions: { key: string; label: string; to?: TaskState; cap?: CapName; note?: 'required' | 'optional' }[];
  blocks: string[];
}
export type TaskState = 'todo' | 'doing' | 'in_review' | 'awaiting_approval' | 'done' | 'canceled';

export interface NotificationKindDef {
  key: string;
  level: 'interrupt' | 'badge' | 'digest';
  place: PlaceId;
  title: string; body?: string;        // templates; push never includes content, only `pushTitle`
  pushTitle?: string;
  collapseKey: string;                 // template: 'approval:{{subject}}'
  respectHours: boolean;
  actions?: { label: string; cap: CapName }[];
  agentRateKey?: string;               // counts toward the 3 per hour agent interrupt cap
  backstopEmailAfterHours?: number;
}

export interface ImportSourceDef { key: string; title: string; accepts: string[]; parse: CapName; mapsTo: 'record_type' | 'vault' | 'files' | 'contacts' }
export interface SettingDef { key: string; scope: 'space' | 'person'; page: string; title: string; schema: Schema; default: unknown; floorable?: boolean }
export interface RetentionDef { key: string; title: string; default: string /* '90d' */; holdable: boolean; tombstone: boolean }
