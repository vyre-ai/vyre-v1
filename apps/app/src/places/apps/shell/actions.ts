// What a person can do to a row of the Apps place, one capability call each, as plain functions: the place wires them to its menus and the tests call them directly. A call that Gate holds
// for a yes comes back `held`; the words say so and point at the task, and nothing else changes until it is approved.
import type { AppsData } from "./data.tsx";
import { heldOf } from "./model.ts";
import type { AppRow, RowAction } from "./model.ts";

export interface Done { text: string; /** the Gate task waiting on a yes, when the call was held */ taskId?: string }

let seq = 0;
const key = (what: string, id: string, now: number): string => `${what}-${id}-${now}-${++seq}`;

export async function runAction(d: AppsData, action: RowAction, row: AppRow): Promise<Done> {
  const now = d.clock().now;
  const held = (out: unknown, what: string): Done | null => { const h = heldOf(out); return h ? { text: `${what} is waiting for a yes.`, taskId: h.taskId } : null; };
  switch (action) {
    case "publish": { const out = await d.call("forms.publish", { formId: row.id }); return held(out, "Publishing") ?? { text: `Published ${row.title}.` }; }
    case "unpublish": await d.call("forms.unpublish", { formId: row.id }); return { text: `${row.title} is no longer public.` };
    case "launch": { const out = await d.call("campaigns.launch", { campaignId: row.id, idempotencyKey: key("launch", row.id, now) }); return held(out, "Launching") ?? { text: `Launched ${row.title}.` }; }
    case "pause": await d.call("campaigns.pause", { campaignId: row.id }); return { text: `Paused ${row.title}.` };
    case "resume": await d.call("campaigns.resume", { campaignId: row.id }); return { text: `Resumed ${row.title}.` };
    case "stop": await d.call("campaigns.stop", { campaignId: row.id }); return { text: `Stopped ${row.title}.` };
    case "install": { const out = (await d.call("templates.install", { templateId: row.id })) as { installed?: unknown[] }; return held(out, "Installing") ?? { text: `Installed ${row.title}. It added ${out.installed?.length ?? 0}.` }; }
    case "check": { await d.call("mail.domain.check", { domainId: row.id }); return { text: `Checked the records for ${row.title}.` }; }
    case "open": d.nav.open(row.group, row.id); return { text: "" };
  }
}

/** Kit builder: a thread with an agent that builds the Kit; it opens beside the Templates. */
export async function openKitBuilder(d: AppsData, brief?: string): Promise<string> {
  const out = (await d.call("kits.builder_open", { ...(brief ? { brief } : {}), idempotencyKey: key("kit", "builder", d.clock().now) })) as { threadId: string };
  d.nav.openThread(out.threadId);
  return out.threadId;
}
