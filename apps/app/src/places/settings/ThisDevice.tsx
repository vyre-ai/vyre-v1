// Settings > This device: my own computers and servers (the shared Machines component in its own scope: full detail, my limits, Drain, pins, and the one Add a server), then what is only about this
// device: Phone access, the Windows sandbox and importing Claude Code sessions. In a Personal Space the servers that joined through the relay are listed first.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { MachinesView } from "../../machines/MachinesView.tsx";
import { setComputersAvailable, takeAddServerRequest } from "../../shell/computers-available.ts";
import { useIsPersonal, useSettingsData } from "./data.tsx";
import { PeersSection } from "./Peers.tsx";
import { PhoneAccessSection } from "./PhoneAccess.tsx";
import { WindowsSandboxRow } from "./WindowsSandbox.tsx";
import { SessionImport } from "./SessionImport.tsx";
import { Section } from "./ui.tsx";

export function ThisDevicePage(): ReactElement {
  const data = useSettingsData();
  const personal = useIsPersonal();
  // asked for from the Space menu or an agent's page: the sheet is open as the page draws, once
  const [startAdd] = useState(() => takeAddServerRequest());
  // agent computers appear elsewhere the moment a host can run one, and go when none can
  useEffect(() => {
    let live = true;
    void (data.call("computers.hosts", {}) as Promise<{ available?: boolean }>).then((h) => { if (live) setComputersAvailable(data.space.id, h.available === true); }, () => undefined);
    return () => { live = false; };
  }, [data]);
  return (
    <>
      {personal ? <PeersSection /> : null}
      <MachinesView call={data.call as never} scope="mine" who={(id) => data.name(id)} personal={personal} {...(startAdd ? { startAdd } : {})} />
      <WindowsSandboxRow />
      <PhoneAccessSection />
      <SessionImport />
    </>
  );
}
