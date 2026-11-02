// Mount for P-APP_03: the owner claim screen a fresh install opens from the claim link (ruling 71).
//   /m/P-APP_03?view=details    pick a name, username and password
//   /m/P-APP_03?view=recovery   keep the recovery code
//   /m/P-APP_03?view=used       the link was already used: one plain line, no form
//   /m/P-APP_03?view=known      rc.14: this device has an account, so the claim is "Continue as" and asks only for the password
//   /m/P-APP_03?view=known-error   the same, after a wrong password
//   /m/P-APP_03?view=open-app   a claim link in a desktop browser: today's form with Open in Vyre
//   /m/P-APP_03?view=join-known an invite opened in the app that has an account: "Continue as" for the join
//   /m/P-APP_03?view=rotate     Settings, Make a new recovery code: the password
//   /m/P-APP_03?view=rotate-code   the new code, shown once
// The query is read after mount (the static export keeps first-render markup), so the first frame is the blank page.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ClaimOwner } from "../../../apps/app/src/claim/ClaimOwner.tsx";
import { ContinueAs } from "../../../apps/app/src/join/ContinueAs.tsx";
import { SecuritySheet } from "../../../apps/app/src/places/settings/SecuritySheet.tsx";

const never = (): Promise<void> => new Promise(() => undefined);
const noop = (): void => undefined;

export const title = "Owner claim";

export default function Mount(): ReactNode {
  const [view, setView] = useState<string | null>(null);
  useEffect(() => setView(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("view") ?? "details"), []);
  if (view === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (view === "join-known") return <ContinueAs prefix="join-as" space="Northwind" username="dana" sub="Enter your Vyre password to join Northwind" working="Joining Northwind" onContinue={never} onOther={noop} onBack={noop} />;
  if (view === "known-error") return <ContinueAs prefix="claim-as" space="Northwind" username="dana" sub="Enter your Vyre password to set up Northwind" working="Setting up Northwind" onContinue={never} onOther={noop} initialError="That password is not right." />;
  if (view === "rotate" || view === "rotate-code") {
    return (
      <View style={{ flex: 1, minHeight: 640, backgroundColor: "var(--win)" as string }}>
        <SecuritySheet action="recovery" call={async () => ({})} onClose={noop} spaceName="Personal" newCode={() => "Q2WE-R3TY-U4PA-S5DF"} {...(view === "rotate-code" ? { initialCode: { code: "Q2WE-R3TY-U4PA-S5DF", updated: ["Personal", "Northwind"], missed: [] } } : {})} />
      </View>
    );
  }
  return (
    <ClaimOwner
      key={view} space="Northwind" newCode={() => "K7QM-4TXD-9WPA-H3NE"} onClaim={async () => undefined} onSignIn={() => undefined}
      {...(view === "used" ? { dead: "used" as const } : view === "recovery" ? { stage: "recovery" as const } : {})}
      {...(view === "known" ? { known: { username: "dana", name: "Dana Wills" }, onClaimAs: never } : {})}
      {...(view === "open-app" ? { onOpenApp: noop, fingerprint: "9f3c 1a2b 77de 0c41" } : {})}
    />
  );
}
