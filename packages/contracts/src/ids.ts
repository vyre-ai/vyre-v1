// Id formats: `<prefix>_<lowercase alphanumerics>` (ARCH 2 ids, spec 2.9 for record ids).
export const ID_PREFIXES = ['usr', 'agt', 'act', 'svc', 'grp', 'rol', 'gnt', 'pol', 'dev', 'ses', 'inv', 'rec', 'prj', 'tsk', 'run', 'thr', 'msg', 'chn', 'trn', 'blk', 'pln', 'fil', 'fld', 'blb', 'ver', 'chg', 'mnt', 'vit', 'vfd', 'aut', 'jrn', 'cmp', 'frm', 'sit', 'kit', 'con', 'mbx', 'num', 'dom', 'evt', 'mtg', 'cal', 'cmt', 'trm', 'ntf', 'cfl', 'fct', 'not', 'rpt', 'dec', 'spc'] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

const RE = /^([a-z]{3})_([a-z0-9]+)$/;

export function isId(prefix: IdPrefix, s: string): boolean {
  const m = RE.exec(s);
  return m !== null && m[1] === prefix;
}

/** Make an id from random bytes (caller supplies the bytes; lib/ids owns the generator). */
export function makeId(prefix: IdPrefix, bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += (b % 36).toString(36);
  return `${prefix}_${out}`;
}

export function prefixOf(id: string): string | null {
  return RE.exec(id)?.[1] ?? null;
}
