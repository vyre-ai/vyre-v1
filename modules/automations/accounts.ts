// The account a step shows. A stored id stays, even when another account is active or this one is paused, pending, or needs reconnect.
// A step with no id may start from the only usable account, one id already stored on a sibling step, or the last explicit pick.
// chooseAccount does not write and does not call the network. rememberAccountPicks is the only write, and it runs from create and update.
import type { Db, Definition } from "./projections.ts";

export interface AccountOption {
  app: string;
  id: string;
  title: string;
  state: string;
}

export type AccountChoice =
  | { id: string; chosen: "stored" | "only" | "sibling" | "last" }
  | { chosen: "none" };

export interface ChooseAccountInput {
  input: Record<string, unknown>;
  /** "mail" for a mailbox step. Otherwise the connector, or "connection" when the step has no connector. */
  app: string;
  /** Other nodes in the same definition. */
  nodes?: readonly { input: Record<string, unknown> }[];
  accounts?: readonly AccountOption[];
  /** Last explicit pick for this principal, keyed by app. */
  last?: Readonly<Record<string, string>>;
}

const UNUSABLE = new Set(["paused", "pending", "needs_reconnect"]);

function textId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isUnusable(state: string): boolean {
  return UNUSABLE.has(state);
}

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

/** The id this input already stores for `app`, if any. Mail reads mailboxId. A connection reads connectionId when the connector matches. */
export function storedIdForApp(input: Record<string, unknown>, app: string): string | undefined {
  const mailboxId = textId(input["mailboxId"]);
  if (app === "mail" && mailboxId) return mailboxId;
  const connectionId = textId(input["connectionId"]);
  if (!connectionId) return undefined;
  const connector = textId(input["connector"]);
  return (connector ?? "connection") === app ? connectionId : undefined;
}

function usableAccounts(accounts: readonly AccountOption[], app: string): AccountOption[] {
  return accounts.filter((account) => account.app === app && !isUnusable(account.state));
}

/** One stored id for this app on another step. Disagreeing ids are not a guess. A known unusable id is not a new default. */
function siblingId(nodes: readonly { input: Record<string, unknown> }[], app: string, accounts: readonly AccountOption[]): string | undefined {
  const ids: string[] = [];
  for (const node of nodes) {
    const id = storedIdForApp(inputRecord(node.input), app);
    if (!id) continue;
    const known = accounts.find((account) => account.app === app && account.id === id);
    if (known && isUnusable(known.state)) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length === 1 ? ids[0] : undefined;
}

export function chooseAccount(spec: ChooseAccountInput): AccountChoice {
  const input = inputRecord(spec.input);
  const connectionId = textId(input["connectionId"]);
  if (connectionId) return { id: connectionId, chosen: "stored" };
  const mailboxId = textId(input["mailboxId"]);
  if (mailboxId) return { id: mailboxId, chosen: "stored" };

  const accounts = spec.accounts ?? [];
  const usable = usableAccounts(accounts, spec.app);
  if (usable.length === 1) return { id: usable[0]!.id, chosen: "only" };
  if (usable.length > 1) {
    const sibling = siblingId(spec.nodes ?? [], spec.app, accounts);
    if (sibling) return { id: sibling, chosen: "sibling" };
    const remembered = spec.last?.[spec.app];
    if (remembered && usable.some((account) => account.id === remembered)) return { id: remembered, chosen: "last" };
  }
  return { chosen: "none" };
}

const REMEMBER = "INSERT OR REPLACE INTO automations_account_pick (principal_id, app, account_id, updated_at) VALUES (?, ?, ?, ?)";

/** Write one row per app for each stored connectionId or mailboxId. Later nodes in the definition win for the same app. */
export function rememberAccountPicks(db: Db, principalId: string, definition: Definition, now: number): void {
  const picks = new Map<string, string>();
  for (const node of definition.nodes) {
    const input = inputRecord(node.input);
    const mailboxId = textId(input["mailboxId"]);
    if (mailboxId) picks.set("mail", mailboxId);
    const connectionId = textId(input["connectionId"]);
    if (!connectionId) continue;
    const app = textId(input["connector"]) ?? "connection";
    if (app === "mail" && mailboxId) continue;
    picks.set(app, connectionId);
  }
  for (const [app, accountId] of picks) db.run(REMEMBER, principalId, app, accountId, now);
}

export function lastPicks(db: Db, principalId: string): Record<string, string> {
  const rows = db.all("SELECT app, account_id FROM automations_account_pick WHERE principal_id = ?", principalId) as { app: string; account_id: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.app] = row.account_id;
  return out;
}
