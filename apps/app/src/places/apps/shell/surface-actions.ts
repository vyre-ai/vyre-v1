import type { AppsData } from "./data.tsx";

let seq = 0;
const key = (kind: string, name: string, now: number): string => `${kind}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${now}-${++seq}`;

export async function createForm(data: AppsData, input: { name: string; recordType: string; kind: "public" | "one_use" | "booking" | "survey" }): Promise<string> {
  const out = await data.call("forms.create", { ...input, idempotencyKey: key("form", input.name, data.clock().now) }) as { form: { formId: string } };
  return out.form.formId;
}

export async function createCampaign(data: AppsData, input: { name: string; kind: "one_time" | "sequence" | "triggered" }): Promise<string> {
  const out = await data.call("campaigns.create", { ...input, idempotencyKey: key("campaign", input.name, data.clock().now) }) as { campaign: { campaignId: string } };
  return out.campaign.campaignId;
}

export async function addSendingDomain(data: AppsData, input: { name: string; provider: "resend" | "mailgun" }): Promise<string> {
  const out = await data.call("mail.domain.add", { ...input, idempotencyKey: key("domain", input.name, data.clock().now) }) as { domain: { id: string } };
  return out.domain.id;
}
