// "I already have a Vyre account" (rc.17): owning or joining a Space on a device that has no session for the account. The person names a Space they are already in, and proves the account
// there: its username and password (and the authenticator code when that Space asks), or, when that Space signs people in with Google or Microsoft, or the password is gone, their recovery code
// and a password chosen now. Their bundle comes back as ciphertext and opens here; the same person key, recovery code and key pair go to the new Space. Nothing new is created.
import { useState } from "react";
import type { ReactElement } from "react";
import { Bar, Button, ErrorLine, Field, Foot, Group, JoinFrame, Links, Panel, Step, TextButton, Title, Working } from "./kit.tsx";
import { CarryError, isRecoveryCode } from "./identity.ts";
import type { HomeAccount, HomeOptions, Proof } from "./identity.ts";
import type { RecoveryBundle } from "../../../../client/src/crypto/keys.ts";
import { PASSWORD_MIN } from "./logic.ts";

export interface HaveAccountDeps {
  options(address: string): Promise<HomeOptions & { address: string }>;
  signIn(address: string, username: string, password: string, totp?: string): Promise<HomeAccount | "second_factor">;
  recovery(address: string, username: string): Promise<RecoveryBundle>;
  /** throws a CarryError("code") for a code that does not open the bundle */
  checkCode(code: string, bundle: RecoveryBundle): Promise<void>;
}

export type HaveStage = "home" | "password" | "code" | "newpass";
export interface HaveAccountProps {
  /** testID prefix: join-have or claim-have */
  prefix: string;
  /** the Space being joined or set up */
  space: string | null;
  /** the title while it works, e.g. "Joining Northwind" */
  working: string;
  deps: HaveAccountDeps;
  /** Owns or joins with the proved account. Rejects with an error whose `line` (or message) is shown. */
  onProof(proof: Proof): Promise<void>;
  onBack(): void;
  /** screenshots and tests: open on a stage with what it shows */
  initial?: { stage: HaveStage; home?: HomeOptions & { address: string }; username?: string; error?: string };
}

const lineOf = (e: unknown): string => (e as { line?: string } | null)?.line ?? ((e instanceof Error && e.message) || "Couldn't finish. Try again.");

export function HaveAccount({ prefix, space, working, deps, onProof, onBack, initial }: HaveAccountProps): ReactElement {
  const [stage, setStage] = useState<HaveStage>(initial?.stage ?? "home");
  const [address, setAddress] = useState(initial?.home?.address ?? "");
  const [home, setHome] = useState<(HomeOptions & { address: string }) | null>(initial?.home ?? null);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [secret, setSecret] = useState("");
  const [totp, setTotp] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [bundle, setBundle] = useState<RecoveryBundle | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(initial?.error ?? "");
  const at = home?.name ?? "your Space";
  const run = async (title: string, work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(title); setError("");
    try { await work(); } catch (e) { setError(lineOf(e)); } finally { setBusy(null); }
  };
  if (busy) return <JoinFrame><Panel wait><Step id={`${prefix}-run`}><Working testID={`${prefix}-working`} title={busy} {...(home ? { line: `Using your account from ${at}` } : {})} /></Step></Panel></JoinFrame>;

  const finish = (proof: Proof): Promise<void> => run(working, () => onProof(proof));
  const go = (): void => {
    if (stage === "home") {
      void run("Finding your Space", async () => {
        const found = await deps.options(address);
        setHome(found);
        setStage(found.password ? "password" : "code");
      });
    } else if (stage === "password" && home) {
      void run(`Signing in to ${at}`, async () => {
        const got = await deps.signIn(home.address, username, secret, totp ?? undefined);
        if (got === "second_factor") { setTotp(""); return; }
        setBusy(working);
        await onProof({ kind: "password", username: got.username, name: got.name, password: secret, bundle: got.bundle });
      });
    } else if (stage === "code" && home) {
      void run("Checking your recovery code", async () => {
        const found = await deps.recovery(home.address, username);
        try { await deps.checkCode(code, found); } catch (e) { if (e instanceof CarryError) throw new CarryError("code", "Check the username and recovery code."); throw e; }
        setBundle(found);
        setStage("newpass");
      });
    } else if (stage === "newpass" && bundle) {
      void finish({ kind: "code", username: username.trim().toLowerCase(), name: username.trim().toLowerCase(), code, newPassword: pw, bundle });
    }
  };
  const back = (): void => {
    setError("");
    if (stage === "home") onBack();
    else if (stage === "newpass") { setStage("code"); setPw(""); setPw2(""); }
    else if (stage === "code" && home?.password) setStage("password");
    else { setStage("home"); setTotp(null); setSecret(""); setCode(""); }
  };
  const ready = stage === "home" ? !!address.trim()
    : stage === "password" ? !!username.trim() && !!secret && (totp === null || /^\d{6}$/.test(totp))
      : stage === "code" ? !!username.trim() && isRecoveryCode(code)
        : pw.length >= PASSWORD_MIN && pw === pw2;
  const short = !!pw && pw.length < PASSWORD_MIN, mism = !!pw2 && pw2 !== pw;
  const shownError = stage === "newpass" ? (short ? "Use at least 8 characters." : mism ? "The passwords do not match." : error) : error;
  const sso = home?.sso?.[0]?.title;
  const below = stage === "password"
    ? <Links><TextButton testID={`${prefix}-use-code`} label="Use your recovery code" onPress={() => { setError(""); setStage("code"); }} /></Links>
    : undefined;
  return (
    <JoinFrame>
      <Panel {...(space ? { space } : {})} bar={<Bar onBack={back} cont={<Button testID={`${prefix}-next`} label="Continue" disabled={!ready} onPress={go} />} />} {...(below ? { below } : {})}>
        {stage === "home" ? (
          <Step id={`${prefix}-home`}>
            <Title title="Use your Vyre account" sub="Enter the address of a Space you are already in" />
            <Group>
              <Field testID={`${prefix}-address`} label="Space address" value={address} onChange={(v) => { setAddress(v); setError(""); }} placeholder="northwind.vyre.run" autoComplete="url" autoFocus onSubmit={() => { if (ready) go(); }} />
            </Group>
            <ErrorLine testID={`${prefix}-error`}>{shownError}</ErrorLine>
            <Foot testID={`${prefix}-note`} top={4}>{space ? `Your account comes to ${space} with the same password and recovery code.` : "Your account comes here with the same password and recovery code."}</Foot>
          </Step>
        ) : stage === "password" ? (
          <Step id={`${prefix}-password`}>
            <Title title={`Sign in to ${at}`} sub="With your Vyre account" />
            <Group>
              <Field testID={`${prefix}-username`} label="Username" value={username} onChange={(v) => { setUsername(v); setError(""); }} placeholder="name" autoComplete="username" autoFocus onSubmit={() => { if (ready) go(); }} />
              <Field testID={`${prefix}-password-field`} label="Password" value={secret} onChange={(v) => { setSecret(v); setError(""); }} placeholder="Your Vyre password" secure autoComplete="current-password" visibilityTestID={`${prefix}-password-toggle`} onSubmit={() => { if (ready) go(); }} />
              {totp !== null ? <Field testID={`${prefix}-totp`} label="Authenticator code" value={totp} onChange={(v) => setTotp(v.replace(/\D/g, "").slice(0, 6))} placeholder="123456" keyboard="numeric" autoComplete="one-time-code" autoFocus onSubmit={() => { if (ready) go(); }} /> : null}
            </Group>
            <ErrorLine testID={`${prefix}-error`}>{shownError}</ErrorLine>
          </Step>
        ) : stage === "code" ? (
          <Step id={`${prefix}-code`}>
            <Title title={`Your account in ${at}`} sub={home?.password ? "Use your recovery code instead of your password" : `${at} signs you in with ${sso ?? "your work account"}. Your recovery code brings your account here.`} />
            <Group>
              <Field testID={`${prefix}-username`} label="Username" value={username} onChange={(v) => { setUsername(v); setError(""); }} placeholder="name" autoComplete="username" autoFocus onSubmit={() => { if (ready) go(); }} />
              <Field testID={`${prefix}-code-field`} label="Recovery code" value={code} onChange={(v) => { setCode(v.toUpperCase()); setError(""); }} placeholder="XXXX-XXXX-XXXX-XXXX" mono autoComplete="off" onSubmit={() => { if (ready) go(); }} />
            </Group>
            <ErrorLine testID={`${prefix}-error`}>{shownError}</ErrorLine>
          </Step>
        ) : (
          <Step id={`${prefix}-newpass`}>
            <Title title="Choose your Vyre password" sub={space ? `You sign in to ${space} with it. Your recovery code stays the same.` : "You sign in here with it. Your recovery code stays the same."} />
            <Group>
              <Field testID={`${prefix}-new-password`} label="Password" value={pw} onChange={setPw} placeholder="At least 8 characters" secure autoComplete="new-password" autoFocus visibilityTestID={`${prefix}-new-toggle`} onSubmit={() => { if (ready) go(); }} />
              <Field testID={`${prefix}-confirm`} label="Confirm" value={pw2} onChange={setPw2} secure autoComplete="new-password" error={mism} onSubmit={() => { if (ready) go(); }} />
            </Group>
            <ErrorLine testID={`${prefix}-error`}>{shownError}</ErrorLine>
          </Step>
        )}
      </Panel>
    </JoinFrame>
  );
}
