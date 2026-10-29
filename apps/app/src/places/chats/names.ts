// A name for someone the page has no name for (not loaded yet, left the Space, an outside agent): a plain word, never the id. Ids are for code; a person reads names.

/** What to call an id that has no name in hand. */
export function unnamed(id: string): string {
  if (id.startsWith("agt_")) return "An agent";
  if (id.startsWith("usr_")) return "Someone";
  if (id.startsWith("grp_")) return "A group";
  if (id.startsWith("act_")) return "An outside agent";
  if (id.startsWith("svc_")) return "Vyre";
  return "Someone";
}

/** The name from a lookup, else the plain word. */
export const nameOr = (name: string | undefined, id: string): string => (name !== undefined && name !== "" ? name : unnamed(id));
