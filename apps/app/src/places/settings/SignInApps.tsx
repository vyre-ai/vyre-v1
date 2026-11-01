// Settings > Connections: the OAuth app a Space needs before people can sign in to their own Gmail or Outlook. One guided panel per provider: the steps at Google or Microsoft, the exact redirect
// address to register, and the client id and secret, which go straight into a Vault item in a Shared folder named Apps (so a poll with the vault locked can still read them). In a Team Space an
// admin does this once; in a Personal Space the person is the admin.
import { Fragment, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Linking } from "react-native";
import { attemptKey } from "../../shell/providers/files-review.ts";
import { useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { Field, Glyph, Section, SettingsRow, SmallButton } from "./ui.tsx";

interface Guide { key: "google" | "microsoft"; label: string; prefix: string; item: string; steps: readonly { text: string; link?: string }[]; idLabel: string; tenant: boolean }

const GUIDES: readonly Guide[] = [
  {
    key: "google", label: "Google sign-in", prefix: "google.user", item: "Google_Sign_In", idLabel: "Client id", tenant: false,
    steps: [
      { text: "Open Credentials in Google Cloud and make an OAuth client of type Web application.", link: "https://console.cloud.google.com/apis/credentials" },
      { text: "Add the redirect address below to it." },
      { text: "Turn on the Gmail API for the project.", link: "https://console.cloud.google.com/apis/library/gmail.googleapis.com" },
      { text: "Publish the consent screen (Testing signs people out after 7 days)." },
    ],
  },
  {
    key: "microsoft", label: "Microsoft sign-in", prefix: "ms.user", item: "Microsoft_Sign_In", idLabel: "Application id", tenant: true,
    steps: [
      { text: "Open App registrations in Microsoft Entra and add a registration for any account type.", link: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" },
      { text: "Add the redirect address below as a Web redirect." },
      { text: "Under Certificates and secrets make a client secret." },
    ],
  },
];

interface Status { configured: boolean; clientId?: string; vaultItem?: string; redirectUri?: string }
type Call = (cap: string, input: unknown) => Promise<unknown>;

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The Shared folder the app items live in, made once. */
async function appsFolder(call: Call): Promise<string> {
  const list = rec(await call("vault.folders.list", { scope: "shared" }));
  const have = (Array.isArray(list["folders"]) ? list["folders"] : []).map(rec).find((f) => f["name"] === "Apps");
  if (have && typeof have["id"] === "string") return have["id"];
  const made = rec(rec(await call("vault.folders.create", { name: "Apps", scope: "shared", idempotencyKey: attemptKey() }))["folder"]);
  return String(made["id"]);
}

/** The client goes into the Vault as a named item; a name already taken gets the next number. Returns the handle the module reads it by. */
async function fileApp(call: Call, g: Guide, id: string, secret: string, tenant: string): Promise<string> {
  const folderId = await appsFolder(call);
  const fields = [{ key: "client_id", value: id, secret: false }, { key: "client_secret", value: secret, secret: true }, ...(tenant ? [{ key: "tenant", value: tenant, secret: false }] : [])];
  for (let n = 1; n <= 9; n++) {
    const name = n === 1 ? g.item : `${g.item}_${n}`;
    try {
      const out = rec(rec(await call("vault.item.put", { folderId, name, kind: "other", fields, idempotencyKey: attemptKey() }))["item"]);
      return typeof out["handle"] === "string" ? out["handle"] : `#${name}`;
    } catch (e) {
      const code = (e as { code?: string; error?: { code?: string } }).code ?? (e as { error?: { code?: string } }).error?.code;
      if (code !== "validation.duplicate") throw e;
    }
  }
  throw new Error("Too many Vault items with that name.");
}

export function SignInApps(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const [status, setStatus] = useState<Record<string, Status | null>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ id: "", secret: "", tenant: "" });
  const [busy, setBusy] = useState(false);
  const load = (): void => {
    for (const g of GUIDES) data.call(`${g.prefix}.app_status`, {}).then((out) => setStatus((st) => ({ ...st, [g.key]: out as Status })), () => setStatus((st) => ({ ...st, [g.key]: null })));
  };
  useEffect(() => { load(); }, [data]);
  const save = async (g: Guide): Promise<void> => {
    setBusy(true);
    try {
      const handle = await fileApp(data.call, g, form.id.trim(), form.secret.trim(), form.tenant.trim());
      await data.call(`${g.prefix}.app_set`, { vaultItem: handle });
      setOpen(null); setForm({ id: "", secret: "", tenant: "" }); load(); saved.saved("Sign-in app set");
    } catch (e) { saved.failed(e instanceof Error && e.message ? e.message : "That app could not be saved."); }
    setBusy(false);
  };
  const copy = (text: string): void => { try { void navigator.clipboard?.writeText(text); } catch { /* the address stays on screen to copy by hand */ } };
  const shown = GUIDES.filter((g) => status[g.key] !== null);   // a provider this server does not have is not listed
  if (shown.length === 0) return <></>;
  const sections: ReactElement[] = [];
  shown.forEach((g, i) => {
    const st = status[g.key];
    const editing = open === g.key;
    const steps: ReactElement[] = [];
    g.steps.forEach((step, n) => steps.push(
      <SettingsRow
        key={n} id={`signin.${g.key}.step${n + 1}`} label={`${n + 1}. ${step.text}`} indent
        {...(step.link ? { onPress: () => void Linking.openURL(step.link!), control: <Glyph name="chevR" size={13} /> } : {})}
      />,
    ));
    sections.push(
      <Fragment key={g.key}>
        <SettingsRow
          id={`signin.${g.key}`} label={g.label} first={i === 0} lead={<Glyph name="key" size={15} />}
          sub={st?.configured ? `Client ${st.clientId ?? ""} from ${st.vaultItem ?? "the Vault"}` : "Not set up"}
          help="People sign in to their own mailbox with an OAuth app. Make one once and the Space keeps it in the Vault."
          control={<SmallButton label={st?.configured ? "Change" : "Set up"} onPress={() => setOpen(editing ? null : g.key)} testID={`signin-${g.key}`} />}
        />
        {editing ? (
          <>
            {steps}
            <SettingsRow
              id={`signin.${g.key}.redirect`} label="Redirect address" indent
              sub={st?.redirectUri ?? "This server has no public address yet"}
              control={st?.redirectUri ? <SmallButton label="Copy" onPress={() => copy(st.redirectUri!)} testID={`signin-${g.key}-copy`} /> : undefined}
            />
            <SettingsRow id={`signin.${g.key}.id`} label={g.idLabel} indent control={<Field value={form.id} label={`${g.label} ${g.idLabel}`} mono width={260} testID={`signin-${g.key}-id`} onCommit={(v) => setForm((f) => ({ ...f, id: v }))} />} />
            <SettingsRow id={`signin.${g.key}.secret`} label="Client secret" indent control={<Field value={form.secret} label={`${g.label} client secret`} mono secureTextEntry width={260} testID={`signin-${g.key}-secret`} onCommit={(v) => setForm((f) => ({ ...f, secret: v }))} />} />
            {g.tenant ? <SettingsRow id={`signin.${g.key}.tenant`} label="Tenant (only for a work-only app)" indent control={<Field value={form.tenant} label={`${g.label} tenant`} mono width={260} testID={`signin-${g.key}-tenant`} onCommit={(v) => setForm((f) => ({ ...f, tenant: v }))} />} /> : null}
            <SettingsRow
              id={`signin.${g.key}.save`} label="Save in the Vault" sub={`Filed as ${g.item} in the shared Apps folder`} indent
              control={<SmallButton label={busy ? "Saving" : "Save"} primary disabled={busy || form.id.trim() === "" || form.secret.trim() === ""} onPress={() => void save(g)} testID={`signin-${g.key}-save`} />}
            />
          </>
        ) : null}
      </Fragment>,
    );
  });
  return <Section title="Sign in with your own account">{sections}</Section>;
}
