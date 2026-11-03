// One handler per browser capability (manifests/browser.ts). They live in sites.ts.
import { sitesList, sitesRemove, sitesSet } from "./sites.ts";

export const handlers = {
  "browser.sites.list": sitesList,
  "browser.sites.remove": sitesRemove,
  "browser.sites.set": sitesSet,
};
