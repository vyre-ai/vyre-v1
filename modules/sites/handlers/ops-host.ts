// The seam the host calls for site operations (r42-sites-run): a tick every couple of seconds, and a line of the ingress's access log. The module supplies the runner and the host-to-site lookup.
import { accessLine, opsTick } from "../ops/instance.ts";
import type { OpsHost } from "../ops/instance.ts";
import type { OpsDb } from "../ops/store.ts";
import { routeByHost, routesHost, siteRunner } from "./route.ts";

const host: OpsHost = {
  runner: () => siteRunner(),
  siteOfHost: (db, h) => routeByHost({ db }, h, routesHost()?.sitesDomain?.() ?? null)?.siteId ?? null,
};

export const opsTickOf = (c: { db: unknown }): Promise<void> => opsTick(c.db as OpsDb, host);
export const accessLineOf = (c: { db: unknown }, line: string): void => accessLine(c.db as OpsDb, host, line);
