// A credential is checked the moment it is in the Vault, by signing with it and asking the provider, and what is wrong comes back in words that say how to fix it. No person is involved and the value never appears in an answer.
import test from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { createGoogleHost, keyProblem } from "./google.ts";
import { appProblem, createMsHost } from "./microsoft.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const ctx = { space: "spc_1", trace: { traceId: "0".repeat(32) }, now: () => 1_760_000_000_000, db: { all: () => [] } } as never;
const googleKey = { type: "service_account", client_id: "1234567890123", client_email: "vyre@p.iam.gserviceaccount.com", private_key: PEM, project_id: "vyre-1" };

function deps(secret: string | null, answer: { status: number; body?: unknown }) {
  const asked: { url: string; body: string }[] = [];
  const sign = (data: string): string => { const j = JSON.parse(secret!) as { private_key?: string }; return createSign("RSA-SHA256").update(data).sign(j.private_key!).toString("base64url"); };
  return {
    asked,
    d: {
      vault: { secret: async () => { if (secret === null) throw new Error("no item"); return secret; }, signRs256: async (_h: string, _s: string, data: string) => sign(data) },
      fetch: async (url: string, init?: { body?: unknown }) => { asked.push({ url, body: String(init?.body) }); return { status: answer.status, text: async () => JSON.stringify(answer.body ?? {}), arrayBuffer: async () => new ArrayBuffer(0) }; },
      files: {} as never, blobs: {} as never, members: {} as never,
    } as never,
  };
}

test("Google: a working key answers its public identity and nothing else", async () => {
  const { d, asked } = deps(JSON.stringify(googleKey), { status: 200, body: { access_token: "t" } });
  const out = await createGoogleHost(d).checkKey(ctx, "#Google_DWD");
  assert.deepEqual(out, { ok: true, clientId: "1234567890123", clientEmail: "vyre@p.iam.gserviceaccount.com", projectId: "vyre-1" });
  assert.equal(new URL(asked[0]!.url).hostname, "oauth2.googleapis.com");
  assert.ok(!JSON.parse(Buffer.from(new URLSearchParams(asked[0]!.body).get("assertion")!.split(".")[1]!, "base64url").toString()).sub, "it asks as the service account, for no person");
  assert.ok(!JSON.stringify(out).includes("PRIVATE KEY"));
});

test("Google: every wrong paste says what is wrong and what to do", async () => {
  const problem = async (secret: string | null, answer: { status: number; body?: unknown } = { status: 200 }): Promise<string> => (await createGoogleHost(deps(secret, answer).d).checkKey(ctx, "#Google_DWD")).problem ?? "";
  assert.match(await problem(null), /not in the Vault yet/);
  assert.match(await problem("not json"), /not valid JSON/);
  assert.match(await problem(JSON.stringify({ type: "authorized_user" })), /not a Google service-account key/);
  assert.match(await problem(JSON.stringify({ ...googleKey, client_id: "vyre@p.iam.gserviceaccount.com" })), /not a Google service-account key/, "the numeric id, not the address, is what Google needs");
  assert.match(await problem(JSON.stringify({ ...googleKey, private_key: "broken" })), /private key in this file is damaged/);
  assert.match(await problem(JSON.stringify(googleKey), { status: 400, body: { error: "invalid_grant", error_description: "Invalid JWT Signature." } }), /deleted or replaced/);
  assert.match(await problem(JSON.stringify(googleKey), { status: 503 }), /not answering/);
  assert.match(keyProblem("invalid_grant", "Account has been disabled"), /turned off/);
  assert.equal((await createGoogleHost(deps(null, { status: 200 }).d).checkKey(ctx, "not a handle")).ok, false);
});

const APP = "11111111-2222-3333-4444-555555555555", TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

test("Microsoft: a secret or a certificate signs in, and which one is said; a certificate's key signs in the Vault", async () => {
  const secret = deps(JSON.stringify({ clientId: APP, tenantId: TENANT, clientSecret: "s3cr3t-value" }), { status: 200, body: { access_token: "t" } });
  const a = await createMsHost(secret.d).checkApp(ctx, "#Microsoft_App");
  assert.deepEqual(a, { ok: true, clientId: APP, tenantId: TENANT, credential: "secret" });
  assert.ok(!JSON.stringify(a).includes("s3cr3t-value"));
  assert.ok(secret.asked[0]!.url.includes(TENANT));
  const cert = deps(JSON.stringify({ clientId: APP, tenantId: TENANT, thumbprint: "AB".repeat(20), private_key: PEM }), { status: 200, body: { access_token: "t" } });
  assert.equal((await createMsHost(cert.d).checkApp(ctx, "#Microsoft_App")).credential, "certificate");
  const sent = new URLSearchParams(cert.asked[0]!.body);
  assert.equal(sent.get("client_assertion_type"), "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
  assert.equal(sent.get("client_secret"), null);
  const head = JSON.parse(Buffer.from(sent.get("client_assertion")!.split(".")[0]!, "base64url").toString()) as { x5t: string };
  assert.equal(Buffer.from(head.x5t, "base64url").toString("hex").toUpperCase(), "AB".repeat(20));
});

test("Microsoft: every wrong paste says what is wrong and what to do", async () => {
  const problem = async (secret: string | null, answer: { status: number; body?: unknown } = { status: 200 }): Promise<string> => (await createMsHost(deps(secret, answer).d).checkApp(ctx, "#Microsoft_App")).problem ?? "";
  const good = JSON.stringify({ clientId: APP, tenantId: TENANT, clientSecret: "s3cr3t-value" });
  assert.match(await problem(null), /not in the Vault yet/);
  assert.match(await problem("nonsense"), /not a Microsoft app/);
  assert.match(await problem(JSON.stringify({ clientId: "not-a-guid", tenantId: TENANT, clientSecret: "x" })), /code like 11111111/);
  assert.match(await problem(good, { status: 401, body: { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." } }), /Value, not its ID/);
  assert.match(await problem(good, { status: 400, body: { error: "unauthorized_client", error_description: "AADSTS700016: Application not found" } }), /not in this tenant/);
  assert.match(await problem(good, { status: 400, body: { error: "invalid_request", error_description: "AADSTS90002: Tenant not found" } }), /no such tenant/);
  assert.match(appProblem("x", "AADSTS700027: bad signature"), /certificate/);
  assert.match(await problem(good, { status: 503 }), /not answering/);
});
