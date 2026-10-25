// @ts-check
// The warmup pool behind node:http (warmup.vyre.run runs this beside the relay). One service object, no dependencies. The body is read up to MAX_BODY plus a little, so a
// large POST is refused without being held in memory; every answer is JSON.

import http from "node:http";
import { MAX_BODY } from "./wire.js";
import { createPoolService } from "./service.js";

/** @param {{ service?: ReturnType<typeof createPoolService> } & Parameters<typeof createPoolService>[0]} [o] */
export function createWarmupServer(o = {}) {
  const service = o.service ?? createPoolService(o);
  const server = http.createServer((req, res) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0, refused = false;
    const send = (/** @type {number} */ status, /** @type {unknown} */ json) => {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(json));
    };
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY + 1024) {
        if (!refused) { refused = true; send(413, { error: { code: "validation.too_large", message: "The body is too big." } }); req.destroy(); }
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (refused) return;
      /** @type {Record<string, string | undefined>} */
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
      service.handle({ method: req.method ?? "GET", path: req.url ?? "/", headers, body: Buffer.concat(chunks).toString("utf8") })
        .then(r => send(r.status, r.json))
        .catch(() => send(500, { error: { code: "internal.unexpected", message: "The pool service failed." } }));
    });
    req.on("error", () => {});
  });
  return { server, service };
}
