// The stdio shim a sandboxed CLI engine runs as its Vyre MCP server (ruling 61): MCP over stdio is one JSON-RPC message per line; each line is sent to the session's unix socket with the
// session token (from VYRE_MCP_TOKEN in the environment, never an argument) and the answer is written back as a line. It imports only node built-ins so it runs as `node shim.ts <socket>`
// inside the sandbox, where nothing of the repo is mounted but this file.
import net from "node:net";
import process from "node:process";
import { fileURLToPath } from "node:url";

export interface ShimOptions {
  socketPath: string;
  token: string;
  input: AsyncIterable<string | Uint8Array>;
  write(line: string): void;
}

/** Run until the input ends. Returns once every answer has been written. */
export async function runShim(o: ShimOptions): Promise<void> {
  const conn = net.createConnection(o.socketPath);
  await new Promise<void>((resolve, reject) => { conn.once("connect", resolve); conn.once("error", reject); });
  conn.setEncoding("utf8");
  let session: string | undefined;
  let waiting = 0;
  let ended = false;
  let done: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => { done = resolve; });
  const maybeDone = (): void => { if (ended && waiting === 0) done(); };

  // Requests are answered in the order they were sent; a notification gets a 202 and no output.
  const asked: Array<string | null> = [];
  let buf = "";
  conn.on("data", (chunk: string) => {
    buf += chunk;
    for (let at = buf.indexOf("\n"); at >= 0; at = buf.indexOf("\n")) {
      const line = buf.slice(0, at);
      buf = buf.slice(at + 1);
      let r: { status?: number; session?: string; body?: string };
      try { r = JSON.parse(line) as typeof r; } catch { continue; }
      const id = asked.shift() ?? null;
      waiting -= 1;
      if (typeof r.session === "string") session = r.session;
      if (r.status === 200 && typeof r.body === "string" && r.body !== "") o.write(r.body);
      else if (r.status !== 202 && id !== null) o.write(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(id) as unknown, error: { code: -32001, message: r.status === 401 ? "Vyre refused this session's token." : "Vyre could not answer." } }));
      maybeDone();
    }
  });
  conn.on("close", () => { waiting = 0; done(); });

  let carry = "";
  const dec = new TextDecoder();
  const send = (text: string): void => {
    let id: string | null = null;
    try { const m = JSON.parse(text) as { id?: unknown }; if (m && !Array.isArray(m) && m.id !== undefined) id = JSON.stringify(m.id); } catch { /* the server answers a parse error itself */ }
    asked.push(id);
    waiting += 1;
    conn.write(`${JSON.stringify({ token: o.token, ...(session === undefined ? {} : { session }), body: text })}\n`);
  };
  for await (const chunk of o.input) {
    carry += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
    for (let at = carry.indexOf("\n"); at >= 0; at = carry.indexOf("\n")) {
      const line = carry.slice(0, at).trim();
      carry = carry.slice(at + 1);
      if (line !== "") send(line);
    }
  }
  if (carry.trim() !== "") send(carry.trim());
  ended = true;
  maybeDone();
  await finished;
  conn.end();
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const socketPath = process.argv[2] ?? "";
  const token = process.env["VYRE_MCP_TOKEN"] ?? "";
  if (socketPath === "" || token === "") { process.stderr.write("vyre mcp shim: needs a socket path and VYRE_MCP_TOKEN\n"); process.exit(2); }
  runShim({ socketPath, token, input: process.stdin, write: (line) => process.stdout.write(`${line}\n`) }).then(() => process.exit(0), (e: unknown) => { process.stderr.write(`vyre mcp shim: ${e instanceof Error ? e.message : "failed"}\n`); process.exit(1); });
}
