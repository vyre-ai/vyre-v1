// Node stand-in for the origin private file system.
// The web build uses navigator.storage.getDirectory(). This directory holds the same file names and bytes
// and survives a process restart, which a browser OPFS origin also does.

import fs from "node:fs";
import path from "node:path";

export class OpfsDirectory {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  /** Relative file inside the origin. Rejects absolute paths and parent segments. */
  path(name: string): string {
    if (name.length === 0 || path.isAbsolute(name) || name.split(/[\\/]/).includes("..")) {
      throw new Error("opfs name rejected");
    }
    return path.join(this.root, name);
  }

  write(name: string, data: Buffer): void {
    const file = this.path(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }

  read(name: string): Buffer | null {
    const file = this.path(name);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }

  /** Every file under the origin, concatenated, for the plaintext-at-rest check. */
  bytes(): Buffer {
    const chunks: Buffer[] = [];
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        const st = fs.statSync(file);
        if (st.isDirectory()) walk(file);
        else chunks.push(fs.readFileSync(file));
      }
    };
    walk(this.root);
    return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
  }
}
