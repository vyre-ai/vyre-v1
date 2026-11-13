// The data the screens draw for the Assistant's app building (AUTOMATIONS-2026-11-13 Part 4): the one read of apps and suggestions, and the four cards. Types only, so the screens and the server agree before
// either is finished. No card ever carries a secret value: the value goes from the person's screen to the Vault in one call (chat.secret.submit) and the agent hears only "saved as #Handle" or "not given".

/** One app a person can see in the step picker and the Connect an app sheet. */
export interface AppInfo {
  id: string;
  name: string;
  /** The Space has it connected. */
  connected: boolean;
  /** This person may use it in a step. */
  mayUse: boolean;
  /** A company key: no agent may use it, so it is never offered. */
  company?: boolean;
  /** Who can connect it when this person cannot (a name). */
  admin?: string;
  /** The Vault item it would be made from. `assistant`: cleared = the Assistant may already use it here; owner = this person may clear it with one tap; admin = only an admin can. */
  vault?: { item: string; use: "use" | "view" | "none"; assistant: "cleared" | "owner" | "admin" };
  /** The app's own icon, fetched once and served from the Space's own origin. Absent when there is none: the screen draws its built-in mark, then a letter tile. */
  iconUrl?: string;
}

/** A Vault item that could become an app, for the first page. */
export interface AppSuggestion {
  id: string;
  app: { id: string; name: string };
  item: string;
  mayUse: boolean;
  knownService: boolean;
  assistant: "cleared" | "owner" | "admin";
}

/** automations.app_context.list: every app the caller may see, the short list of known apps for the Add an app search, and the suggestions. */
export interface AppContextList {
  apps: AppInfo[];
  known: Array<{ id: string; name: string }>;
  suggestions: AppSuggestion[];
}

/** ask_secret: a masked field. The value is typed into the card and submitted with chat.secret.submit; it is in that one call and nowhere else. */
export interface SecretCard {
  kind: "secret";
  app: { id: string; name: string };
  /** What to paste ("Lawmatics API token"). */
  label: string;
  /** Where to find it, written only from documentation the Assistant read; absent until it has read it. */
  hint?: string;
  /** The name the Vault item will have. */
  itemName: string;
  forAutomation?: string;
  /** "Saved to your Vault as Lawmatics" */
  shows: string;
  /** "Only you and this Automation" */
  whoCanUse: string;
}
/** The answer the agent hears: never the value. */
export type SecretAnswer = { saved: string } | { notGiven: true };

/** assistant_use_grant: let the Assistant use a Vault item inside one Automation. Allow when the person may clear it, Ask admin when only an admin can. */
export interface GrantCard {
  kind: "grant";
  item: { name: string };
  automation: { id: string; name: string };
  assistant: "owner" | "admin";
  /** The admin to ask, by name, when `assistant` is admin. */
  admin?: string;
}

/** One Needs-you line for a build that waits on the person. The same line is read by Automations Home and the Inbox. */
export interface WaitLine {
  kind: "wait";
  reason: "secret" | "event" | "admin" | "choice";
  app?: { id: string; name: string };
  automation: string;
  /** Plain words: "Needs your Lawmatics token". */
  text: string;
  since: number;
  /** The one reminder after 24 hours; set once it has been sent. */
  remindedAt?: number;
}

/** The look-first card: the forms found on the person's site. */
export interface FormsFoundCard {
  kind: "forms";
  site: string;
  forms: Array<{ id: string; name: string; page: string; plugin?: string; picture?: string }>;
}

// ---- the Needs-you read: `automations.needs_you.list`, one read for Automations Home and the Inbox (lead, 13 Nov)

/** What the person presses to clear it. */
export type FixKind =
  | "add_key"
  | "choose_value"
  | "allow_assistant"
  | "approve_sends"
  | "reconnect"
  | "ask_admin"
  | "continue_build";

export interface NeedItem {
  id: string;
  automation: { id: string; name: string };
  /** Plain words, never a code or a field key. */
  why: string;
  fix: FixKind;
  /** The run it belongs to, when a run stopped. */
  run?: string;
  app?: { id: string; name: string };
  /** Who to ask, by name, when `fix` is ask_admin. */
  admin?: string;
  /** The chat thread or card to continue in, for a build that waits and for allow_assistant. */
  thread?: string;
  since: number;
  /** A build that waits: the one reminder after 24 hours, set once sent. */
  remindedAt?: number;
}

/** Answered as the caller: only their own Automations and those shared with them. */
export interface NeedsYouRead {
  needs: NeedItem[];
  today: { ran: number; failed: number };
}

// ---- draft against live: `automations.draft.*`

/** One overlay serves the Assistant's proposal (Accept, Change, Discard) and a person's own edits to an On Automation (Make live, Discard changes). */
export interface AutomationVersions {
  automation: string;
  /** What runs. An Automation saved before drafts existed has only this. */
  live: unknown;
  /** The unsaved-as-live edit, when there is one. */
  draft?: unknown;
  /** The draft differs from live. */
  differs: boolean;
  /** Who made the draft: the Assistant proposed it, or the person edited. */
  draftBy?: "assistant" | "person";
  draftAt?: number;
  /** Plain words for the bar: "Assistant's draft, 3 steps. Nothing is on yet." */
  summary?: string;
}
