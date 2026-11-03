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
app.listen(Number(process.env.PORT || 3000), "0.0.0.0");
