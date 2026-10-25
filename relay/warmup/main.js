// @ts-check
// Runs the warmup pool: node relay/warmup/main.js [port]. PORT or the first argument; 127.0.0.1 unless HOST is set (Caddy fronts it at warmup.vyre.run).
import { createWarmupServer } from "./server.js";

const port = Number(process.argv[2] ?? process.env["PORT"] ?? 8788);
const host = process.env["HOST"] ?? "127.0.0.1";
const { server } = createWarmupServer();
server.listen(port, host, () => { console.log(`warmup pool on http://${host}:${port}`); });
