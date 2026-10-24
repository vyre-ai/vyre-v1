// Glue between a Y.Doc and a Client's pending ops / docs table (the client side of ARCH 5.6).
import * as Y from "yjs";
const b64 = (u) => Buffer.from(u).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
export class DocSync {
  constructor(client, id, { e2e = false } = {}) {
    this.client = client; this.id = id; this.e2e = e2e; this.ydoc = new Y.Doc(); this.applied = 0; this.online = true; this.outq = [];
    this.ydoc.on("update", (u, origin) => { if (origin === "remote") return; this.outq.push(b64(u)); });
  }
  text() { return this.ydoc.getText("body"); }
  async flush() { for (const u of this.outq.splice(0)) await this.client.queueDoc(this.id, u, { e2e: this.e2e }); }
  async absorb() {
    const rows = await this.client.db.all("SELECT n, u FROM docs WHERE id=? AND n>? ORDER BY n", [this.id, this.applied]);
    for (const r of rows) {
      const f = JSON.parse(this.client.dec(r.u)).u; let s = f.v;
      if (f.key) s = this.client.e2eKeys.dec(f.v, f.key, f.nonce);
      Y.applyUpdate(this.ydoc, unb64(s), "remote"); this.applied = r.n;
    }
  }
}
export { Y, b64, unb64 };
export function rebuild(server, id, e2eKeys = null) {
  const d = new Y.Doc();
  for (const u of server.docUpdates(id, server.head())) { const f = JSON.parse(u.fields).u; Y.applyUpdate(d, unb64(e2eKeys && f.key ? e2eKeys.dec(f.v, f.key, f.nonce) : f.v), "remote"); }
  return d;
}
