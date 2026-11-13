// The shapes of Vyre ids, in one place (owner, 13 Nov 2026: an id is never shown to a person). The prefixes are the ones the contracts mint (manifests/_common.ts `id`); lib/tests/id-shapes.test.ts fails when
// the two lists differ. The product uses this to refuse an id as a label; the tests use it to scan a rendered screen for one.

/** Every id prefix the contracts mint, plus `out` (an outside agent). */
export const ID_PREFIXES: readonly string[] = [
  "usr", "agt", "act", "svc", "grp", "rol", "gnt", "pol", "dev", "ses", "inv", "rec", "prj", "tsk", "run", "thr", "msg", "chn", "trn", "blk", "pln", "fil", "fld", "blb", "ver", "chg", "mnt",
  "vit", "vfd", "aut", "jrn", "frm", "sit", "kit", "con", "mbx", "num", "dom", "evt", "mtg", "cal", "cmt", "trm", "ntf", "cfl", "fct", "not", "rpt", "dec", "spc", "gol", "out",
];

const BODY = "[0-9a-z]{8,}(?:-[0-9a-z]+)*";
const ONE = new RegExp(`^(?:${ID_PREFIXES.join("|")})_${BODY}$`);
const ANY = new RegExp(`(?<![A-Za-z0-9_])(?:${ID_PREFIXES.join("|")})_${BODY}(?![A-Za-z0-9_])`, "g");

/** True when the whole text is one id ("usr_ec028017ceefaf270b"). */
export const isRawId = (text: string): boolean => ONE.test(text.trim());

/** Every id inside a text, in order. */
export const rawIdsIn = (text: string): string[] => text.match(ANY) ?? [];

/** The text with every id taken out, and the spaces it leaves closed up: what is left of a line that was only ids is an empty string. */
export const withoutRawIds = (text: string): string => text.replace(ANY, " ").replace(/\s{2,}/g, " ").trim();
