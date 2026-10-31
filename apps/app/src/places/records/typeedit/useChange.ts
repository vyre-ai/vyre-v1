// The state of one schema change in a sheet: ask what it does (schema.diff), apply it at once when it destroys nothing, or hold it for one confirm line when it does.
import { useCallback, useRef, useState } from "react";
import { commitChange, stageChange } from "./model.ts";
import type { Call, SchemaOp, Staged } from "./model.ts";

export interface SchemaChange {
  busy: boolean;
  error: string | null;
  /** A destructive change waiting for the person's yes. */
  staged: Staged | null;
  /** Preview then apply; a destructive change stops at `staged`. Resolves true once applied. */
  run(ops: readonly SchemaOp[]): Promise<boolean>;
  /** Apply the held change. */
  confirm(): Promise<boolean>;
  cancel(): void;
  clearError(): void;
}

export function useSchemaChange(call: Call, onApplied?: () => void): SchemaChange {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const live = useRef(true);
  const commit = useCallback(async (s: Staged): Promise<boolean> => {
    const out = await commitChange(call, s);
    if (!live.current) return out.ok;
    setBusy(false);
    if (out.ok) { setStaged(null); onApplied?.(); return true; }
    setError(out.error);
    return false;
  }, [call, onApplied]);
  const run = useCallback(async (ops: readonly SchemaOp[]): Promise<boolean> => {
    setBusy(true); setError(null); setStaged(null);
    const out = await stageChange(call, ops);
    if (!out.ok) { setBusy(false); setError(out.error); return false; }
    if (out.staged.destructive) { setBusy(false); setStaged(out.staged); return false; }
    return commit(out.staged);
  }, [call, commit]);
  const confirm = useCallback(async (): Promise<boolean> => {
    if (staged === null) return false;
    setBusy(true); setError(null);
    return commit(staged);
  }, [staged, commit]);
  return { busy, error, staged, run, confirm, cancel: () => { setStaged(null); setError(null); }, clearError: () => setError(null) };
}
