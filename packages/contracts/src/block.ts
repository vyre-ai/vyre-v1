// Base shape of a persisted native block (ARCH 6.8). The per-type data schemas come from the manifests (generated/blocks.ts).
export interface Block<T = unknown> {
  type: string;
  v: number;
  id: string;
  data: T;
  state?: 'live' | 'done' | 'waiting' | 'error';
  traceId: string;
}
