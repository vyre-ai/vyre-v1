// Settings > Connections: the OAuth app a Space needs before people can sign in to their own Gmail or Outlook. The app lives in a Vault item (client_id, client_secret); this section only
// names that item and shows the exact redirect address to register at Google or Microsoft. Nothing secret is typed here.
import { Fragment, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { Field, Glyph, Section, SettingsRow, SmallButton, Value } from "./ui.tsx";

const APPS = [
  { key: "google", label: "Google sign-in", prefix: "google.user", item: "#Google_Sign_In", where: "Google Cloud, Credentials, OAuth client (web)" },
  { key: "microsoft", label: "Microsoft sign-in", prefix: "ms.user", item: "#Microsoft_Sign_In", where: "Entra, App registrations, Web redirect" },
] as const;

interface Status { configured: boolean; clientId?: string; vaultItem?: string; redirectUri?: string }

export function SignInApps(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const [status, setStatus] = useState<Record<string, Status | null>>({});
  const [open, setOpen] = useState<string | null>(null);
  const load = (): void => {
    for (const a of APPS) data.call(`${a.prefix}.app_status`, {}).then((out) => setStatus((st) => ({ ...st, [a.key]: out as Status })), () => setStatus((st) => ({ ...st, [a.key]: null })));
  };
  useEffect(() => { load(); }, [data]);
  const use = (prefix: string, vaultItem: string): void => {
    const handle = vaultItem.trim().startsWith("#") ? vaultItem.trim() : `#${vaultItem.trim()}`;
    void data.call(`${prefix}.app_set`, { vaultItem: handle }).then(
      () => { setOpen(null); load(); saved.saved("Sign-in app set"); },
      (e: unknown) => saved.failed(e instanceof Error && e.message ? e.message : "That item could not be used."),
    );
  };
  const shown = APPS.filter((a) => status[a.key] !== null);   // a provider this server does not have is not listed
  if (shown.length === 0) return <></>;
  return (
    <Section title="Sign in with your own account">
      {shown.map((a, i) => {
        const st = status[a.key];
        const editing = open === a.key;
        return (
          <Fragment key={a.key}>
            <SettingsRow
              id={`signin.${a.key}`} label={a.label} first={i === 0} lead={<Glyph name="key" size={15} />}
              sub={st?.configured ? `Client ${st.clientId ?? ""} from ${st.vaultItem ?? "the Vault"}` : "Not set up"}
              help={`Add a Vault item ${a.item} with client_id and client_secret, create the OAuth client in ${a.where}, and register the redirect address below.`}
              control={<SmallButton label={st?.configured ? "Change" : "Set up"} onPress={() => setOpen(editing ? null : a.key)} testID={`signin-${a.key}`} />}
            />
            {editing ? (
              <>
                <SettingsRow id={`signin.${a.key}.redirect`} label="Redirect address" indent control={<Value text={st?.redirectUri ?? "This server has no public address yet"} testID={`signin-${a.key}-redirect`} />} />
                <SettingsRow
                  id={`signin.${a.key}.item`} label="Vault item" indent
                  control={<Field value={st?.vaultItem ?? ""} label={`${a.label} Vault item`} placeholder={a.item} mono width={220} testID={`signin-${a.key}-item`} onCommit={(v) => use(a.prefix, v)} />}
                />
              </>
            ) : null}
          </Fragment>
        );
      })}
    </Section>
  );
}

