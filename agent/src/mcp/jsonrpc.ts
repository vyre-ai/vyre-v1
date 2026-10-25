// JSON-RPC 2.0 as MCP uses it.
export type Id = string | number | null;
export interface Request { jsonrpc: "2.0"; id?: Id; method: string; params?: unknown }
export interface Success { jsonrpc: "2.0"; id: Id; result: unknown }
export interface Failure { jsonrpc: "2.0"; id: Id; error: { code: number; message: string; data?: unknown } }
export type Response = Success | Failure;

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export const ok = (id: Id, result: unknown): Success => ({ jsonrpc: "2.0", id, result });
export const err = (id: Id, code: number, message: string, data?: unknown): Failure => ({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });

export function isRequest(v: unknown): v is Request {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o["jsonrpc"] !== "2.0" || typeof o["method"] !== "string") return false;
  const id = o["id"];
  return id === undefined || id === null || typeof id === "string" || typeof id === "number";
}
