// A key approved for an agent's request (owner ruling, 3 Nov 2026): who may use it through that agent. The agent's Use grant on the item carries the source
// `through-agent:<usr_id>` (only the person who asked, the default) or `through-agent:anyone` (anyone who asks this agent). The access check (kernel/src/authorize) reads it: the person
// the agent acts for needs no access of their own to that item, up to Use. Shared by the kernel, the access module and vault requests.
export const THROUGH_AGENT = "through-agent:";
export const THROUGH_ANYONE = "anyone";
