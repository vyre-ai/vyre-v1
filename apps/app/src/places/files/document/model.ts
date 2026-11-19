// New document, from a template: what the sheet holds, as one explicit state machine. A person picks a template (the ones for this kind of record, and the ones for any), the sheet shows the page filled
// from the record with what is missing marked, they type the missing fields, and it is made. Nothing here calls the server: the screen and the tests share it, and every move has a place to go.
//
//   templates (loading | ready | failed)  --pick-->  fill (loading | ready | checking | making | failed)  --made-->  made
//   Any state goes Back or closes; a failure keeps everything typed; a late answer to a request that was replaced is ignored; Make is refused while a field is still empty and names it.
//
// The words are the product's: "Fields", "Make", "Send for signature". Never "tag", never "placeholder".

export interface TemplateRow {
  fileId: string;
  name: string;
  fields: number;
  recordType?: string;
}
export type Kind = "text" | "date" | "money" | "list" | "condition" | "loop";
export interface FieldRow {
  name: string;
  kind: Kind;
  required: boolean;
  loop?: string;
}
export interface ExcerptLine {
  text: string;
  filled: { from: number; to: number; field: string }[];
}
export interface Preview {
  fields: FieldRow[];
  excerpt: ExcerptLine[];
  /** the fields the record did not give, as the server named them for the values typed so far */
  missing: string[];
  signers: string[];
  /** a problem the server found in the template itself */
  problems: string[];
}
export type Format = "pdf" | "docx" | "md";
export interface Made {
  fileId: string;
  name: string;
  signers: string[];
  layout?: "word" | "simple";
}

export type DocState =
  | { phase: "templates"; status: "loading" | "ready" | "failed"; templates: TemplateRow[]; error: string | null }
  | {
      phase: "fill";
      status: "loading" | "ready" | "checking" | "making" | "failed";
      templates: TemplateRow[];
      template: TemplateRow;
      preview: Preview | null;
      values: Record<string, string>;
      signingDate: string;
      format: Format;
      /** which request a late answer must belong to */
      token: number;
      error: string | null;
    }
  | { phase: "made"; templates: TemplateRow[]; template: TemplateRow; made: Made };

export type DocEvent =
  | { t: "templates"; list: TemplateRow[] }
  | { t: "templates_failed"; error: string }
  | { t: "reload" }
  | { t: "pick"; template: TemplateRow; today: string }
  | { t: "previewed"; token: number; preview: Preview }
  | { t: "preview_failed"; token: number; error: string }
  | { t: "edit"; name: string; value: string }
  | { t: "date"; value: string }
  | { t: "format"; format: Format }
  | { t: "check" }
  | { t: "make" }
  | { t: "made"; token: number; made: Made }
  | { t: "make_failed"; token: number; error: string }
  | { t: "back" };

export const initial = (): DocState => ({ phase: "templates", status: "loading", templates: [], error: null });

/** The formats a template can make: a Word file to Word or a PDF, a Vyre document to a PDF or to go on editing. */
export const formatsFor = (templateName: string): { format: Format; label: string }[] =>
  /\.(md|markdown)$/i.test(templateName)
    ? [
        { format: "pdf", label: "PDF" },
        { format: "md", label: "Document" },
      ]
    : [
        { format: "docx", label: "Word" },
        { format: "pdf", label: "PDF" },
      ];

/** What the person sees named for a field: `client.name` is Client name. */
export function labelOf(name: string): string {
  const words = name
    .split(/[._]+/)
    .filter((w) => w !== "")
    .join(" ")
    .toLowerCase();
  return words === "" ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

const isSigning = (name: string): boolean => /^signing_/.test(name);

/** The fields the person is asked for: what the record did not give, one by one, minus the signing date (its own control) and anything inside a list (a list is filled by an agent or an Automation). */
export function asked(preview: Preview | null): FieldRow[] {
  if (!preview) return [];
  const kinds = new Map(preview.fields.map((f) => [f.name, f] as const));
  return preview.missing.flatMap((name) => {
    if (isSigning(name)) return [];
    const f = kinds.get(name);
    if (f && (f.loop !== undefined || f.kind === "loop" || f.kind === "list")) return [];
    return [{ name, kind: f?.kind ?? "text", required: true } satisfies FieldRow];
  });
}

/** True when the template repeats a list the sheet cannot fill by typing. */
export const needsList = (preview: Preview | null): boolean =>
  !!preview && preview.missing.some((m) => preview.fields.some((f) => f.name === m && (f.kind === "loop" || f.kind === "list" || f.loop !== undefined)));

/** Whether the template uses the signing date at all. */
export const usesSigningDate = (preview: Preview | null): boolean =>
  !!preview && (preview.fields.some((f) => isSigning(f.name)) || preview.missing.some(isSigning));

/** The asked fields still empty. */
export function stillEmpty(s: Extract<DocState, { phase: "fill" }>): FieldRow[] {
  return asked(s.preview).filter((f) => (s.values[f.name] ?? "").trim() === "");
}

/** Why Make is not available yet, in the person's words; null when it is. */
export function whyNot(s: Extract<DocState, { phase: "fill" }>): string | null {
  if (!s.preview) return "The template is still opening.";
  if (s.preview.problems.length > 0) return s.preview.problems[0] ?? "The template has a problem.";
  if (needsList(s.preview)) return "This template repeats a list. Ask an agent to make it, or fill the list in an Automation.";
  const empty = stillEmpty(s);
  if (empty.length > 0) return `Still empty: ${empty.map((f) => labelOf(f.name)).join(", ")}.`;
  if (usesSigningDate(s.preview) && !/^\d{4}-\d{2}-\d{2}$/.test(s.signingDate)) return "The signing date is a day like 2026-11-19.";
  return null;
}

export function canMake(s: DocState): boolean {
  return s.phase === "fill" && (s.status === "ready" || s.status === "failed" || s.status === "checking") && whyNot(s) === null;
}

const same = <T extends DocState>(s: T, patch: Partial<T>): T => ({ ...s, ...patch });

export function step(s: DocState, e: DocEvent): DocState {
  switch (e.t) {
    case "templates":
      return s.phase === "templates"
        ? { ...s, status: "ready", templates: e.list, error: null }
        : s.phase === "fill"
          ? { ...s, templates: e.list }
          : s;
    case "templates_failed":
      return s.phase === "templates" ? { ...s, status: "failed", error: e.error } : s;
    case "reload":
      return s.phase === "templates" ? { ...s, status: "loading", error: null } : s;
    case "pick":
      if (s.phase === "made") return s;
      return {
        phase: "fill",
        status: "loading",
        templates: s.templates,
        template: e.template,
        preview: null,
        values: {},
        signingDate: e.today,
        format: "pdf",
        token: (s.phase === "fill" ? s.token : 0) + 1,
        error: null,
      };
    case "previewed":
      if (s.phase !== "fill" || e.token !== s.token) return s;
      return same(s, { status: "ready", preview: e.preview, error: null });
    case "preview_failed":
      if (s.phase !== "fill" || e.token !== s.token) return s;
      return same(s, { status: "failed", error: e.error });
    case "edit":
      return s.phase === "fill" ? same(s, { values: { ...s.values, [e.name]: e.value } }) : s;
    case "date":
      return s.phase === "fill" ? same(s, { signingDate: e.value }) : s;
    case "format":
      return s.phase === "fill" && formatsFor(s.template.name).some((f) => f.format === e.format)
        ? same(s, { format: e.format })
        : s;
    case "check":
      // read the page again with what is typed; only from a state that is not already asking
      return s.phase === "fill" && (s.status === "ready" || s.status === "failed")
        ? same(s, { status: "checking", token: s.token + 1, error: null })
        : s;
    case "make":
      return canMake(s) && s.phase === "fill" ? same(s, { status: "making", token: s.token + 1, error: null }) : s;
    case "made":
      if (s.phase !== "fill" || s.status !== "making" || e.token !== s.token) return s;
      return { phase: "made", templates: s.templates, template: s.template, made: e.made };
    case "make_failed":
      if (s.phase !== "fill" || s.status !== "making" || e.token !== s.token) return s;
      // everything typed stays; the page can be made again
      return same(s, { status: "failed", error: e.error });
    case "back":
      if (s.phase === "fill" || s.phase === "made")
        return { phase: "templates", status: "ready", templates: s.templates, error: null };
      return s;
  }
}

/** The templates the sheet offers for a record of this type: the ones for this type and the ones for any, by name. */
export function offered(list: readonly TemplateRow[], recordType: string): TemplateRow[] {
  return list
    .filter((t) => t.recordType === undefined || t.recordType === recordType)
    .sort((a, b) => Number(b.recordType === recordType) - Number(a.recordType === recordType) || a.name.localeCompare(b.name));
}

/** The values to send: a dotted name becomes a group (`client.name` is `{ client: { name } }`), an amount that reads as a number is one, an empty value is left out so the server names it. */
export function valuesOf(values: Record<string, string>, kinds: ReadonlyMap<string, Kind>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(values)) {
    const text = raw.trim();
    if (text === "") continue;
    let v: unknown = text;
    if (kinds.get(name) === "money") {
      const n = Number(text.replace(/[$,\s]/g, ""));
      if (Number.isFinite(n)) v = n;
    }
    const path = name.split(".");
    let at = out;
    path.forEach((p, i) => {
      if (i === path.length - 1) at[p] = v;
      else {
        const next = at[p];
        at = typeof next === "object" && next !== null ? (next as Record<string, unknown>) : (at[p] = {}) as Record<string, unknown>;
      }
    });
  }
  return out;
}

/** The preview from what the server answered; null when the answer is not shaped like one. */
export function previewOf(fields: unknown, shown: unknown): Preview | null {
  const f = fields as { fields?: unknown; signers?: unknown; problems?: unknown } | null;
  const p = shown as { excerpt?: unknown; missing?: unknown } | null;
  if (!f || !p || !Array.isArray(f.fields) || !Array.isArray(p.excerpt) || !Array.isArray(p.missing)) return null;
  const rows = f.fields.flatMap((x): FieldRow[] => {
    const r = x as Record<string, unknown>;
    return typeof r.name === "string" && typeof r.kind === "string"
      ? [
          {
            name: r.name,
            kind: r.kind as Kind,
            required: r.required !== false,
            ...(typeof r.loop === "string" ? { loop: r.loop } : {}),
          },
        ]
      : [];
  });
  return {
    fields: rows,
    excerpt: p.excerpt.flatMap((x): ExcerptLine[] => {
      const l = x as { text?: unknown; filled?: unknown };
      return typeof l.text === "string"
        ? [{ text: l.text, filled: Array.isArray(l.filled) ? (l.filled as ExcerptLine["filled"]) : [] }]
        : [];
    }),
    missing: p.missing.filter((m): m is string => typeof m === "string"),
    signers: Array.isArray(f.signers) ? f.signers.filter((m): m is string => typeof m === "string") : [],
    problems: Array.isArray(f.problems)
      ? f.problems.flatMap((x) => (typeof (x as { message?: unknown }).message === "string" ? [(x as { message: string }).message] : []))
      : [],
  };
}
