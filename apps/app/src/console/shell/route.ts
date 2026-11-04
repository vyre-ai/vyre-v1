// How other places open the Console: rt.open(machinesTarget(id)) shows Console, Computers, Overview with that machine's page open (the Space server when no id).
// The route is the prototype's: console.page with page "machines~<machineId>"; "machines~space" is the Space server. An old id still lands where it moved.
import { resolve } from "./sections.ts";

export interface ConsoleTarget { screen: "console.page"; args: { page: string } }

/** The target that opens Computers with this machine selected; the machine id is "space", srv_x or device:dev_x. */
export function machinesTarget(machineId?: string): ConsoleTarget { return { screen: "console.page", args: { page: `machines~${machineId && machineId.length > 0 ? machineId : "space"}` } }; }

/** "machines~srv_x" to the page and the args that page takes; a plain page id (old ids too) to itself. Null for nothing usable. */
export function parseConsolePage(raw: string | undefined): { page: string; args: Record<string, string> } | null {
  if (!raw) return null;
  const [name = "", id] = raw.split("~", 2);
  const page = resolve(name);
  return id ? { page, args: page === "machines" ? { machineId: id } : {} } : { page, args: {} };
}
