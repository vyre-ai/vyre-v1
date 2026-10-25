// Subscription sign-ins (spec 4.14, 2.17; ARCH 6.4). The credential files a CLI sign-in produces are captured into a Mine Vault item of kind ai_subscription.
// This module sees the files only to hand them to the vault; it returns the handle and never the material.
export interface SubscriptionCapture {
  owner: string;
  /** Engine driver the sign-in belongs to, like claude_code or codex. */
  driver: string;
  /** File name to bytes, as the sandbox found them after login. */
  material: Readonly<Record<string, Uint8Array>>;
}

export interface SubscriptionItemDraft {
  kind: "ai_subscription";
  name: string;
  mine: true;
  ownerId: string;
  /** Field names only. Every field is secret. */
  fields: Array<{ name: string; secret: true }>;
}

export interface VaultItems {
  /** Create the item; the vault seals the values. Returns the item id and the handle agents use. */
  putItem(draft: SubscriptionItemDraft, values: Readonly<Record<string, Uint8Array>>): Promise<{ itemId: string; handle: string }>;
}

const TITLES: Readonly<Record<string, string>> = { claude_code: "Claude Code", codex: "Codex", grok: "Grok" };

export function draftFor(c: SubscriptionCapture): SubscriptionItemDraft {
  const names = Object.keys(c.material).sort();
  if (names.length === 0) throw new RangeError("a sign-in has at least one credential file");
  const title = TITLES[c.driver] ?? c.driver;
  return { kind: "ai_subscription", name: `${title} sign-in`, mine: true, ownerId: c.owner, fields: names.map((name) => ({ name, secret: true as const })) };
}

export async function captureSubscription(vault: VaultItems, c: SubscriptionCapture): Promise<{ itemId: string; handle: string; fields: string[] }> {
  const draft = draftFor(c);
  const { itemId, handle } = await vault.putItem(draft, c.material);
  return { itemId, handle, fields: draft.fields.map((f) => f.name) };
}

/** May a server run use this person's subscription? Only for a turn that person started or a routine or personal automation they own, and only while the standing switch is on. */
export function serverMayUse(a: { ownerId: string | null; spaceMayUse: boolean }, use: { startedBy?: string; routineOwner?: string }): boolean {
  if (!a.spaceMayUse || a.ownerId === null) return false;
  return use.startedBy === a.ownerId || use.routineOwner === a.ownerId;
}

export interface ShareDeps {
  setSwitch(owner: string, enabled: boolean): Promise<void>;
  /** Kill the person's server sandbox (and shred its tmpfs credentials). */
  stopSandbox(owner: string): Promise<boolean>;
}

/** engine.subscription_share.set: turning it off ends the person's sandbox. */
export async function setSpaceUse(deps: ShareDeps, owner: string, enabled: boolean): Promise<{ enabled: boolean; sandboxStopped: boolean }> {
  await deps.setSwitch(owner, enabled);
  const sandboxStopped = enabled ? false : await deps.stopSandbox(owner);
  return { enabled, sandboxStopped };
}
