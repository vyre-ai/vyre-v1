// New document: the calls, as plain functions the sheet and the tests share. One capability call each; a refusal comes back as the server's own sentence.
import { sayError } from "../sign/actions.ts";
import type { SignData } from "../sign/data.tsx";
import { previewOf, valuesOf } from "./model.ts";
import type { Format, Kind, Made, Preview, TemplateRow } from "./model.ts";

type Call = SignData["call"];
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (x: unknown): string | undefined => (typeof x === "string" && x !== "" ? x : undefined);

/** Every template the person can open (the sheet keeps the ones for this record's kind and for any). */
export async function loadTemplates(call: Call): Promise<Result<TemplateRow[]>> {
  try {
    const out = (await call("documents.templates.list", { limit: 100 })) as { templates?: unknown[] } | undefined;
    const list = (out?.templates ?? []).flatMap((x): TemplateRow[] => {
      const t = x as Record<string, unknown>;
      const fileId = str(t.fileId);
      const name = str(t.name);
      if (!fileId || !name) return [];
      const type = str(t.recordType);
      return [
        { fileId, name, fields: typeof t.fields === "number" ? t.fields : 0, ...(type ? { recordType: type } : {}) },
      ];
    });
    return { ok: true, value: list };
  } catch (e) {
    return { ok: false, error: sayError(e) };
  }
}

/** What the template asks for, and the page filled from the record and what has been typed, with what is missing marked. */
export async function readTemplate(
  call: Call,
  template: TemplateRow,
  recordId: string,
  typed: { values: Record<string, string>; signingDate: string; kinds: ReadonlyMap<string, Kind> },
): Promise<Result<Preview>> {
  try {
    const fields = await call("documents.fields", { templateFileId: template.fileId });
    const shown = await call("documents.preview_fill", {
      templateFileId: template.fileId,
      recordId,
      values: valuesOf(typed.values, typed.kinds),
      signingDate: typed.signingDate,
    });
    const preview = previewOf(fields, shown);
    return preview ? { ok: true, value: preview } : { ok: false, error: "That did not open. Try again." };
  } catch (e) {
    return { ok: false, error: sayError(e) };
  }
}

/** Make the document in the record's folder. The key is the person's one press: pressing again after a failure makes the same file once. */
export async function makeDocument(
  call: Call,
  input: {
    template: TemplateRow;
    recordId: string;
    folderId: string;
    values: Record<string, string>;
    signingDate: string;
    kinds: ReadonlyMap<string, Kind>;
    format: Format;
    key: string;
  },
): Promise<Result<Made>> {
  try {
    const out = (await call("documents.fill", {
      templateFileId: input.template.fileId,
      intoFolderId: input.folderId,
      recordId: input.recordId,
      values: valuesOf(input.values, input.kinds),
      signingDate: input.signingDate,
      format: input.format,
      idempotencyKey: input.key,
    })) as
      | { file?: { fileId?: unknown; name?: unknown }; signers?: unknown; layout?: unknown; converter?: unknown }
      | undefined;
    const fileId = str(out?.file?.fileId);
    const name = str(out?.file?.name);
    if (!fileId || !name) return { ok: false, error: "That did not go through. Try again." };
    return {
      ok: true,
      value: {
        fileId,
        name,
        signers: Array.isArray(out?.signers) ? out.signers.filter((x): x is string => typeof x === "string") : [],
        ...(out?.layout === "word" || out?.layout === "simple" ? { layout: out.layout } : {}),
        ...(out?.converter === "pulling" || out?.converter === "failed" || out?.converter === "none"
          ? { converter: out.converter }
          : {}),
      },
    };
  } catch (e) {
    return { ok: false, error: sayError(e) };
  }
}
