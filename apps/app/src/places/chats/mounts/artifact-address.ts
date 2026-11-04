// The whole address of an opened artifact: its public origin when the Space has one, else this app's own gateway.
export const artifactAddress = (open: { path: string; url?: string | undefined }, base: string | undefined, embed = false): string => {
  const at = open.url ?? `${(base ?? "").replace(/\/+$/, "")}${open.path}`;
  // a one-time code for the artifact host (/x/<code>): framed in the app, its cookie is partitioned to the app (the host's CSP lets only the app frame it)
  return embed && /\/x\/[0-9a-f]{48}$/.test(at) ? `${at}?embed=1` : at;
};

/** The link to copy and share: the plain address of the artifact on this app, which asks anyone who opens it to sign in. A one-time code is for opening, never for copying. */
export const plainLink = (base: string | undefined, artifactId: string): string => `${(base ?? "").replace(/\/+$/, "")}/a/${artifactId}`;
