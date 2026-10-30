// The stdio transport: newline-delimited JSON-RPC on a process's standard input and output. The process is started by the host through a Launcher that has already wrapped the command for the
// sandbox, so this file never decides where plugin code runs and cannot start one outside it.
import type { McpTransport } from "./client.ts";

/** The part of a started process the transport needs (the CliProcess of agent/src/drivers/cli/types.ts has all of it). */
export interface ProcLike {
  stdout: AsyncIterable<Uint8Array | string>;
  write(data: string): Promise<void>;
  endInput(): void;
  exited: Promise<unknown>;
  stderrTail(): string;
  kill(signal?: NodeJS.Signals): void;
}

export function stdioTransport(proc: ProcLike): McpTransport {
  let onMessage: (m: unknown) => void = () => undefined;
  let onClose: (why: string) => void = () => undefined;
  let closing = false;
  const decoder = new TextDecoder();
  void (async () => {
    let buf = "";
    try {
      for await (const chunk of proc.stdout) {
        buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line === "") continue;
          try { onMessage(JSON.parse(line) as unknown); } catch { /* a line that is not JSON (a log line on stdout) is skipped */ }
        }
      }
    } catch { /* the stream ended badly: the exit below reports it */ }
    await proc.exited.catch(() => undefined);
    if (!closing) {
      const tail = proc.stderrTail().trim();
      onClose(`The server stopped${tail !== "" ? `: ${tail.split("\n").slice(-3).join(" ").slice(0, 300)}` : "."}`);
    } else onClose("Closed.");
  })();
  return {
    send: (m) => proc.write(`${JSON.stringify(m)}\n`),
    onMessage: (cb) => { onMessage = cb; },
    onClose: (cb) => { onClose = cb; },
    close: async () => { closing = true; try { proc.endInput(); } catch { /* closed */ } proc.kill("SIGTERM"); },
  };
}
