// Two made-up CRMs the SyncSpec tests read, shaped differently on purpose so nothing in the code can be tuned to one of them.
//   Ledger  (crm-a.test)  header key, page-number pagination with no next pointer, records nested under attributes, a relation to organizations, pick-lists from a fields endpoint.
//   Orbit   (crm-b.test)  bearer key, Link-header pagination, a custom object (jobs) whose properties live under props, pick-lists from a schema endpoint, a link to a Ledger-like contact id.
// A pure router: (request) -> reply. test/support/fake-crm-server.ts puts the same router behind a real HTTP server.
export interface CrmRequest { method: string; url: string; headers: Record<string, string>; body?: unknown }
export interface CrmReply { status: number; body?: unknown; headers?: Record<string, string> }

export const KEY_A = "ledger-key-0001";
export const KEY_B = "orbit-key-0002";

export interface Person { id: number; attributes: { full_name: string; email: string; phone: string; status: string; tier: string; note: string }; org_id: string | null; modified: string }
export interface Job { uid: string; props: { title: string; kind: string; amount: number; opened: string; contact_ref: string | null }; touched: string }

export function crm() {
  const state = {
    now: Date.parse("2026-10-30T12:00:00Z"),
    people: [
      { id: 101, attributes: { full_name: "Ada Stone", email: "ada@example.test", phone: "+1 555 0101", status: "lead", tier: "gold", note: "" }, org_id: "o1", modified: "2026-10-01T10:00:00Z" },
      { id: 102, attributes: { full_name: "Ben Ford", email: "ben@example.test", phone: "+1 555 0102", status: "client", tier: "silver", note: "" }, org_id: "o1", modified: "2026-10-02T10:00:00Z" },
      { id: 103, attributes: { full_name: "Cy Lane", email: "cy@example.test", phone: "+1 555 0103", status: "lead", tier: "gold", note: "" }, org_id: null, modified: "2025-01-02T10:00:00Z" },
      { id: 104, attributes: { full_name: "Di Moss", email: "di@example.test", phone: "+1 555 0104", status: "closed", tier: "bronze", note: "" }, org_id: "o2", modified: "2026-10-04T10:00:00Z" },
      { id: 105, attributes: { full_name: "Ed Park", email: "ed@example.test", phone: "+1 555 0105", status: "lead", tier: "silver", note: "" }, org_id: "o2", modified: "2026-10-05T10:00:00Z" },
    ] as Person[],
    // a second tenant of Ledger: its own people, one of them with the same email as a person of the first
    peopleB: [
      { id: 201, attributes: { full_name: "Ada Stone (Paris)", email: "ada@example.test", phone: "+33 1 0201", status: "lead", tier: "gold", note: "" }, org_id: "o1", modified: "2026-10-06T10:00:00Z" },
      { id: 202, attributes: { full_name: "Gus Hale", email: "gus@example.test", phone: "+33 1 0202", status: "client", tier: "silver", note: "" }, org_id: null, modified: "2026-10-07T10:00:00Z" },
    ] as Person[],
    orgs: [{ id: "o1", name: "North Works", modified: "2026-09-01T00:00:00Z" }, { id: "o2", name: "South Mill", modified: "2026-09-02T00:00:00Z" }],
    jobs: [
      { uid: "j-1", props: { title: "Stone install", kind: "install", amount: 12000, opened: "2026-06-01", contact_ref: "101" }, touched: "2026-10-03T00:00:00Z" },
      { uid: "j-2", props: { title: "Ford repair", kind: "repair", amount: 0, opened: "2026-07-15", contact_ref: "102" }, touched: "2026-10-04T00:00:00Z" },
      { uid: "j-3", props: { title: "Moss repair", kind: "repair", amount: 500, opened: "2026-08-20", contact_ref: "104" }, touched: "2026-10-05T00:00:00Z" },
    ] as Job[],
    requests: [] as { method: string; host: string; path: string }[],
    webhooks: [] as { url: string; events: string[] }[],
    rejectWrites: false,
  };

  const A_FIELDS = [
    { key: "status", label: "Status", type: "select", options: [{ value: "lead", label: "Lead" }, { value: "client", label: "Client" }, { value: "closed", label: "Closed" }] },
    { key: "tier", label: "Tier", type: "select", options: [{ value: "gold" }, { value: "silver" }, { value: "bronze" }] },
  ];
  const B_SCHEMA = { object: "jobs", properties: [{ name: "kind", label: "Kind", options: ["install", "repair"] }, { name: "amount", label: "Amount" }] };

  const page = <T>(all: T[], url: URL, per: number, pageParam: string): T[] => {
    const n = Math.max(1, Number(url.searchParams.get(pageParam) ?? "1"));
    return all.slice((n - 1) * per, n * per);
  };

  const handle = (req: CrmRequest): CrmReply => {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    state.requests.push({ method, host: url.hostname, path: url.pathname });
    const h = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (url.hostname === "crm-a.test") {
      if (h["x-api-token"] !== KEY_A) return { status: 401, body: { error: "bad token" } };
      if (method === "GET" && url.pathname === "/api/v2/people") {
        const since = url.searchParams.get("modified_after");
        const all = (url.searchParams.get("tenant") === "b" ? state.peopleB : state.people).filter((p) => !since || p.modified >= since);
        const per = Number(url.searchParams.get("per_page") ?? "2");
        return { status: 200, body: { data: page(all, url, per, "page"), meta: { total: all.length } } };
      }
      if (method === "GET" && url.pathname === "/api/v2/organizations") return { status: 200, body: { data: page(state.orgs, url, 10, "page") } };
      if (method === "GET" && url.pathname === "/api/v2/fields/people") return { status: 200, body: { fields: A_FIELDS } };
      const m = /^\/api\/v2\/people\/(\d+)$/.exec(url.pathname);
      if (m && method === "PATCH") {
        if (state.rejectWrites) return { status: 500, body: { error: "down" } };
        const p = (url.searchParams.get("tenant") === "b" ? state.peopleB : state.people).find((x) => String(x.id) === m[1]);
        if (!p) return { status: 404 };
        const patch = (req.body as { attributes?: Record<string, string> } | undefined)?.attributes ?? {};
        Object.assign(p.attributes, patch);
        p.modified = new Date(state.now).toISOString();
        return { status: 200, body: { data: p } };
      }
      if (m && method === "DELETE") return { status: 204 };
      if (method === "POST" && url.pathname === "/api/v2/webhooks") {
        const b = (req.body ?? {}) as { url?: string; events?: string[] };
        if (!b.url) return { status: 422, body: { error: "url required" } };
        state.webhooks.push({ url: b.url, events: b.events ?? [] });
        return { status: 201, body: { id: `wh_${state.webhooks.length}` } };
      }
      return { status: 404, body: { error: "no route" } };
    }
    if (url.hostname === "crm-b.test") {
      if (h["authorization"] !== `Bearer ${KEY_B}`) return { status: 401, body: { error: "unauthorized" } };
      if (method === "GET" && url.pathname === "/v1/objects/jobs") {
        const per = Number(url.searchParams.get("limit") ?? "2");
        const after = Number(url.searchParams.get("after") ?? "0");
        const items = state.jobs.slice(after, after + per);
        const next = after + per < state.jobs.length ? `${url.origin}/v1/objects/jobs?limit=${per}&after=${after + per}` : undefined;
        return { status: 200, body: { items }, headers: next ? { link: `<${next}>; rel="next", <${url.origin}/v1/objects/jobs?limit=${per}>; rel="first"` } : {} };
      }
      if (method === "GET" && url.pathname === "/v1/schema/jobs") return { status: 200, body: B_SCHEMA };
      const m = /^\/v1\/objects\/jobs\/([\w-]+)$/.exec(url.pathname);
      if (m && method === "PATCH") {
        const x = state.jobs.find((y) => y.uid === m[1]);
        if (!x) return { status: 404 };
        Object.assign(x.props, (req.body as { props?: Record<string, unknown> } | undefined)?.props ?? {});
        x.touched = new Date(state.now).toISOString();
        return { status: 200, body: x };
      }
      return { status: 404, body: { error: "no route" } };
    }
    return { status: 404 };
  };

  return { state, handle, A_FIELDS, B_SCHEMA };
}

/** The SyncSpec an agent would fill for Ledger: people with a link to organizations, pick-lists as choices, pipeline stages from status. */
export function ledgerSpec(handle = "#Ledger_Key"): Record<string, unknown> {
  return {
    app: { name: "Ledger", domain: "crm-a.test", docsUrl: "https://docs.crm-a.test" },
    auth: { vaultHandle: handle, style: "header", header: "X-Api-Token" },
    objects: [
      {
        remote: "organizations", label: "Organization", id: "/id", itemsAt: "/data", updatedAt: "/modified",
        list: { path: "/api/v2/organizations", cursor: { kind: "page", param: "page", size: 10, sizeParam: "per_page" } },
        fields: [{ path: "/name", label: "Name", type: "text" }],
      },
      {
        remote: "people", label: "Person", count: 5, id: "/id", itemsAt: "/data", updatedAt: "/modified", openUrl: "https://app.crm-a.test/people/{id}",
        list: { path: "/api/v2/people", cursor: { kind: "page", param: "page", size: 2, sizeParam: "per_page" }, filter: { param: "modified_after", value: "2026-01-01T00:00:00Z" } },
        update: { path: "/api/v2/people/{id}", method: "PATCH", evidence: "https://docs.crm-a.test/people#update" },
        fields: [
          { path: "/attributes/full_name", label: "Name", type: "text" },
          { path: "/attributes/email", label: "Email", type: "email" },
          { path: "/attributes/phone", label: "Phone", type: "phone" },
          { path: "/attributes/status", label: "Status", type: "choice", choices: [{ value: "lead", label: "Lead" }, { value: "client", label: "Client" }, { value: "closed", label: "Closed" }] },
          { path: "/attributes/tier", label: "Tier", type: "choice", choices: [{ value: "gold" }, { value: "silver" }, { value: "bronze" }] },
          { path: "/attributes/note", label: "Note", type: "text" },
          { path: "/org_id", label: "Organization", type: "relation", relationTo: "organizations" },
        ],
      },
    ],
    mapping: [
      { remote: "organizations", recordType: "org", title: "Organization", fields: [{ path: "/name", field: "name", direction: "pull" }] },
      {
        remote: "people", recordType: "person", title: "Person", stagesFrom: "/attributes/status", match: ["/attributes/email"],
        fields: [
          { path: "/attributes/full_name", field: "name", direction: "both" }, { path: "/attributes/email", field: "email", direction: "both" }, { path: "/attributes/phone", field: "phone", direction: "both" },
          { path: "/attributes/status", field: "stage", direction: "both" }, { path: "/attributes/tier", field: "tier", direction: "both" }, { path: "/attributes/note", field: "note", direction: "both" },
          { path: "/org_id", field: "org", direction: "pull" },
        ],
      },
    ],
    plan: { firstPull: { words: "People changed since the start of 2026" }, backfill: "later", conflicts: "newest" },
  };
}

/** The SyncSpec for Orbit: a custom object, Link-header pagination, props nested under the item, a pick-list from the schema endpoint. */
export function orbitSpec(handle = "#Orbit_Key"): Record<string, unknown> {
  return {
    app: { name: "Orbit", domain: "crm-b.test" },
    auth: { vaultHandle: handle, style: "bearer" },
    objects: [{
      remote: "jobs", label: "Job", count: 3, id: "/uid", itemsAt: "/items", updatedAt: "/touched",
      list: { path: "/v1/objects/jobs", query: {}, cursor: { kind: "link", size: 2, sizeParam: "limit" } },
      update: { path: "/v1/objects/jobs/{id}", method: "PATCH", evidence: "https://docs.crm-b.test/jobs#update" },
      fields: [
        { path: "/props/title", label: "Title", type: "text" },
        { path: "/props/kind", label: "Kind", type: "choice", choices: [{ value: "install" }, { value: "repair" }] },
        { path: "/props/amount", label: "Amount", type: "money" },
        { path: "/props/opened", label: "Opened", type: "date" },
      ],
    }],
    mapping: [{
      remote: "jobs", recordType: "job", title: "Job", titleField: "/props/title",
      fields: [
        { path: "/props/title", field: "title", direction: "both" }, { path: "/props/kind", field: "kind", direction: "both" },
        { path: "/props/amount", field: "amount", direction: "both" }, { path: "/props/opened", field: "opened", direction: "pull" },
      ],
    }],
    plan: { firstPull: { words: "Every job" }, backfill: "now", conflicts: "newest" },
  };
}

/** Ledger as a second account: the same app, another tenant. */
export function ledgerAccountSpec(account: string, tenant?: string): Record<string, unknown> {
  const spec = ledgerSpec() as { app: Record<string, unknown>; objects: { remote: string; list: { query?: Record<string, string> }; update?: { path: string } }[]; plan: Record<string, unknown> };
  spec.app["account"] = account;
  const people = spec.objects.find((o) => o.remote === "people")!;
  if (tenant) { people.list.query = { tenant }; people.update!.path = `/api/v2/people/{id}?tenant=${tenant}`; }
  delete (people.list as { filter?: unknown }).filter;
  return spec as unknown as Record<string, unknown>;
}
