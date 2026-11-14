// The Vault items that hold a whole company's keys: the delegation key that can act as any member, and the sign-in app's secret. The server uses them through the Vault port and a person pastes them in; no model
// and no process a model drives ever gets one. Named here so the Vault, the connectors and the flow agree on what these are.
export const GOOGLE_KEY_HANDLE = "#Google_DWD";
export const MICROSOFT_KEY_HANDLE = "#Microsoft_App";

const COMPANY_KEY = /^#?(google_dwd|microsoft_app|sso_(google|microsoft|okta)[a-z0-9_]*)(\.[a-z0-9_]+)?$/i;

export const isCompanyKey = (handle: string): boolean => COMPANY_KEY.test(handle);

/** The handle a Vault item of this name gets (the Vault's own rule: runs of other characters become one underscore). */
const handleOfName = (name: string): string =>
  `#${
    name
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "item"
  }`;
/** Is an item of this name a company key? The save event names the item, not its handle. */
export const isCompanyKeyName = (name: string): boolean => isCompanyKey(handleOfName(name));

/**
 * The shared Vault folders the server keeps for itself, by name, declared once here. Most are labelled Restricted before anything goes in (company keys, the sign-in secret, the Space AI key, Voice), so
 * no agent can use what is in them; Sealed fields is not labelled. The name is NOT how a key for an agent is refused: that asks the folder's real label against the agent's clearance (access.clears), so a
 * renamed server folder is still refused and a person's own folder with one of these names is not refused for the name. These names only find the folders (and sort them in the Vault).
 * There is no flag on a folder that marks it as made by the server; the label is the only real marker.
 */
export const COMPANY_FOLDER = "Company connections";
export const SIGN_IN_FOLDER = "Sign-in";
export const SPACE_KEY_FOLDER = "Space AI key";
export const VOICE_FOLDER = "Voice";
export const SEALED_FOLDER = "Sealed fields";
export const SERVER_FOLDERS: readonly string[] = [
  COMPANY_FOLDER,
  SIGN_IN_FOLDER,
  SPACE_KEY_FOLDER,
  VOICE_FOLDER,
  SEALED_FOLDER,
];
