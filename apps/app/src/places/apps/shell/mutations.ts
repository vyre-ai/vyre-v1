import type { AppsData } from "./data.tsx";
export const KEYED = new Set(["forms.create", "forms.link_create", "bookings.page_create", "campaigns.create", "campaigns.launch", "templates.save", "mail.domain.add", "kits.builder_open", "email_builder.create", "email_builder.send_test"]);
export async function mutate(d: AppsData, cap: string, input: Record<string, unknown>, key: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (d.connection?.get() === "offline") throw new Error("Reconnect to this Space before saving or sending.");
  return d.call(cap, KEYED.has(cap) ? { ...input, idempotencyKey: key } : input);
}
export function actionKey(): string { return globalThis.crypto.randomUUID(); }
export function errorMessage(error: unknown): string {
  const value = error as { error?: { message?: string; code?: string; traceId?: string }; message?: string };
  return value?.error?.message ?? value?.message ?? "That did not work. Check your access and connection, then retry.";
}
