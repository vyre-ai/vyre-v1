// A fake Space AI key endpoint for live tests (lane l-engine21): an OpenAI-compatible provider that accepts one key and serves only non-Claude models, so a Claude pick on a Team server can be served by no
// Space account. `setSpaceKey(d, token)` connects it as the Space AI key (providers.custom_add, then providers.space_key.set) the way an owner does.
//   const ep = await fakeSpaceKey();              // { base, key, models, close() }
//   await setSpaceKey(d, d.token, ep);            // every member now has the Space AI key, serving ep.models
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

export const SPACE_KEY = "ocg-space-FAKEkey-0123456789abcdefGHIJ"; // secret-scan: fake
export const SPACE_KEY_MODELS = ["glm-test", "kimi-test"];

export interface FakeSpaceKey { base: string; key: string; models: string[]; close(): Promise<void> }

export async function fakeSpaceKey(models: string[] = SPACE_KEY_MODELS): Promise<FakeSpaceKey> {
  const server = http.createServer((req, res) => {
    if (String(req.headers["authorization"]) !== `Bearer ${SPACE_KEY}`) { res.writeHead(401); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, key: SPACE_KEY, models, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

/** The owner connects it as the Space AI key. `token` is an owner's or the admin token of `d`. */
export async function setSpaceKey(d: Daemon, token: string, ep: FakeSpaceKey): Promise<void> {
  const call = async (cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ idempotencyKey: `sk-${cap}`, ...input }) });
    const body = (await r.json()) as { data?: unknown };
    if (r.status !== 200) throw new Error(`${cap}: ${r.status} ${JSON.stringify(body)}`);
    return body.data ?? body;
  };
  const added = await call("providers.custom_add", { name: "Fake Space Go", baseUrl: ep.base, apiKey: ep.key, scope: "mine" });
  await call("providers.space_key.set", { providerKey: added.endpoint.key, apiKey: ep.key });
}
