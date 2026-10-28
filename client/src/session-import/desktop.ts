import type { Invoke } from "../connection/desktop-link.ts";
import { parseSession, parseSessionDocuments } from "./parse.ts";
import type { SessionDocument, SessionPayload, SessionSource } from "./parse.ts";
export interface SessionImporter { discover(): Promise<SessionSource[]>; preview(source: SessionSource): Promise<SessionPayload> }
export function desktopSessionImporter(g: { __TAURI__?: { core?: { invoke?: Invoke } } } = globalThis as never): SessionImporter | undefined {
  const invoke = g.__TAURI__?.core?.invoke;
  if (!invoke) return undefined;
  return {
    async discover() { return await invoke("discover_session_sources") as SessionSource[]; },
    async preview(source) {
      const got = await invoke("read_session_source", { sessionKey: source.sessionKey }) as { source: SessionSource; documents?: SessionDocument[]; text?: string };
      return got.documents ? parseSessionDocuments(got.source, got.documents) : parseSession(got.source, got.text ?? "");
    },
  };
}
