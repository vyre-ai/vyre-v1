const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("express-fixture-ok"));
app.get("/api/env", (req, res) => res.json({ greeting: process.env.GREETING ?? null }));
app.get("/api/whoami", (req, res) => res.json({ user: req.get("x-vyre-user") ?? null }));
app.get("/api/db", async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(503).json({ db: "none" });
  const { Client } = require("pg");
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect();
    await c.query("create table if not exists hits (n int)");
    await c.query("insert into hits values (1)");
    const r = await c.query("select count(*)::int as n from hits");
    const t = await c.query("select to_regclass('public.imported') is not null as imported");
    res.json({ db: "ok", hits: r.rows[0].n, imported: t.rows[0].imported });
  } catch (e) { res.status(500).json({ db: "error", error: String(e.message) }); } finally { await c.end().catch(() => {}); }
});
const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0");
// a WebSocket at /ws: the handshake by hand, then one text frame naming who is asking
server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws") { socket.destroy(); return; }
  const accept = require("node:crypto").createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const text = Buffer.from(`ws-hello ${req.headers["x-vyre-user"] ?? "nobody"}`);
  socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
});
