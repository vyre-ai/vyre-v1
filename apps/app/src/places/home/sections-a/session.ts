import type { FakeReplica, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { Face } from "./faces.ts";

export interface HomeCall {
  cap: string;
  input: Record<string, unknown>;
}

export interface HomeSession {
  spaceId: string;
  replica: FakeReplica;
  hooks: ScreenHooks;
  faces: readonly Face[];
  online: boolean;
  calls: HomeCall[];
}
