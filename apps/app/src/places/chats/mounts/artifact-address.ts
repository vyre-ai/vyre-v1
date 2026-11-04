// The address an opened artifact is framed or opened at. sites.artifact_open always returns a one-time code on the artifact host (/x/<code>); there is no keyed address any more.
export const artifactAddress = (open: { path: string; url?: string | undefined }, base: string | undefined, embed = false): string => {
  const at = open.url ?? `${(base ?? "").replace(/\/+$/, "")}${open.path}`;
  // framed in the app, the host's cookie is partitioned to the app (the host's CSP lets only the app frame it)
  return embed && /\/x\/[0-9a-f]{48}$/.test(at) ? `${at}?embed=1` : at;
};

/** The link to copy and share: the plain address of the artifact on this app, which asks anyone who opens it to sign in. A one-time code is for opening, never for copying. */
export const plainLink = (base: string | undefined, artifactId: string): string => `${(base ?? "").replace(/\/+$/, "")}/a/${artifactId}`;
