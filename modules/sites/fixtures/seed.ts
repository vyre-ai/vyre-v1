// sites seed: nothing is created at install. The Deployments folder belongs to files; each site gets its own folder under it.

export const seed = {
  table: "sites_site",
  rows: [] as { id: string; name: string }[],
};
