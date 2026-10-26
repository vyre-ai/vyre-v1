// Access levels. Default ladder is view < use < edit < manage. The Vault is a different ladder: Use (fill without seeing)
// is below View (see the value, reveal logged), so the order is use < view < edit < manage. Frozen; authorize reads this table.
import type { Level, ResourceType } from './types.ts';

export const DEFAULT_LADDER: readonly Level[] = ['view', 'use', 'edit', 'manage'];
export const VAULT_LADDER: readonly Level[] = ['use', 'view', 'edit', 'manage'];

export const LEVEL_LADDERS: Partial<Record<ResourceType, readonly Level[]>> = {
  vault_item: VAULT_LADDER,
  vault_folder: VAULT_LADDER,
};

export function ladderFor(type: ResourceType): readonly Level[] {
  return LEVEL_LADDERS[type] ?? DEFAULT_LADDER;
}

/** True when a grant at `have` satisfies a capability that needs `need` on a resource of `type`. */
export function levelIncludes(type: ResourceType, have: Level, need: Level): boolean {
  const l = ladderFor(type);
  const h = l.indexOf(have);
  const n = l.indexOf(need);
  return h >= 0 && n >= 0 && h >= n;
}

/** Every ResourceType, for validation. Keep in step with the union in types.ts (a type-level check below fails the build if they drift). */
export const RESOURCE_TYPE_LIST: readonly ResourceType[] = [
  'space', 'record_type', 'record', 'project', 'folder', 'file', 'channel', 'thread', 'inbox', 'mailbox',
  'vault_folder', 'vault_item', 'automation_group', 'automation', 'agent', 'connector', 'connection',
  'site', 'form', 'campaign', 'kit', 'terminal', 'computer', 'task', 'run', 'number', 'domain', 'calendar', 'note', 'email',
];
type Missing = Exclude<ResourceType, (typeof RESOURCE_TYPE_LIST)[number]>;
export const resourceTypeListIsComplete: [Missing] extends [never] ? true : never = true;
