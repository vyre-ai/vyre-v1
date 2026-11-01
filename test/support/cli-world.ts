// The CLI-engine world the chat journeys run in: the fake claude of host/tests/fixtures/fake-cli-driver as the engine, and a Claude Code subscription the Space may run work on.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unlockVault } from "./mail-world.ts";
import type { MailWorld } from "./mail-world.ts";

const FAKE_CLI = fileURLToPath(new URL("../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
export const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

/** A Claude Code subscription the Space may run work on, as Settings connects it. */
export async function connectSubscription(w: MailWorld): Promise<void> {
  await unlockVault(w);
  const folder = await w.owner.ok("vault.folders.create", { idempotencyKey: "st-folder", name: "Accounts", scope: "mine" });
  const flow = await w.owner.ok("providers.subscription_start", { idempotencyKey: "st-flow", providerKey: "claude-code" });
  await w.owner.ok("vault.item.put", { idempotencyKey: "st-item", folderId: folder.folder.id, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
  const provider = await w.owner.ok("providers.subscription_complete", { flowId: flow.flowId });
  await w.owner.ok("providers.set_space_use", { idempotencyKey: "st-use", providerId: provider.provider.id, allow: true });
  await w.owner.ok("engine.pool.status", {});
}

