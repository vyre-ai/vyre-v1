// Inline reducers for site events. The deployer consumer is the durable cursor (ARCH 7.6).
// Handlers write the module tables; these folds rebuild the same facts from the log.

export interface SitesView {
  created: { siteId: string; name: string }[];
  deployed: { siteId: string; deploymentId: string; env: string }[];
  previews: { siteId: string; branch: string; url: string }[];
  removed: { siteId: string; branch: string }[];
  failures: { siteId: string; deploymentId: string }[];
  domains: { siteId: string; domain: string }[];
}

export function emptyView(): SitesView {
  return { created: [], deployed: [], previews: [], removed: [], failures: [], domains: [] };
}

function text(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

export function applySiteEvent(view: SitesView, type: string, payload: Record<string, unknown>): SitesView {
  const next: SitesView = {
    created: view.created.slice(),
    deployed: view.deployed.slice(),
    previews: view.previews.slice(),
    removed: view.removed.slice(),
    failures: view.failures.slice(),
    domains: view.domains.slice(),
  };
  if (type === "site.created") next.created.push({ siteId: text(payload, "siteId"), name: text(payload, "name") });
  if (type === "site.deployed") next.deployed.push({ siteId: text(payload, "siteId"), deploymentId: text(payload, "deploymentId"), env: text(payload, "env") });
  if (type === "site.build_failed") next.failures.push({ siteId: text(payload, "siteId"), deploymentId: text(payload, "deploymentId") });
  if (type === "site.domain_changed") next.domains.push({ siteId: text(payload, "siteId"), domain: text(payload, "domain") });
  if (type === "site.preview_created") {
    const row = { siteId: text(payload, "siteId"), branch: text(payload, "branch"), url: text(payload, "url") };
    const at = next.previews.findIndex((item) => item.siteId === row.siteId && item.branch === row.branch);
    if (at >= 0) next.previews[at] = row;
    else next.previews.push(row);
    next.removed = next.removed.filter((item) => !(item.siteId === row.siteId && item.branch === row.branch));
  }
  if (type === "site.preview_removed") {
    const row = { siteId: text(payload, "siteId"), branch: text(payload, "branch") };
    next.previews = next.previews.filter((item) => !(item.siteId === row.siteId && item.branch === row.branch));
    next.removed.push(row);
  }
  return next;
}

export const inline = {
  "site.created": (view: SitesView, payload: Record<string, unknown>) => applySiteEvent(view, "site.created", payload),
  "site.deployed": (view: SitesView, payload: Record<string, unknown>) => applySiteEvent(view, "site.deployed", payload),
  "site.build_failed": (view: SitesView, payload: Record<string, unknown>) => applySiteEvent(view, "site.build_failed", payload),
  "site.preview_created": (view: SitesView, payload: Record<string, unknown>) => applySiteEvent(view, "site.preview_created", payload),
  "site.preview_removed": (view: SitesView, payload: Record<string, unknown>) => applySiteEvent(view, "site.preview_removed", payload),
  "site.domain_changed": (view: SitesView, payload: Record<string, unknown>) => applySiteEvent(view, "site.domain_changed", payload),
};

export const consumers = {
  "sites.deployer": {
    cursor: "sites.deployer",
    events: ["site.deployed", "site.preview_created", "site.preview_removed", "site.domain_changed"],
  },
};
