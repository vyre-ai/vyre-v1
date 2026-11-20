// What each Automation is missing before it can be turned on, read once for the list and again when the list changes or something is connected in place (rc.41). One read for the left list and the first
// page; a read that fails says nothing (no row is marked) rather than guessing.
import { useEffect, useState } from "react";
import { useConnectVersion } from "../../../shell/connect/context.ts";
import { useAutomationsData } from "../canvas/data.tsx";
import { blockedById } from "./model.ts";
import type { Blocked } from "./model.ts";

const NONE: ReadonlyMap<string, Blocked> = new Map();
// the left list and the first page are on screen together and ask the same thing: the newest answer is kept by what it was asked for, so they share one read
let kept: { key: string; call: unknown; answer: Promise<ReadonlyMap<string, Blocked>> } | null = null;

/** `signature` changes when the list does (ids, versions, states): the read runs again then. */
export function useReadiness(signature: string): ReadonlyMap<string, Blocked> {
  const data = useAutomationsData();
  const connected = useConnectVersion();
  const [by, setBy] = useState<ReadonlyMap<string, Blocked>>(NONE);
  useEffect(() => {
    if (signature === "") {
      setBy(NONE);
      return undefined;
    }
    let live = true;
    const key = `${signature}#${connected}`;
    if (!kept || kept.key !== key || kept.call !== data.call)
      kept = {
        key,
        call: data.call,
        answer: data.call("automations.readiness", {}).then(
          (out) => blockedById((out as { blocked?: Blocked[] } | null)?.blocked ?? []),
          () => NONE,
        ),
      };
    void kept.answer.then((m) => live && setBy(m));
    return () => {
      live = false;
    };
  }, [data, signature, connected]);
  return by;
}

/** The signature of a list for the hook above. */
export const readinessKey = (
  rows: readonly { id: string; version: number; status: string; updatedAt: number }[],
): string => rows.map((a) => `${a.id}:${a.version}:${a.status}:${a.updatedAt}`).join("|");
