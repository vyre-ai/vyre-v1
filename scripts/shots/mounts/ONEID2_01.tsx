// Mount for one Vyre account everywhere (lane l-oneid2, rc.17). ?view=
//   join-form       the invite's account step on a device with no account: "I already have a Vyre account" below the form
//   claim-form      the owner claim form with the same link
//   have-home       I already have a Vyre account: the address of a Space you are in
//   have-password   ... signing in there with the username and password
//   have-code       ... a Space that signs you in with Google: the username and recovery code
//   have-code-error ... a wrong code, said at once
//   have-newpass    ... a password chosen once; the recovery code stays the same
//   sso-known       Continue as, for a person this device knows from a Google sign-in: password or recovery code
//   sso-newpass     ... after the recovery code, a password chosen once
//   link            Settings > Sign-in > Use one account everywhere: keep one, prove both
//   link-done       ... done, in plain words
// The query is read after mount (the static export keeps first-render markup), so the first frame is the blank page.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ClaimOwner } from "../../../apps/app/src/claim/ClaimOwner.tsx";
import { ContinueAs } from "../../../apps/app/src/join/ContinueAs.tsx";
import { HaveAccount } from "../../../apps/app/src/join/HaveAccount.tsx";
import type { HaveAccountDeps } from "../../../apps/app/src/join/HaveAccount.tsx";
import { JoinFlow } from "../../../apps/app/src/join/JoinFlow.tsx";
import { LinkSheet } from "../../../apps/app/src/places/settings/LinkSheet.tsx";

const never = (): Promise<never> => new Promise(() => undefined);
const noop = (): void => undefined;
const deps: HaveAccountDeps = { options: never, signIn: never, recovery: never, checkCode: never };
const northwind = { name: "Northwind", password: true, sso: [], address: "https://northwind.vyre.run" };
const firm = { name: "Freeman Law", password: false, sso: [{ key: "google", title: "Google" }], address: "https://freeman.vyre.run" };
const call = async (): Promise<unknown> => ({});
const sides = [
  { name: "Personal", spaceId: "spc_personal", call, username: "irfad", publicKey: "a2VwdA==" },
  { name: "MLA", spaceId: "spc_mla", call, username: "irfad.mla", publicKey: "b3RoZXI=" },
];

export const title = "One Vyre account everywhere";

export default function Mount(): ReactNode {
  const [view, setView] = useState<string | null>(null);
  useEffect(() => setView(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("view") ?? "have-home"), []);
  if (view === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (view === "join-form") return <JoinFlow invite={{ space: "Beacon", host: "beacon", by: "Maya Chen", role: "Member", sso: [], github: false, adminKey: false, deviceName: "Dana's Mac" }} initial={{ stage: "steps", step: 1, first: "Dana", last: "Wills" }} onHaveAccount={noop} />;
  if (view === "claim-form") return <ClaimOwner space="Beacon" newCode={() => "K7QM-4TXD-9WPA-H3NE"} onClaim={async () => undefined} onHaveAccount={noop} fingerprint="9f3c 1a2b 77de 0c41" />;
  if (view.startsWith("have-")) {
    const initial = view === "have-home" ? { stage: "home" as const }
      : view === "have-password" ? { stage: "password" as const, home: northwind, username: "dana" }
        : view === "have-newpass" ? { stage: "newpass" as const, home: firm, username: "rubab" }
          : { stage: "code" as const, home: firm, username: "rubab", ...(view === "have-code-error" ? { error: "Check the username and recovery code." } : {}) };
    return <HaveAccount key={view} prefix="join-have" space="Beacon" working="Joining Beacon" deps={deps} onProof={never} onBack={noop} initial={initial} />;
  }
  if (view === "sso-known" || view === "sso-newpass") {
    return <ContinueAs key={view} prefix="join-as" space="Beacon" username="Rubab Shah" sub="Your Vyre password (the one you set when you joined), or your recovery code, to join Beacon" working="Joining Beacon" onContinue={never} onOther={noop} onBack={noop}
      either={{ onCheckCode: never, onRecovery: never }} {...(view === "sso-newpass" ? { initialStage: "newpass" as const } : {})} />;
  }
  return (
    <View style={{ flex: 1, minHeight: 640, backgroundColor: "var(--win)" as string }}>
      <LinkSheet key={view} spaces={[]} device={{ deviceName: "Mac", deviceClass: "desktop" }} onSession={noop} onClose={noop} initial={{ sides, keep: "spc_personal", ...(view === "link-done" ? { done: true } : {}) }} />
    </View>
  );
}
