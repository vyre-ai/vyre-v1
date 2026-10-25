// A WebSocket server for the live view, with nothing but node:http and node:crypto (RFC 6455): the handshake, masked client frames, ping and pong, close, fragments. Frames go out unmasked.
// The live view sends many frames and reads few messages, so a send is dropped when the socket is backed up: a slow viewer sees fewer frames, never old ones.
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE = 1024 * 1024;
const BACKLOG = 2 * 1024 * 1024;

export interface WsConn {
  /** False when the frame was dropped because the viewer is behind. Text goes as a text frame, bytes as a binary frame. */
  send(data: string | Uint8Array): boolean;
  close(code?: number): void;
  onMessage(f: (data: string | Uint8Array, binary: boolean) => void): void;
  onClose(f: () => void): void;
}

function frame(opcode: number, payload: Uint8Array): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xff]) : Buffer.concat([Buffer.from([0x80 | opcode, 127]), Buffer.alloc(8)]);
  if (n >= 65536) head.writeBigUInt64BE(BigInt(n), 2);
  return Buffer.concat([head, payload]);
}

/** Complete the handshake on an upgrade request. Returns null (after answering 400) when it is not a WebSocket request. */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): WsConn | null {
  const key = req.headers["sec-websocket-key"];
  if (req.headers["upgrade"]?.toLowerCase() !== "websocket" || typeof key !== "string" || req.headers["sec-websocket-version"] !== "13") {
    socket.end("HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n");
    return null;
  }
  // Small messages (an input and its answer) must not wait for more data to fill a packet.
  (socket as unknown as { setNoDelay?: (b: boolean) => void }).setNoDelay?.(true);
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`);

  let onMessage: (data: string | Uint8Array, binary: boolean) => void = () => undefined;
  let onClose: () => void = () => undefined;
  let closed = false;
  let buf = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let parts: Buffer[] = [];
  let partsOpcode = 0;
  let partsLen = 0;

  const shut = (code: number): void => {
    if (closed) return;
    closed = true;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code, 0);
    try { socket.end(frame(0x8, body)); } catch { /* already gone */ }
    onClose();
  };

  const drain = (): void => {
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0]!;
      const b1 = buf[1]!;
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) { shut(1009); return; }
        len = Number(big);
        at = 10;
      }
      if (!masked) { shut(1002); return; }
      if (len > MAX_MESSAGE) { shut(1009); return; }
      if (buf.length < at + 4 + len) return;
      const mask = buf.subarray(at, at + 4);
      const payload = Buffer.from(buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
      buf = buf.subarray(at + 4 + len);
      if (opcode === 0x8) { shut(1000); return; }
      if (opcode === 0x9) { socket.write(frame(0xa, payload)); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        if (opcode !== 0x0) { parts = []; partsLen = 0; partsOpcode = opcode; }
        else if (parts.length === 0) { shut(1002); return; }
        parts.push(payload);
        partsLen += payload.length;
        if (partsLen > MAX_MESSAGE) { shut(1009); return; }
        if (fin) {
          const whole = Buffer.concat(parts);
          const binary = partsOpcode === 0x2;
          parts = [];
          partsLen = 0;
          onMessage(binary ? new Uint8Array(whole) : whole.toString("utf8"), binary);
        }
        continue;
      }
      shut(1002);
      return;
    }
  };

  socket.on("data", (d: Buffer) => { buf = buf.length === 0 ? d : Buffer.concat([buf, d]); drain(); });
  socket.on("error", () => shut(1006));
  socket.on("close", () => { if (!closed) { closed = true; onClose(); } });
  if (buf.length > 0) drain();

  return {
    send(data) {
      if (closed) return false;
      const w = socket as Duplex & { writableLength?: number };
      if ((w.writableLength ?? 0) > BACKLOG) return false;
      socket.write(typeof data === "string" ? frame(0x1, Buffer.from(data, "utf8")) : frame(0x2, data));
      return true;
    },
    close: (code = 1000) => shut(code),
    onMessage(f) { onMessage = f; },
    onClose(f) { onClose = f; },
  };
}
