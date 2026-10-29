import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createSampleVault } from "../../places/vault/layout/sample.ts";
import { PlaceHashProvider } from "../hash/context.tsx";
import { ShellRuntimeProvider } from "./runtime.tsx";
import { sampleRuntime } from "./misc-test-runtime.tsx";
import VaultPlace, { vaultData, vaultRoute } from "./vault.tsx";
import { loadVaultPolicy, policyDirty, saveVaultPolicy, toggledRole } from "../../places/vault/layout/policy-actions.ts";
import type { VaultPolicy } from "../../places/vault/layout/policy-actions.ts";
import { EXPIRY_CHOICES } from "../../places/vault/layout/model.ts";

test("the Vault place draws the Space's items through the shell runtime", () => {
  const s = createSampleVault();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const out = renderToStaticMarkup(<ShellRuntimeProvider value={rt}><VaultPlace place="vault" /></ShellRuntimeProvider>);
  assert.ok(out.includes("Stripe"), "an item of the Space shows");
  assert.ok(!out.includes("vault-loading-frame"));
});

test("without a runtime the Vault draws its loading frame", () => {
  assert.ok(renderToStaticMarkup(<VaultPlace place="vault" />).includes("vault-loading"));
});

test("a click that leaves the Vault goes out through the shell's door", () => {
  const s = createSampleVault();
  const opened: string[] = [];
  const d = vaultData(sampleRuntime({ screens: s.data.screens, call: s.data.call, opened }));
  d.nav.openAdvanced();
  d.nav.openBackups();
  d.nav.openDevices();
  d.nav.openOutsideActors();
  d.nav.openAgent("agt_intake");
  assert.deepEqual(opened, ["vault.layout", "console.backups", "devices.mine", "console.outside-actors", "chats.agent-page"]);
});

test("Vault hashes route share, export, Advanced, and requests into their real surfaces", () => {
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { share: "vit_ghl" } }), { itemId: "vit_ghl", surface: "share" });
  assert.deepEqual(vaultRoute({ screen: "vault.export", args: { folderId: "fld_marketing" } }), { folderId: "fld_marketing", surface: "export" });
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { advanced: "true" } }), { surface: "advanced" });
  assert.deepEqual(vaultRoute({ screen: "vault_requests.list", args: {} }), { surface: "requests" });

  const s = createSampleVault();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const draw = (hash: string): string => renderToStaticMarkup(
    <ShellRuntimeProvider value={rt}><PlaceHashProvider hash={hash} opened={() => undefined}><VaultPlace place="vault" /></PlaceHashProvider></ShellRuntimeProvider>,
  );
  assert.match(draw("screen=vault.layout&share=vit_ghl"), /data-testid="item-env"/);
  const exported = draw("screen=vault.export&folderId=fld_marketing");
  assert.match(exported, /data-testid="vault-export-sheet"/);
  assert.match(exported, /Active exports/);
  assert.match(exported, /data-testid="vault-export-revoke-vex_marketing"/);
  const advanced = draw("screen=vault.layout&advanced=true");
  assert.match(advanced, /data-testid="vault-advanced"/);
  assert.doesNotMatch(advanced, /Emergency access|Recovery key/);
  const requests = draw("screen=vault_requests.list");
  assert.match(requests, /data-testid="vault-requests"/);
  assert.match(requests, /data-testid="vault-request-use-req_twilio-vit_twilio"/);
  assert.match(requests, /data-testid="vault-request-decline-req_twilio"/);
});

test("Vault Ask an agent starts an Ask pane on the item and opens its thread", async () => {
  const s = createSampleVault();
  const opened: string[] = [];
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const base = sampleRuntime({ screens: s.data.screens, call: s.data.call, opened });
  const rt = { ...base, call: async (cap: string, input: unknown) => { calls.push({ cap, input: input as Record<string, unknown> }); return { thread: { threadId: "thr_ask" } }; }, open: (t: { subject?: { id: string } }) => void opened.push(t.subject?.id ?? "?") };
  vaultData(rt as never).nav.ask?.("agt_intake", "chat", { kind: "vault_item", id: "vit_ghl", title: "GoHighLevel" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls[0]?.cap, "chat.start");
  assert.deepEqual([calls[0]?.input["kind"], calls[0]?.input["scopeType"], calls[0]?.input["scopeId"], calls[0]?.input["title"]], ["ask", "vault_item", "vit_ghl", "GoHighLevel"]);
  assert.deepEqual(opened, ["thr_ask"]);
});

test("the Vault policy page has its route and its Advanced row", () => {
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { policy: "true" } }), { surface: "policy" });
  const s = createSampleVault();
  const opened: Array<{ screen?: string; args?: unknown }> = [];
  const rt = { ...sampleRuntime({ screens: s.data.screens, call: s.data.call }), open: (t: { screen?: string; args?: unknown }) => void opened.push(t) };
  vaultData(rt as never).nav.openPolicy();
  assert.deepEqual(opened, [{ screen: "vault.layout", args: { policy: true } }]);
  const rtShow = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const advanced = renderToStaticMarkup(<ShellRuntimeProvider value={rtShow}><PlaceHashProvider hash="screen=vault.layout&advanced=true" opened={() => undefined}><VaultPlace place="vault" /></PlaceHashProvider></ShellRuntimeProvider>);
  assert.match(advanced, /vault-advanced-policy/, "Advanced lists Policy");
  const page = renderToStaticMarkup(<ShellRuntimeProvider value={rtShow}><PlaceHashProvider hash="screen=vault.layout&policy=true" opened={() => undefined}><VaultPlace place="vault" /></PlaceHashProvider></ShellRuntimeProvider>);
  assert.match(page, /data-testid="vault-policy"/, "the route mounts the policy page");
});

const POLICY: VaultPolicy = { exportRoles: ["owner", "admin"], pullExpiryMax: "1d", blockRestrictedExport: true, revealNeedsReason: false };

test("the policy loads with the roles that can be allowed, reads a refusal as denied, and saves one call", async () => {
  const calls: string[] = [];
  const call = async (cap: string, input?: unknown): Promise<unknown> => {
    calls.push(cap);
    if (cap === "vault.policy.get") return { policy: POLICY };
    if (cap === "access.roles.list") return { roles: [{ name: "owner" }, { name: "admin" }, { name: "member" }] };
    if (cap === "vault.policy.set") return { policy: (input as { policy: VaultPolicy }).policy };
    throw new Error(cap);
  };
  const got = await loadVaultPolicy(call);
  assert.deepEqual(got, { state: "ready", saved: POLICY, roles: ["owner", "admin", "member"] });
  const next = toggledRole({ ...POLICY, pullExpiryMax: "7d", revealNeedsReason: true }, "member");
  assert.deepEqual(next.exportRoles, ["owner", "admin", "member"]);
  assert.deepEqual(toggledRole(next, "admin").exportRoles, ["owner", "member"]);
  assert.equal(policyDirty(next, POLICY), true);
  assert.equal(policyDirty({ ...POLICY, exportRoles: ["admin", "owner"] }, POLICY), false, "the order of roles is not a change");
  assert.deepEqual(await saveVaultPolicy(call, next), next);
  assert.deepEqual(calls.filter((c) => c === "vault.policy.set"), ["vault.policy.set"]);
  const denied = async (): Promise<unknown> => { throw Object.assign(new Error("no"), { code: "permission.no_grant" }); };
  assert.deepEqual(await loadVaultPolicy(denied), { state: "denied" });
  await assert.rejects(loadVaultPolicy(async () => { throw new Error("offline"); }), /offline/);
  assert.deepEqual(EXPIRY_CHOICES.map((c) => c.key), ["1h", "1d", "7d"], "the export sheet and the policy offer the same three lengths");
});

test("the export sheet shows how long its link lasts and asks for it", () => {
  const s = createSampleVault();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const out = renderToStaticMarkup(<ShellRuntimeProvider value={rt}><PlaceHashProvider hash="screen=vault.export&folderId=fld_marketing" opened={() => undefined}><VaultPlace place="vault" /></PlaceHashProvider></ShellRuntimeProvider>);
  assert.match(out, /Creates a one-hour, logged download/);
  assert.match(out, /vault-export-expiry/);
  assert.match(out, /Link lasts/);
});
