// The connector offers the server judged finishable (automations.connector_offers), read into the rows the first page shows.
export interface ConnectorOffer {
  itemId: string;
  appName: string;
  text: string;
}

/** The open offers out of automations.connector_offers. Anything else is none. */
export function offersOf(out: unknown): ConnectorOffer[] {
  const rows = (out as { offers?: unknown } | null)?.offers;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const o = r as Record<string, unknown> | null;
    return o && typeof o["itemId"] === "string" && typeof o["appName"] === "string"
      ? [
          {
            itemId: o["itemId"],
            appName: o["appName"],
            text: typeof o["text"] === "string" ? o["text"] : `Set up ${o["appName"]} for Automations?`,
          },
        ]
      : [];
  });
}
