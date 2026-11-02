import type { AppsData } from "./data.tsx";

let seq = 0;
const key = (kind: string, name: string, now: number): string => `${kind}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${now}-${++seq}`;

export async function createForm(data: AppsData, input: { name: string; recordType: string; kind: "public" | "one_use" | "booking" | "survey" }): Promise<string> {
  const out = await data.call("forms.create", { ...input, idempotencyKey: key("form", input.name, data.clock().now) }) as { form: { formId: string } };
  return out.form.formId;
}

export async function addSendingDomain(data: AppsData, input: { name: string; provider: "resend" | "mailgun" }): Promise<string> {
  const out = await data.call("mail.domain.add", { ...input, idempotencyKey: key("domain", input.name, data.clock().now) }) as { domain: { id: string } };
  return out.domain.id;
}
