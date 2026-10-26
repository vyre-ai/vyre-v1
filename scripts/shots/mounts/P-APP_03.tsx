// Mount for P-APP_03: the owner claim screen a fresh install opens from the claim link (ruling 71).
//   /m/P-APP_03?view=details    pick a name, username and password
//   /m/P-APP_03?view=recovery   keep the recovery code
//   /m/P-APP_03?view=used       the link was already used: one plain line, no form
// The query is read after mount (the static export keeps first-render markup), so the first frame is the blank page.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ClaimOwner } from "../../../apps/app/src/claim/ClaimOwner.tsx";

export const title = "Owner claim";

export default function Mount(): ReactNode {
  const [view, setView] = useState<string | null>(null);
  useEffect(() => setView(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("view") ?? "details"), []);
  if (view === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <ClaimOwner
      key={view} space="Northwind" newCode={() => "K7QM-4TXD-9WPA-H3NE"} onClaim={async () => undefined} onSignIn={() => undefined}
      {...(view === "used" ? { dead: "used" as const } : view === "recovery" ? { stage: "recovery" as const } : {})}
    />
  );
}
