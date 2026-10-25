// Builders for the import tests: calling a capability through the handler table, CSV text, and an .xlsx file made in memory.
import { deflateRawSync } from "node:zlib";
import { handlers } from "../impl.ts";
import type { Harness } from "./harness.ts";
import type { ImportCtx } from "../projections.ts";

type AnyHandler = (ctx: ImportCtx, input: any) => Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const table = handlers as unknown as Record<string, AnyHandler>;

let n = 0;
export const key = (): string => `k${++n}`;
/** Call a capability as the harness's caller (or another ctx); commit gets a fresh key unless the input has one. */
export function run(h: Harness, cap: string, input: Record<string, unknown>, ctx: ImportCtx = h.ctx): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const f = table[cap];
  if (!f) throw new Error(`no handler for ${cap}`);
  return f(ctx, cap === "import.commit" && input["idempotencyKey"] === undefined ? { ...input, idempotencyKey: key() } : input);
}

export const CSV = [
  "Full Name,E-mail,Phone,Company,Joined,VIP,Amount,Stage",
  "Ada Lovelace,ada@example.com,+1 555 010 0101,Analytical,2026-01-05,yes,\"1,200.50\",Lead",
  "Grace Hopper,GRACE@example.com,(555) 010-0102,Navy,01/06/2026,no,300,Client",
  "Alan Turing,alan@example.com,555-010-0103,Bletchley,\"Jan 7, 2026\",,15,Lead",
].join("\n");
export const MAPPING = [
  { column: "Full Name", field: "name" }, { column: "E-mail", field: "email" }, { column: "Phone", field: "phone" }, { column: "Company", field: "company" },
  { column: "Joined", field: "joined" }, { column: "VIP", field: "vip" }, { column: "Amount", field: "amount" }, { column: "Stage", field: "stage" },
];
/** Parse CSV text into a staged import. */
export const stage = async (h: Harness, text: string = CSV): Promise<string> => (await run(h, "import.parse_csv", { text })).importId;

// ---- a small .xlsx in memory ----

const enc = new TextEncoder();
const u16 = (v: number): number[] => [v & 255, (v >> 8) & 255];
const u32 = (v: number): number[] => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
/** A zip of the given files. The first is stored, the others deflated, so both methods are read. CRCs are left zero: the reader does not check them. */
export function makeZip(files: Record<string, string>): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  let i = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const stored = i === 0;
    const data = stored ? raw : new Uint8Array(deflateRawSync(raw));
    const nameBytes = [...enc.encode(name)];
    const offset = parts.length;
    parts.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(stored ? 0 : 8), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes, ...data);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(stored ? 0 : 8), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes);
    i++;
  }
  const count = Object.keys(files).length;
  return new Uint8Array([...parts, ...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(central.length), ...u32(parts.length), ...u16(0)]);
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/**
 * A workbook with the given sheets. A cell is text (shared string), a number, or { date: serial } (a cell with a date format), or { inline: text }.
 * Style 1 is a built-in date format (14), style 2 a custom "yyyy-mm-dd hh:mm" format.
 */
export type Cell = string | number | { date: number } | { inline: string } | null;
export function makeXlsx(sheets: Record<string, Cell[][]>): Uint8Array {
  const shared: string[] = [];
  const sid = (s: string): number => { const at = shared.indexOf(s); if (at >= 0) return at; shared.push(s); return shared.length - 1; };
  const letters = (c: number): string => { let s = ""; for (let x = c + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
  const sheetXml = (rows: Cell[][]): string => `<?xml version="1.0"?><worksheet><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
    const ref = `${letters(ci)}${ri + 1}`;
    if (c === null) return `<c r="${ref}"/>`;
    if (typeof c === "string") return `<c r="${ref}" t="s"><v>${sid(c)}</v></c>`;
    if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
    if ("date" in c) return `<c r="${ref}" s="${Number.isInteger(c.date) ? 1 : 2}"><v>${c.date}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${esc(c.inline)}</t></is></c>`;
  }).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const names = Object.keys(sheets);
  const files: Record<string, string> = {
    "[Content_Types].xml": '<?xml version="1.0"?><Types/>',
    "xl/workbook.xml": `<?xml version="1.0"?><workbook><sheets>${names.map((nm, i) => `<sheet name="${esc(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships>${names.map((_nm, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
    "xl/styles.xml": '<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>',
  };
  names.forEach((nm, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[nm] as Cell[][]); });
  files["xl/sharedStrings.xml"] = `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`;
  return makeZip(files);
}
