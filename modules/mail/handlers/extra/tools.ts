// The two tools models are shown for email templates and delivery (mail.templates, mail.delivery): each one door that dispatches to the capabilities behind the screens, so a model reads
// two tool definitions instead of eleven. Nothing here decides anything the capability does not: it only routes, and asks for the right to change a template where the template
// capabilities' manifest entries would have.
import { fail } from "../../../../host/src/routes/errors.ts";
import { bad } from "../../projections.ts";
import type { MailCtx } from "../../projections.ts";
import { trail } from "./delivery.ts";
import { monitor } from "./inbound.ts";
import { forDocumentClear, forDocumentGet, forDocumentSet, get, list, preview, reset, save } from "./template.ts";

interface TemplatesIn {
  action: "list" | "get" | "set" | "preview" | "reset";
  key?: string;
  documentId?: string;
  subject?: string;
  text?: string;
  recordType?: string;
  recordId?: string;
  vars?: Record<string, unknown>;
}

const mayEdit = (ctx: MailCtx): void => {
  if (ctx.authorize({ perm: "comms.templates", level: "use" }, { type: "space", id: ctx.space }).effect !== "allow")
    throw fail("permission.no_grant", ctx.trace.traceId, { details: { perm: "comms.templates" } });
};

export async function templates(ctx: MailCtx, input: TemplatesIn): Promise<{ result: unknown }> {
  const need = (k: keyof TemplatesIn): string => {
    const v = input[k];
    if (typeof v !== "string" || v === "") bad(ctx, `${k} is needed for ${input.action}.`);
    return v as string;
  };
  switch (input.action) {
    case "list":
      return { result: await list(ctx) };
    case "get":
      return { result: input.documentId ? await forDocumentGet(ctx, { documentId: input.documentId, key: need("key") }) : await get(ctx, { key: need("key") }) };
    case "preview":
      return { result: await preview(ctx, input) };
    case "set": {
      // a document's own wording takes the same two rights as the capability (edit on the file and comms.templates), checked inside; the Space's takes comms.templates
      if (input.documentId)
        return { result: await forDocumentSet(ctx, { documentId: input.documentId, key: need("key"), subject: need("subject"), text: need("text") }) };
      mayEdit(ctx);
      return { result: await save(ctx, { key: need("key"), subject: need("subject"), text: need("text"), ...(input.recordType ? { recordType: input.recordType } : {}) }) };
    }
    case "reset":
      if (input.documentId) return { result: await forDocumentClear(ctx, { documentId: input.documentId, key: need("key") }) };
      mayEdit(ctx);
      return { result: await reset(ctx, { key: need("key") }) };
    default:
      return bad(ctx, "action is list, get, set, preview or reset.");
  }
}

export async function delivery(ctx: MailCtx, input: { messageId?: string; mailboxId?: string }): Promise<{ result: unknown }> {
  if (input.messageId !== undefined) return { result: await trail(ctx, { messageId: input.messageId }) };
  return { result: await monitor(ctx, input.mailboxId !== undefined ? { mailboxId: input.mailboxId } : {}) };
}
