// from vyre 0.6.9 lib/expr/errors.js@d8eba9e57
export class LanguageError extends Error {
  code: string;
  line: number | undefined;
  col: number | undefined;
  path: string | undefined;
  /**
   * @param {string} code stable machine code, for example "forbidden_syntax"
   * @param {string} message plain sentence for the author
   * @param {{ line?: number, col?: number, path?: string }} [where]
   */
  constructor(code, message, where = {}) {
    super(where.line ? `${message} (line ${where.line}, column ${where.col ?? 1})` : where.path ? `${message} (at ${where.path})` : message);
    this.name = "LanguageError";
    this.code = code;
    this.line = where.line;
    this.col = where.col;
    this.path = where.path;
  }
}
