// A Space the size of a real firm's synced import, for the speed walks (r34-appspeed): ~9,400 matters of ~100 fields each, 27,900 contacts, 1,100 organizations, 13,000 link rows between matters and contacts,
// ~7,000 further records. Files and chats are not seeded (files.create costs ~270 ms a call on this size, so 2,000 files would be nine minutes). Built through the capability API (records.bulk_upsert and friends) on a booted daemon, as an import writes them. Not a test file.
// `scale` shrinks every count for a unit test of the builder itself.
import { createCapCaller } from "../../client/src/gateway/index.ts";
import { routes } from "../../generated/routes.ts";

export interface BigSizes {
  matters: number;
  contacts: number;
  organizations: number;
  links: number;
  notes: number;
}
export const BIG: Readonly<BigSizes> = Object.freeze({
  matters: 9_400,
  contacts: 27_900,
  organizations: 1_100,
  links: 13_000,
  notes: 7_000,
});
export const bigSizes = (scale: number): BigSizes =>
  Object.fromEntries(
    Object.entries(BIG).map(([k, v]) => [k, Math.max(1, Math.round(v * scale))]),
  ) as unknown as BigSizes;

type Api = (cap: string, input: unknown) => Promise<any>;
export const apiFor = (base: string, token: string): Api => {
  const call = createCapCaller({ baseUrl: base, token: () => token, routes: async () => routes });
  return (cap, input) => call(cap as never, input as never) as Promise<any>;
};

const STAGES = ["intake", "review", "discovery", "negotiation", "filed", "hearing", "settled", "closed"];
const CHOICES = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
const WORDS = ["Northwind", "Lindahl", "Ibarra", "Harbor", "Summit", "Cedar", "Atlas", "Meridian", "Orchard", "Beacon"];
/** The 100 fields of a matter: a title, a stage, text, choices, dates, money, numbers and checkboxes; a formula and relations come after. */
export function matterFields(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [
    { key: "name", type: "text", title: "Name", required: true },
    { key: "stage", type: "status", title: "Stage", options: { stages: STAGES.map((k) => ({ key: k, title: k })) } },
  ];
  for (let i = 1; i <= 40; i++) out.push({ key: `text_${i}`, type: "text", title: `Detail ${i}` });
  for (let i = 1; i <= 15; i++)
    out.push({
      key: `choice_${i}`,
      type: "choice",
      title: `Choice ${i}`,
      options: { choices: CHOICES.map((k) => ({ key: k, title: k })) },
    });
  for (let i = 1; i <= 15; i++) out.push({ key: `date_${i}`, type: "datetime", title: `Date ${i}` });
  for (let i = 1; i <= 10; i++) out.push({ key: `money_${i}`, type: "money", title: `Amount ${i}` });
  for (let i = 1; i <= 10; i++) out.push({ key: `num_${i}`, type: "number", title: `Number ${i}` });
  for (let i = 1; i <= 7; i++) out.push({ key: `flag_${i}`, type: "checkbox", title: `Flag ${i}` });
  out.push({
    key: "total",
    type: "formula",
    title: "Total",
    options: { expr: "money_1 + money_2 + num_1" },
  });
  return out;
}

export function matterRow(i: number): Record<string, unknown> {
  const r: Record<string, unknown> = {
    name: `${WORDS[i % WORDS.length]} v ${WORDS[(i * 7 + 3) % WORDS.length]} ${i}`,
    stage: STAGES[i % STAGES.length],
  };
  for (let k = 1; k <= 40; k++) r[`text_${k}`] = `value ${k} of matter ${i}`;
  for (let k = 1; k <= 15; k++) r[`choice_${k}`] = CHOICES[(i + k) % CHOICES.length];
  for (let k = 1; k <= 15; k++)
    r[`date_${k}`] = new Date(Date.UTC(2020, 0, 1) + ((i * 31 + k * 7) % 2000) * 86_400_000).toISOString();
  for (let k = 1; k <= 10; k++) r[`money_${k}`] = { amount: ((i * 13 + k * 101) % 90_000) + 100, currency: "USD" };
  for (let k = 1; k <= 10; k++) r[`num_${k}`] = (i * k) % 1000;
  for (let k = 1; k <= 7; k++) r[`flag_${k}`] = (i + k) % 3 === 0;
  return r;
}

const chunked = async (
  n: number,
  size: number,
  each: (from: number, count: number) => Promise<void>,
): Promise<void> => {
  for (let from = 0; from < n; from += size) await each(from, Math.min(size, n - from));
};

export interface BigBuild {
  sizes: BigSizes;
  contactIds: string[];
  ms: Record<string, number>;
}

/** Fill a Space (empty, or fresh from a claim) with the big shape. Types: matter, big_contact, big_org, big_note (new types, so a Space that has its own built-ins is not disturbed). */
export async function seedBigSpace(
  api: Api,
  sizes: BigSizes = BIG,
  key = "big",
  space = "spc_fresh",
): Promise<BigBuild> {
  const ms: Record<string, number> = {};
  const t0 = Date.now();
  const lap = (what: string): void => {
    ms[what] = Date.now() - t0;
  };
  await api("schema.apply", {
    idempotencyKey: `${key}-types`,
    ops: [
      {
        op: "type.create",
        type: "matter",
        def: { title: "Matter", plural: "Matters", icon: "folder", titleField: "name", fields: matterFields() },
      },
      {
        op: "type.create",
        type: "big_contact",
        def: {
          title: "Person",
          plural: "People",
          icon: "user",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "Name", required: true },
            { key: "email", type: "email", title: "Email" },
            { key: "phone", type: "phone", title: "Phone" },
            { key: "city", type: "text", title: "City" },
          ],
        },
      },
      {
        op: "type.create",
        type: "big_org",
        def: {
          title: "Organization",
          plural: "Organizations",
          icon: "building",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "Name", required: true },
            { key: "site", type: "url", title: "Website" },
          ],
        },
      },
      {
        op: "type.create",
        type: "big_note",
        def: {
          title: "Entry",
          plural: "Entries",
          icon: "task",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "Name", required: true },
            { key: "body", type: "longtext", title: "Body" },
            { key: "on", type: "datetime", title: "On" },
          ],
        },
      },
    ],
  });
  await api("schema.apply", {
    idempotencyKey: `${key}-relations`,
    ops: [
      { op: "relation.add", type: "matter", field: "people", def: { to: "big_contact", inverse: "matters" } },
      { op: "relation.add", type: "big_contact", field: "employer", def: { to: "big_org", inverse: "staff" } },
    ],
  });
  lap("schema");
  await chunked(sizes.organizations, 500, async (from, count) => {
    await api("records.bulk_upsert", {
      idempotencyKey: `${key}-orgs-${from}`,
      type: "big_org",
      rows: Array.from({ length: count }, (_, k) => ({
        name: `${WORDS[(from + k) % WORDS.length]} Holdings ${from + k}`,
        site: `https://org${from + k}.northwind.example`,
      })),
      match: ["name"],
    });
  });
  await chunked(sizes.contacts, 1000, async (from, count) => {
    await api("records.bulk_upsert", {
      idempotencyKey: `${key}-contacts-${from}`,
      type: "big_contact",
      rows: Array.from({ length: count }, (_, k) => ({
        name: `${WORDS[(from + k) % WORDS.length]} Person ${from + k}`,
        email: `p${from + k}@northwind.example`,
        phone: `555-${String(1000 + ((from + k) % 9000))}`,
        city: WORDS[(from + k * 3) % WORDS.length],
      })),
      match: ["email"],
    });
  });
  lap("contacts");
  const contactIds: string[] = [];
  for (let cursor: string | undefined; ; ) {
    const page = await api("records.query", {
      type: "big_contact",
      fields: ["name"],
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const r of page.rows as { id: string }[]) contactIds.push(r.id);
    if (!page.next || contactIds.length >= sizes.contacts) break;
    cursor = page.next;
  }
  lap("ids");
  // the link rows ride on the matters: each matter holds the people its share of the links name
  const people = (i: number): { urn: string }[] => {
    const out: { urn: string }[] = [];
    for (let j = i; j < sizes.links; j += sizes.matters)
      out.push({ urn: `vyre://${space}/big_contact/${contactIds[(j * 2 + 1) % contactIds.length]!}` });
    return out;
  };
  await chunked(sizes.matters, 500, async (from, count) => {
    const out = await api("records.bulk_upsert", {
      idempotencyKey: `${key}-matters-${from}`,
      type: "matter",
      rows: Array.from({ length: count }, (_, k) => ({ ...matterRow(from + k), people: people(from + k) })),
      match: ["name"],
    });
    if (out.created !== count)
      throw new Error(
        `matters: created ${out.created} of ${count} (${JSON.stringify(out.refused ?? "").slice(0, 200)})`,
      );
  });
  lap("matters");
  await chunked(sizes.notes, 500, async (from, count) => {
    await api("records.bulk_upsert", {
      idempotencyKey: `${key}-notes-${from}`,
      type: "big_note",
      rows: Array.from({ length: count }, (_, k) => ({
        name: `Entry ${from + k}`,
        body: `Note ${from + k} about matter ${(from + k) % sizes.matters}. `.repeat(8),
        on: new Date(Date.UTC(2023, 0, 1) + ((from + k) % 700) * 86_400_000).toISOString(),
      })),
      match: ["name"],
    });
  });
  lap("notes");
  return { sizes, contactIds, ms };
}
