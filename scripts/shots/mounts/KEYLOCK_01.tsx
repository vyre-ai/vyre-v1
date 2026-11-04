// Mount for lane l-backup (owner, 4 Nov): the lock that comes back while Vyre is open, after the Space server restarted and lost the person's key. The app stays on screen (here the Vault over the
// Northwind sample): a slim banner says the sign-ins are locked after a restart, with Unlock and a dismiss. ?part=banner is the banner alone; ?part=sheet has pressed Unlock: the small sheet over the
// open screen (password, Unlock, Forgot password).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import { createSampleVault, northwind } from "../../../apps/app/src/places/vault/layout/sample.ts";
import { LockedBanner, SHEET_LINE } from "../../../apps/app/src/shell/session/KeyGate.tsx";
import { VaultUnlockHost } from "../../../apps/app/src/shell/session/VaultUnlockHost.tsx";
import { askVaultUnlock } from "../../../apps/app/src/shell/session/vault-gate.ts";

export const title = "Mid-session lock: banner and sheet";

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "banner"), []);
  const sample = useMemo(() => createSampleVault(northwind), []);
  useEffect(() => {
    if (part !== "sheet") return;
    const t = setTimeout(() => { void askVaultUnlock(async () => undefined, { title: "Unlock your sign-ins", sub: SHEET_LINE, forgot: () => undefined }); }, 300);
    return () => clearTimeout(t);
  }, [part]);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <LockedBanner onUnlock={() => undefined} onDismiss={() => undefined} />
      <View style={{ flex: 1 }}><Vault data={sample.data} /></View>
      <VaultUnlockHost />
    </View>
  );
}
