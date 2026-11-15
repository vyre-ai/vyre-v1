// One rule for "this file is a secret", by its name and, where a name is not enough, by what is inside. It is the file-name rule the product already used to keep secrets out of a live line
// (agent/src/drivers/cli/detail.ts SECRETY_FILE), moved here with the names that rule missed (a service-account key, a cloud credentials file, a keystore) so the two never disagree. Used by:
//   - the Rewind checkpoints (modules/engine/checkpoints.ts): a point never stores one, and a restore never writes or removes one;
//   - the live line of what a tool touches (agent/src/drivers/cli/detail.ts).
// It should also be used by anything else that copies a person's folder (a work-folder export, a backup of work folders): none does today (see the Rewind notes).

/** The words in a file's name that make it a secret: `credentials.json`, `secrets.yaml`, `token.json`, `.env`, `id_rsa`, `deploy.p8`. A word is cut by `.`, `_` or `-` or the ends of the name. */
const SECRET_WORD =
  /(^|[._-])(env|secret|secrets|credential|credentials|token|tokens|id_rsa|id_ed25519|id_ecdsa|id_dsa|key|keys|pem|p8|p12|pfx|npmrc|netrc|pgpass|htpasswd|pypirc|kdbx|keystore|jks|ppk|gpg|asc|kubeconfig|dockercfg|serviceaccount|service-account)([._-]|$)/i;
/** A browser profile's stores (cookies, saved logins, the key that seals them) are binary or sqlite files whose names carry no secret word. Matched on the whole file name, any case. */
const BROWSER_STORES = new Set([
  "cookies",
  "cookies-journal",
  "login data",
  "login data-journal",
  "login data for account",
  "web data",
  "web data-journal",
  "local state",
  "cookies.sqlite",
  "cookies.sqlite-wal",
  "logins.json",
  "key4.db",
  "key3.db",
  "cert9.db",
  "signons.sqlite",
]);
/** A service account key file is named for the account: `service-account-prod.json`, `serviceAccount.json`. */
const SERVICE_ACCOUNT = /service[-_ ]?account/i;
/** Folders whose whole contents are a person's own secrets. */
const SECRET_DIRS = new Set([
  ".aws",
  ".ssh",
  ".gnupg",
  ".kube",
  ".azure",
  ".config/gcloud",
  ".mozilla",
  "user data",
  "google-chrome",
  "chromium",
  ".config/google-chrome",
  ".config/chromium",
]);

/** True when the path (relative to a folder, `/` separated) names a secret. */
export function isSecretPath(rel: string): boolean {
  const parts = rel.split("/").filter((x) => x !== "" && x !== ".");
  if (parts.length === 0) return false;
  const base = parts[parts.length - 1]!;
  if (SECRET_WORD.test(base) || SERVICE_ACCOUNT.test(base) || BROWSER_STORES.has(base.toLowerCase())) return true;
  for (let i = 0; i < parts.length - 1; i++) {
    if (SECRET_DIRS.has(parts[i]!.toLowerCase())) return true;
    if (i + 1 < parts.length - 1 && SECRET_DIRS.has(`${parts[i]}/${parts[i + 1]}`.toLowerCase())) return true;
  }
  return false;
}

/** What inside a file makes it a secret whatever it is called: the shapes of private keys, a service-account key and the common vendors' tokens. Extended regular expressions, for `git grep -E` and JavaScript alike. */
export const SECRET_CONTENT_ERE = [
  "-----BEGIN [A-Z ]*PRIVATE KEY-----",
  '"type"[[:space:]]*:[[:space:]]*"service_account"',
  '"private_key"[[:space:]]*:',
  "AKIA[0-9A-Z]{16}",
  "aws_secret_access_key[[:space:]]*=",
  "(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}",
  "gh[pousr]_[A-Za-z0-9]{30,}",
  "xox[abprs]-[A-Za-z0-9-]{10,}",
];

const SECRET_CONTENT = new RegExp(SECRET_CONTENT_ERE.map((e) => e.replaceAll("[[:space:]]", "\\s")).join("|"));

/** True when the text holds a secret's shape (the first 256 KB is looked at). */
export function looksSecretContent(text: string): boolean {
  return SECRET_CONTENT.test(text.slice(0, 262_144));
}
