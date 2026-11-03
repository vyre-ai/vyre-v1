// Where Settings, the Console and the Vault's own sidebar send a person for connections (owner ruling D28): Vault > Connections. One address, so every link lands on the same page.
// args.connections is "true" for the page, or "add" for the page with the Add sheet open.

export interface ConnectionsTarget { screen: "vault.layout"; args: { connections: "true" | "add" } }

export function connectionsTarget(add = false): ConnectionsTarget {
  return { screen: "vault.layout", args: { connections: add ? "add" : "true" } };
}

/** The Vault route an address asks for, or null when it is not about connections. */
export function connectionsRoute(args: Readonly<Record<string, string | undefined>>): { surface: "connections"; add?: true } | null {
  const v = args["connections"];
  if (v === "add") return { surface: "connections", add: true };
  if (v === "true") return { surface: "connections" };
  return null;
}
