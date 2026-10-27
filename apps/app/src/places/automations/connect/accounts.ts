// The account a step shows. Same decision as modules/automations/accounts.ts.
// The app cannot import modules, so the pure choice is duplicated here. It does not write and does not call the network.
export interface AccountOption {
  app: string;
  id: string;
  title: string;
  state: string;
}

export type AccountChoice =
  | { id: string; chosen: "stored" | "only" | "sibling" | "last" }
  | { chosen: "none" };

export type AccountField = "connectionId" | "mailboxId";

export interface ChooseAccountInput {
  input: Record<string, unknown>;
  /** "mail" for a mailbox step. Otherwise the connector, or "connection" when the step has no connector. */
  app: string;
  nodes?: readonly { input: Record<string, unknown> }[];
  accounts?: readonly AccountOption[];
  last?: Readonly<Record<string, string>>;
}

export interface AccountMenuItem {
  label: string;
  checked: boolean;
  /** Absent when the row is not a real account. Selecting it must not change the step. */
  account?: AccountOption;
}

export interface AccountMenu {
  field: AccountField;
  value: string;
  items: AccountMenuItem[];
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

function schemaProperties(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
  const props = (schema as { properties?: unknown }).properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return undefined;
  return props as Record<string, unknown>;
}

/** Mail reads mailboxId. A connection reads connectionId when the connector matches, or "connection" when it has none. */
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

/** The field the picker writes. A stored id wins. Otherwise the catalog schema has to declare connectionId or mailboxId. */
export function accountFieldOf(input: Record<string, unknown>, schema?: unknown): AccountField | undefined {
  const props = schemaProperties(schema);
  const connectionStored = textId(input["connectionId"]) !== undefined;
  const mailboxStored = textId(input["mailboxId"]) !== undefined;
  const connectionDeclared = props ? Object.prototype.hasOwnProperty.call(props, "connectionId") : false;
  const mailboxDeclared = props ? Object.prototype.hasOwnProperty.call(props, "mailboxId") : false;
  if (connectionStored || (connectionDeclared && !mailboxStored)) return "connectionId";
  if (mailboxStored || mailboxDeclared) return "mailboxId";
  return undefined;
}

export function appForAccount(input: Record<string, unknown>, field: AccountField): string {
  if (field === "mailboxId") return "mail";
  return textId(input["connector"]) ?? "connection";
}

export function accountRow(account: Pick<AccountOption, "title" | "state">): string {
  return `${account.title} (${isUnusable(account.state) ? "needs reconnect" : account.state})`;
}

/** Write the chosen account onto the step input. Does not clear an id, and does not drop the other fields. */
export function applyAccount(input: Record<string, unknown>, field: AccountField, account: AccountOption): Record<string, unknown> {
  const next: Record<string, unknown> = { ...input, [field]: account.id };
  if (field === "connectionId" && account.app !== "connection") next["connector"] = account.app;
  return next;
}

export function accountMenu(spec: {
  input: Record<string, unknown>;
  schema?: unknown;
  nodes?: readonly { input: Record<string, unknown> }[];
  accounts?: readonly AccountOption[];
  last?: Readonly<Record<string, string>>;
}): AccountMenu | undefined {
  const field = accountFieldOf(spec.input, spec.schema);
  if (!field) return undefined;
  const app = appForAccount(spec.input, field);
  const accounts = (spec.accounts ?? []).filter((account) => account.app === app);
  const choice = chooseAccount({
    input: spec.input,
    app,
    nodes: spec.nodes ?? [],
    accounts,
    ...(spec.last ? { last: spec.last } : {}),
  });
  const selected = choice.chosen === "none" ? undefined : accounts.find((account) => account.id === choice.id);
  const value = selected
    ? accountRow(selected)
    : choice.chosen === "none"
      ? (accounts.length === 0 ? "No accounts yet" : "Choose an account")
      : choice.id;
  const items: AccountMenuItem[] = accounts.length === 0
    ? [{ label: "No accounts yet", checked: false }]
    : accounts.map((account) => ({
        label: accountRow(account),
        checked: choice.chosen !== "none" && account.id === choice.id,
        account,
      }));
  return { field, value, items };
}
