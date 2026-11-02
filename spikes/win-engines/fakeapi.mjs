// Host: a fake model API. Every model call is logged to argv[3]. The first call of a turn answers with ONE tool call (the tool named in argv[4]'s file: bash, powershell, codex);
// the call that carries the tool's result answers with plain text and logs that result. Anthropic Messages (Claude Code) and OpenAI Responses (Codex), streamed or not.
import fs from "node:fs";
import http from "node:http";
const [portFile, logFile, modeFile] = process.argv.slice(2);
const log = (o) => fs.appendFileSync(logFile, JSON.stringify(o) + "\n");
const sse = (res, events) => { res.writeHead(200, { "content-type": "text/event-stream" }); for (const [e, d] of events) res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`); res.end(); };
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    let j = {};
    try { j = JSON.parse(body || "{}"); } catch { /* not json */ }
    const mode = fs.existsSync(modeFile) ? fs.readFileSync(modeFile, "utf8").trim() : "bash";
    const tools = (j.tools ?? []).map((t) => t.name ?? t.function?.name ?? t.type);
    log({ path: req.url, method: req.method, stream: j.stream === true, tools, mode });
    if (req.url.includes("count_tokens")) { res.writeHead(200, { "content-type": "application/json" }); res.end('{"input_tokens":1}'); return; }
    if (req.url.startsWith("/v1/messages")) {
      const result = JSON.stringify(j.messages ?? []).match(/"type":"tool_result".{0,400}/)?.[0];
      if (result) log({ toolResult: result });
      const usage = { input_tokens: 1, output_tokens: 1 };
      const msg = { id: "msg_1", type: "message", role: "assistant", model: j.model ?? "fake", content: [], stop_reason: null, stop_sequence: null, usage };
      const tool = mode === "powershell" ? { name: "PowerShell", input: { command: "Set-Content -Path spike-tool.txt -Value spike-tool-ok; Get-Content spike-tool.txt" } } : { name: "Bash", input: { command: "echo spike-tool-ok > spike-tool.txt && cat spike-tool.txt", description: "spike" } };
      const block = result ? { type: "text", text: "" } : { type: "tool_use", id: "toolu_spike1", name: tool.name, input: {} };
      const delta = result ? { type: "text_delta", text: "spike done" } : { type: "input_json_delta", partial_json: JSON.stringify(tool.input) };
      const stop = result ? "end_turn" : "tool_use";
      if (j.stream) return sse(res, [["message_start", { type: "message_start", message: msg }], ["content_block_start", { type: "content_block_start", index: 0, content_block: block }], ["content_block_delta", { type: "content_block_delta", index: 0, delta }], ["content_block_stop", { type: "content_block_stop", index: 0 }], ["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } }], ["message_stop", { type: "message_stop" }]]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...msg, content: [result ? { type: "text", text: "spike done" } : { type: "tool_use", id: "toolu_spike1", name: tool.name, input: tool.input }], stop_reason: stop }));
      return;
    }
    if (req.url.startsWith("/v1/responses")) {
      const out = (j.input ?? []).find((i) => i.type === "function_call_output" || i.type === "custom_tool_call_output");
      if (out) log({ toolResult: JSON.stringify(out).slice(0, 400) });
      const usage = { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 };
      let item;
      if (out) item = { type: "message", id: "msg_2", role: "assistant", status: "completed", content: [{ type: "output_text", text: "spike done", annotations: [] }] };
      else if (tools.includes("exec_command")) item = { type: "function_call", id: "fc_1", call_id: "call_1", name: "exec_command", arguments: JSON.stringify({ cmd: "echo spike-tool-ok > spike-tool.txt" }) };
      else if (tools.includes("shell_command")) item = { type: "function_call", id: "fc_1", call_id: "call_1", name: "shell_command", arguments: JSON.stringify({ command: "echo spike-tool-ok > spike-tool.txt" }) };
      else item = { type: "function_call", id: "fc_1", call_id: "call_1", name: "shell", arguments: JSON.stringify({ command: ["cmd.exe", "/c", "echo spike-tool-ok> spike-tool.txt"] }) };
      const resp = { id: "resp_1", object: "response", status: "completed", output: [item], usage };
      return sse(res, [["response.created", { type: "response.created", response: { ...resp, status: "in_progress", output: [] } }], ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item }], ["response.completed", { type: "response.completed", response: resp }]]);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(portFile, String(server.address().port)));
setTimeout(() => process.exit(0), 20 * 60_000);
