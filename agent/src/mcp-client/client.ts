// An MCP client (Model Context Protocol, JSON-RPC 2.0, revision 2025-06-18): connect to any MCP server over a transport, list its tools and call them. This is how a plugin's MCP server or a
// remote connector (a ChatGPT app, a Claude connector, any URL) becomes tools for every model. The client only speaks the protocol. Starting a server process is the transport's business, and
// it happens in the sandbox (stdio.ts takes a launcher the host has already wrapped); a remote server is reached through a guarded fetch (http.ts).

export const PROTOCOL_VERSION = "2025-06-18";

export interface McpTransport {
  send(message: unknown): Promise<void>;
  onMessage(cb: (message: unknown) => void): void;
  onClose(cb: (why: string) => void): void;
  close(): Promise<void>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
  /** The server says this tool only reads (annotations.readOnlyHint). */
  readOnly: boolean;
}
export interface McpContent { type: string; text?: string; [k: string]: unknown }
export interface McpToolResult { isError: boolean; content: McpContent[]; structured?: unknown }

export class McpError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "McpError"; this.code = code; }
}

type Pending = { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> };
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export interface ConnectOptions { name?: string; version?: string; timeoutMs?: number }

export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed: string | null = null;
  serverName = "";
  serverVersion = "";
  /** The server announced that its tool list changed since the last listTools. */
  toolsChanged = false;

  private readonly t: McpTransport;
  private readonly timeoutMs: number;

  private constructor(t: McpTransport, timeoutMs: number) {
    this.t = t;
    this.timeoutMs = timeoutMs;
    t.onMessage((m) => this.receive(m));
    t.onClose((why) => this.fail(why === "" ? "The connection closed." : why));
  }

  static async connect(t: McpTransport, o: ConnectOptions = {}): Promise<McpClient> {
    const c = new McpClient(t, o.timeoutMs ?? 30_000);
    try {
      const init = obj(await c.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: o.name ?? "vyre", version: o.version ?? "1" } }));
      const info = obj(init["serverInfo"]);
      c.serverName = typeof info["name"] === "string" ? info["name"] : "";
      c.serverVersion = typeof info["version"] === "string" ? info["version"] : "";
      await t.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return c;
    } catch (e) {
      await t.close().catch(() => undefined);
      throw e;
    }
  }

  private receive(m: unknown): void {
    const msg = obj(m);
    const id = msg["id"];
    if (typeof msg["method"] === "string") {
      if (msg["method"] === "notifications/tools/list_changed") this.toolsChanged = true;
      if (id !== undefined && id !== null) {
        // a request from the server: answer ping, refuse the rest (this client offers no roots, sampling or elicitation)
        const reply = msg["method"] === "ping" ? { jsonrpc: "2.0", id, result: {} } : { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
        void this.t.send(reply).catch(() => undefined);
      }
      return;
    }
    if (typeof id !== "number") return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (msg["error"] !== undefined) {
      const e = obj(msg["error"]);
      p.reject(new McpError("mcp.server_error", typeof e["message"] === "string" ? e["message"] : "The server returned an error."));
    } else p.resolve(msg["result"]);
  }

  private fail(why: string): void {
    if (this.closed !== null) return;
    this.closed = why;
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new McpError("mcp.closed", why)); this.pending.delete(id); }
  }

  request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    if (this.closed !== null) return Promise.reject(new McpError("mcp.closed", this.closed));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new McpError("mcp.timeout", `${method} took more than ${Math.round(timeoutMs / 1000)} seconds.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.t.send({ jsonrpc: "2.0", id, method, params }).catch((e: unknown) => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new McpError("mcp.closed", e instanceof Error ? e.message : "Could not send."));
      });
    });
  }

  get isClosed(): boolean { return this.closed !== null; }

  async listTools(): Promise<McpTool[]> {
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = obj(await this.request("tools/list", cursor ? { cursor } : {}));
      for (const raw of Array.isArray(r["tools"]) ? r["tools"] : []) {
        const t = obj(raw);
        if (typeof t["name"] !== "string") continue;
        out.push({
          name: t["name"], description: typeof t["description"] === "string" ? t["description"] : (typeof t["title"] === "string" ? t["title"] : ""),
          inputSchema: t["inputSchema"] ?? { type: "object", properties: {} }, readOnly: obj(t["annotations"])["readOnlyHint"] === true,
        });
      }
      cursor = typeof r["nextCursor"] === "string" && r["nextCursor"] !== "" ? r["nextCursor"] : undefined;
      if (!cursor) break;
    }
    this.toolsChanged = false;
    return out;
  }

  async callTool(name: string, args: unknown, timeoutMs = 120_000): Promise<McpToolResult> {
    const r = obj(await this.request("tools/call", { name, arguments: obj(args) }, timeoutMs));
    const content = (Array.isArray(r["content"]) ? r["content"] : []).map((c) => obj(c) as McpContent);
    return { isError: r["isError"] === true, content, ...(r["structuredContent"] !== undefined ? { structured: r["structuredContent"] } : {}) };
  }

  async close(): Promise<void> {
    this.fail("Closed.");
    await this.t.close().catch(() => undefined);
  }
}

/** A tool result as the text a model reads: the text parts joined, other parts named, structured output when there is no text. */
export function resultText(r: McpToolResult): string {
  const parts = r.content.map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : `[${c.type}${typeof c["mimeType"] === "string" ? ` ${c["mimeType"]}` : ""}]`));
  const text = parts.join("\n");
  return text !== "" ? text : r.structured !== undefined ? JSON.stringify(r.structured) : "";
}
