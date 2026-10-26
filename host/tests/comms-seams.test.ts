// P-L5_LIVE: the host halves of Stripe, Twilio and GitHub read only the Vault handles their manifests declare, reach only their own domains, and hand a GitHub token to git only through the filler.
import test from "node:test";
import assert from "node:assert/strict";
import { createGithubHost, createStripeHost, createTwilioHost, createZoomHost } from "../src/seams/comms.ts";
import { createFiller } from "../src/seams/filler.ts";
import type { SeamCtx, SeamFetch } from "../src/seams/ports.ts";

const ctx: SeamCtx = { space: "spc_t", trace: { traceId: "t".repeat(32) }, now: () => 1_790_000_000_000, db: { all: () => [] } };
const items: Record<string, string> = { "#Stripe_Key": "sk_test", "#Twilio_Account": "AC1", "#Twilio_Auth": "tok", "#GitHub_App_Id": "42", "#GitHub_App_Webhook_Secret": "whsec" };
const vault = { secret: async (h: string) => { const v = items[h]; if (v === undefined) throw new Error("no such item"); return v; }, signRs256: async (_h: string, _s: string, data: string) => `sig(${data.length})` };
const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => p.then(() => undefined, (e: { error?: { code?: string }; code?: string }) => e.error?.code ?? e.code);

test("stripe: only its own two handles are readable", async () => {
  const h = createStripeHost({ vault });
  assert.equal(await h.secret(ctx, "#Stripe_Key"), "sk_test");
  assert.equal(await codeOf(h.secret(ctx, "#Twilio_Auth")), "permission.no_grant");
  assert.equal(await codeOf(h.secret(ctx, "#Stripe_Webhook_Secret")), "provider.auth_failed", "a handle the Vault does not have");
});

test("twilio: an absent API key is null, a recording is fetched only from Twilio with the account's credentials", async () => {
  const seen: { url: string; auth?: string | undefined }[] = [];
  const fetch: SeamFetch = async (url, init) => { seen.push({ url, auth: init?.headers?.["authorization"] }); return { status: 200, text: async () => "", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };
  const h = createTwilioHost({ vault, fetch, blobs: { put: async () => "blb_1" }, publicUrl: async () => "https://space.example" });
  assert.equal(await h.optionalSecret(ctx, "#Twilio_API_Key"), null);
  assert.equal(await codeOf(h.optionalSecret(ctx, "#Stripe_Key")), "permission.no_grant");
  assert.deepEqual(await h.download(ctx, { url: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1.mp3", mime: "audio/mpeg" }), { blobId: "blb_1", size: 3, mime: "audio/mpeg" });
  assert.equal(seen[0]?.auth, `Basic ${Buffer.from("AC1:tok").toString("base64")}`);
  assert.equal(await codeOf(h.download(ctx, { url: "https://evil.example/RE1.mp3" })), "permission.no_grant");
  assert.equal(seen.length, 1, "a refused address is never fetched");
  assert.equal(await h.publicUrl(ctx), "https://space.example");
});

test("github: the App JWT is signed in the Vault, and a token goes behind a filler handle that fills git once", async () => {
  const filled: [string, string][] = [];
  const filler = createFiller({ git_credential: (ref, value) => filled.push([ref, value]) }, () => 1_000);
  const h = createGithubHost({ vault, fetch: async () => { throw new Error("no network"); }, blobs: { put: async () => "blb_1" }, filler });
  const jwt = await h.appJwt(ctx);
  const [head, claims, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(head!, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const c = JSON.parse(Buffer.from(claims!, "base64url").toString()) as { iss: string; iat: number; exp: number };
  assert.equal(c.iss, "42");
  assert.equal(c.exp - c.iat, 540);
  assert.match(sig!, /^sig\(/);
  assert.equal(await codeOf(h.storeSecrets(ctx, [{ name: "GitHub_App_Id", value: "1" }])), "internal.unavailable", "no Vault write port");

  const handle = await h.fillerHandle(ctx, { token: "ghs_x", expiresAt: 5_000 });
  assert.equal(filler.fill(handle, { kind: "git_credential", ref: "r1" }, 2_000), true);
  assert.deepEqual(filled, [["r1", "ghs_x"]]);
  assert.equal(filler.fill(handle, { kind: "other", ref: "r2" }, 2_000), false, "no sink takes another kind");
  assert.equal(filler.fill(handle, { kind: "git_credential", ref: "r3" }, 6_000), false, "an expired token is not filled");
  assert.equal(filler.fill("#fill_nope", { kind: "git_credential", ref: "r4" }, 2_000), false);
});

test("zoom: only its own handles are readable, and a recording is fetched only from a Zoom host with the account token", async () => {
  const seen: { url: string; auth?: string | undefined }[] = [];
  const fetch: SeamFetch = async (url, init) => { seen.push({ url, auth: init?.headers?.["authorization"] }); return { status: 200, text: async () => "", arrayBuffer: async () => new Uint8Array([9]).buffer }; };
  const h = createZoomHost({ vault: { secret: async (hd: string) => (hd === "#Zoom_S2S.client_id" ? "cid" : Promise.reject(new Error("no such item"))) }, fetch, blobs: { put: async () => "blb_z" } });
  assert.equal(await h.secret(ctx, "#Zoom_S2S.client_id"), "cid");
  assert.equal(await codeOf(h.secret(ctx, "#Stripe_Key")), "permission.no_grant");
  assert.equal(await codeOf(h.secret(ctx, "#Zoom_S2S.client_secret")), "provider.auth_failed", "an item the Vault does not have");
  assert.deepEqual(await h.download(ctx, { url: "https://us02web.zoom.us/rec/download/x", bearer: "tok", mime: "video/mp4" }), { blobId: "blb_z", size: 1, mime: "video/mp4" });
  assert.equal(seen[0]?.auth, "Bearer tok");
  assert.equal(await codeOf(h.download(ctx, { url: "https://evil.example/x", bearer: "tok" })), "permission.no_grant");
  assert.equal(seen.length, 1, "a refused address is never fetched");
});
