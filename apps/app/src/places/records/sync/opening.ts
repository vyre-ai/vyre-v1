// The first messages of the sessions that bring an app into Records: from a Vault item (an app name and a handle, never a value), from Records (which app is asked), and to change a
// mapping that already exists. The crm-sync-builder skill carries the how; these carry only who and which. A name that looks like a pasted key is never repeated.
const SAFE_APP = "this app";
const SECRET_SHAPE = /(sk|pk|rk|ghp|gho|xox[abprs]|eyJ|AKIA|AIza)[-_A-Za-z0-9]{8,}/;
const KEY_WORD = /\s+(?:api[\s_-]*keys?|api[\s_-]*tokens?|access[\s_-]*tokens?|keys?|tokens?|secrets?|credentials?)$/i;

/** The item name as an app name. */
export function appNameOf(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "" || SECRET_SHAPE.test(trimmed.replace(/\s+/g, ""))) return SAFE_APP;
  // "Notely API key" names the key; the app is Notely. A name that is only the key word stays as it is.
  const cut = trimmed.replace(KEY_WORD, "").trim();
  const app = cut === "" || /^(?:api|access)$/i.test(cut) ? trimmed : cut;
  return app.length > 60 ? app.slice(0, 60).trim() : app;
}

/** Sync to Records on a Vault item. */
export function syncOpening(item: { name: string; handle: string }): string {
  return `Sync ${appNameOf(item.name)} to Records. Vault handle ${item.handle}. Load the crm-sync-builder skill. Never ask for the key.`;
}

/** Bring in from your CRM, in the Records sidebar: the app is not picked yet. */
export const BRING_IN_OPENING = "Bring my CRM into Records. Ask me which app. Look for its key in the Vault first. Load the crm-sync-builder skill. Never ask me to paste a key in chat.";

/** Edit mapping on the Sync page: the agent opens with the spec that made the type. */
export function editMappingOpening(a: { app: string; type: string }): string {
  return `Change how ${appNameOf(a.app)} syncs to Records. Record type ${a.type}. Read the spec with sync_specs_get, change it, check it with sync_specs_validate and apply it again. Load the crm-sync-builder skill.`;
}
