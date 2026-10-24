// Fake Documenso behind the EsignProvider interface (ARCH 8.4, 10.1). Health is GET /api/v1/health.
import { Buffer } from "node:buffer";
import { handledFetch, hostIs, recordingFetch, type FetchLike, type Handler, type ReplayTape, type SeenCall } from "./replay.ts";

export interface EsignEnvelope {
  title: string;
  signers: { name: string; email: string }[];
}

export interface EsignProvider {
  create(envelope: EsignEnvelope): Promise<{ id: string }>;
  status(id: string): Promise<{ id: string; status: string }>;
  cancel(id: string): Promise<{ cancelled: boolean }>;
  fetchSigned(id: string): Promise<{ pdf: Uint8Array; certificate: Uint8Array }>;
}

export interface DocumensoProvider extends EsignProvider {
  readonly name: "documenso";
  readonly calls: SeenCall[];
  readonly fetch: FetchLike;
  health(): Promise<{ status: string }>;
}

interface StoredDoc {
  id: string;
  status: string;
  pdf: Uint8Array;
  certificate: Uint8Array;
}

const ORIGIN = "https://documenso.internal";

export function fakeDocumenso(opts: { tape?: ReplayTape; fetch?: FetchLike } = {}): DocumensoProvider {
  const calls: SeenCall[] = [];
  const docs = new Map<string, StoredDoc>();
  let n = 0;
  const handlers: Handler[] = [
    {
      method: "GET",
      match: (u) => hostIs(u, "documenso.internal") && u.pathname === "/api/v1/health",
      run: () => ({ body: { status: "ok" } }),
    },
    {
      method: "POST",
      match: (u) => hostIs(u, "documenso.internal") && u.pathname === "/api/v1/documents",
      run: (_u, init) => {
        n += 1;
        const id = `env_${n}`;
        docs.set(id, {
          id,
          status: "pending",
          pdf: Buffer.from("%PDF-1.4 fake"),
          certificate: Buffer.from("audit-certificate"),
        });
        void init;
        return { body: { id } };
      },
    },
    {
      method: "GET",
      match: (u) => docId(u, "") !== null,
      run: (u) => {
        const id = docId(u, "");
        const doc = id ? docs.get(id) : undefined;
        if (!doc) return { status: 404, body: { error: "not_found" } };
        return { body: { id: doc.id, status: doc.status } };
      },
    },
    {
      method: "POST",
      match: (u) => docId(u, "/cancel") !== null,
      run: (u) => {
        const id = docId(u, "/cancel");
        const doc = id ? docs.get(id) : undefined;
        if (!doc) return { status: 404, body: { error: "not_found" } };
        doc.status = "cancelled";
        return { body: { cancelled: true } };
      },
    },
    {
      method: "GET",
      match: (u) => docId(u, "/download") !== null,
      run: (u) => {
        const id = docId(u, "/download");
        const doc = id ? docs.get(id) : undefined;
        if (!doc) return { status: 404, body: { error: "not_found" } };
        return { body: { pdf: Buffer.from(doc.pdf).toString("base64"), certificate: Buffer.from(doc.certificate).toString("base64") } };
      },
    },
  ];
  const fetch = recordingFetch(opts.fetch ?? handledFetch(handlers, opts.tape), calls);

  async function read(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<unknown> {
    const res = await fetch(url, init);
    if (res.status !== 200) throw new Error(`documenso ${res.status} for ${url}`);
    return JSON.parse(await res.text()) as unknown;
  }

  return {
    name: "documenso",
    calls,
    fetch,
    async health() {
      return await read(`${ORIGIN}/api/v1/health`) as { status: string };
    },
    async create(envelope) {
      return await read(`${ORIGIN}/api/v1/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      }) as { id: string };
    },
    async status(id) {
      return await read(`${ORIGIN}/api/v1/documents/${encodeURIComponent(id)}`) as { id: string; status: string };
    },
    async cancel(id) {
      return await read(`${ORIGIN}/api/v1/documents/${encodeURIComponent(id)}/cancel`, { method: "POST" }) as { cancelled: boolean };
    },
    async fetchSigned(id) {
      const body = await read(`${ORIGIN}/api/v1/documents/${encodeURIComponent(id)}/download`) as { pdf: string; certificate: string };
      return { pdf: Buffer.from(body.pdf, "base64"), certificate: Buffer.from(body.certificate, "base64") };
    },
  };
}

function docId(url: URL, suffix: string): string | null {
  if (!hostIs(url, "documenso.internal")) return null;
  const m = new RegExp(`^/api/v1/documents/([^/]+)${suffix}$`).exec(url.pathname);
  const id = m?.[1];
  return id ? decodeURIComponent(id) : null;
}
