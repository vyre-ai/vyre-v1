// Shape of the merged registry produced by tools/gen (generated/registry.json). Hand-written, frozen.
import type {
  AgentToolDef, BlockTypeDef, CapabilityDef, ConnectorDef, EntityDef, ErrorCode, EventDef, FieldTypeDef, GateActKindDef, HealthCheckDef,
  ImportSourceDef, KitScreenDef, ListDef, Manifest, NotificationKindDef, PermissionDef, RecordTypeDef, RetentionDef, SettingDef, StepDef,
  TaskKindDef, TriggerDef, ViewKindDef,
} from './types.ts';

export type Owned<T> = T & { module: string };

export interface RegistryModule {
  id: string;
  version: string;
  title: string;
  kind: Manifest['kind'];
  owner: string;
  status: Manifest['status'];
  requires: string[];                    // derived from references plus any hand-written entries
}

export interface RegistryError { code: ErrorCode; group: string; http: number; retryable: boolean; summary: string }

export interface Registry {
  registryVersion: 1;
  modules: RegistryModule[];
  capabilities: Owned<CapabilityDef>[];
  events: Owned<EventDef>[];
  permissions: Owned<PermissionDef>[];
  entities: Owned<EntityDef>[];
  recordTypes: Owned<RecordTypeDef>[];
  fieldTypes: Owned<FieldTypeDef>[];
  viewKinds: Owned<ViewKindDef>[];
  steps: Owned<StepDef>[];
  triggers: Owned<TriggerDef>[];
  connectors: Owned<ConnectorDef>[];
  agentTools: Owned<AgentToolDef>[];
  blocks: Owned<BlockTypeDef>[];
  screens: Owned<KitScreenDef>[];
  health: Owned<HealthCheckDef>[];
  gateActs: Owned<GateActKindDef>[];
  taskKinds: Owned<TaskKindDef>[];
  notificationKinds: Owned<NotificationKindDef>[];
  importSources: Owned<ImportSourceDef>[];
  settings: Owned<SettingDef>[];
  retention: Owned<RetentionDef>[];
  lists: Owned<ListDef>[];
  errors: RegistryError[];
}
