// The hosts of the open Space for the terminal's pickers (rc.8): read when a picker opens the screen and kept; a read that fails leaves the list as it was.
import { useEffect, useState } from "react";
import { loadHosts } from "./hosts.ts";
import type { HostChoice } from "./hosts.ts";
import type { TerminalData } from "./data.ts";

export function useHosts(data: TerminalData): readonly HostChoice[] {
  const [hosts, setHosts] = useState<readonly HostChoice[]>([]);
  useEffect(() => {
    let live = true;
    void loadHosts(data.call, { team: data.team === true, now: data.clock().now, nameOf: data.nameOf ?? ((id) => id) }).then((h) => { if (live) setHosts(h); });
    return () => { live = false; };
  }, [data]);
  return hosts;
}
