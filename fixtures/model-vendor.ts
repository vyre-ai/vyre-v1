// A local stand-in for the OpenAI chat completions endpoint: streams whatever a test scripts next. Used by the Ask live tests; the daemon, engine and OpenAI driver stay real.
import http from "node:http";

/** The model vendor: one streamed chat completion per request, with whatever the test scripts next (an answer, or an HTTP error). */
export async function vendor() {
  const script: Array<{ status?: number; text?: string; hold?: boolean }> = [];
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(body);
      const next = script.shift() ?? { text: "{}" };
      if (next.status && next.status !== 200) { res.writeHead(next.status, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "vendor says no", type: "invalid_request_error" } })); return; }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (o: unknown): void => { res.write(`data: ${JSON.stringify(o)}\n\n`); };
      // No assistant text while the socket stays open. A partial reply can be posted as the answer, and Cancel then finds nothing running.
      if (next.hold) { req.on("close", () => res.end()); return; }
      chunk({ id: "1", choices: [{ index: 0, delta: { role: "assistant", content: next.text ?? "" } }] });
      chunk({ id: "1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } });
      res.write("data: [DONE]\n\n"); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { script, requests, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() };
}

