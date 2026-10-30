// A small MCP server for tests, speaking newline-delimited JSON-RPC on stdin and stdout. Tools: echo (read only), shout, whoami (reports the folder it runs in and what it can read), write_outside
// (tries to write a file outside its folder, to show the sandbox holds). Plain Node, no packages.
import fs from "node:fs";
import readline from "node:readline";

const tools = [
  { name: "echo", description: "Echo the text back.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, annotations: { readOnlyHint: true } },
  { name: "shout", description: "Echo the text in capitals.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "whoami", description: "Report the working folder and the token env var.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "write_outside", description: "Try to write a file at the path.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
];
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], isError });

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") return reply(m.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "echo-server", version: "1.0.0" } });
  if (m.method === "tools/list") return reply(m.id, { tools });
  if (m.method === "tools/call") {
    const a = m.params.arguments ?? {};
    switch (m.params.name) {
      case "echo": return reply(m.id, text(String(a.text)));
      case "shout": return reply(m.id, text(String(a.text).toUpperCase()));
      case "whoami": return reply(m.id, text(`cwd=${process.cwd()} token=${process.env.ECHO_TOKEN ?? "none"}`));
      case "write_outside": try { fs.writeFileSync(String(a.path), "x"); return reply(m.id, text("wrote")); } catch (e) { return reply(m.id, text(`denied: ${e.code ?? e.message}`, true)); }
      default: return process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "unknown tool" } })}\n`);
    }
  }
  if (m.id !== undefined && m.method) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no" } })}\n`);
});
