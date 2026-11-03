// isRelayAddress for a screen: the name rule at first paint, then what the address answers. A browser page on a direct vyre.run Space (mla.vyre.run) asks its own origin, so its
// "Open in Vyre" appears once the Space has answered; on a relay phone address it never does.
import { useEffect, useState } from "react";
import { isPhoneAddress, isRelayAddress } from "./entry.ts";

export function useRelayAddress(address: string | null | undefined, active = true): boolean {
  const named = !!address && isPhoneAddress(address);
  const [relay, setRelay] = useState(named);
  useEffect(() => {
    setRelay(named);
    if (!active || !named || !address) return undefined;
    let live = true;
    void isRelayAddress(address).then((r) => { if (live) setRelay(r); });
    return () => { live = false; };
  }, [address, active, named]);
  return relay;
}
