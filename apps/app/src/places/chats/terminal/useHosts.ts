// The hosts of the open Space for the terminal's pickers (rc.8): read when a picker opens the screen and kept; a read that fails leaves the list as it was.
import { useEffect, useState } from "react";
import { loadHosts } from "./hosts.ts";
import type { HostChoice } from "./hosts.ts";
import type { TerminalData } from "./data.ts";

/** The hosts of the Space; null until they are read, so a picker never offers a host it has not found. */
export function useHostsRead(data: TerminalData): readonly HostChoice[] | null {
  const [hosts, setHosts] = useState<readonly HostChoice[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadHosts(data.call, { team: data.team === true, now: data.clock().now, nameOf: data.nameOf ?? ((id) => id) }).then((h) => { if (live) setHosts(h); });
    return () => { live = false; };
  }, [data]);
  return hosts;
}

export function useHosts(data: TerminalData): readonly HostChoice[] {
  return useHostsRead(data) ?? [];
}

/** What the New menu says when no host is listed: still reading, or nowhere a terminal can open from this device. */
export const NO_HOST = "Open Vyre on a computer to use a terminal here";
