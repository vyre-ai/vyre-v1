import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useAppsData } from "./data.tsx";
import { actionKey, errorMessage, mutate } from "./mutations.ts";
import { Button, Card, Field, Frame, Select, s, useOnline, useRead } from "./editor-ui.tsx";
import type { AppsRoute } from "./routes.ts";
export function DomainEditor({ route, back }: { route: AppsRoute; back(): void }): ReactElement {
  const d = useAppsData(), online = useOnline();
  const domain = useRead<CapMap["mail.domain.get"]["out"]>(route.id ? "mail.domain.get" : null, { domainId: route.id }, "domains");
  const [name, setName] = useState(""), [provider, setProvider] = useState("resend");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [key, setKey] = useState(actionKey), [confirm, setConfirm] = useState(false);
  const run = async (cap: string): Promise<void> => { setBusy(true); setError(null); try {
    const out = await mutate(d, cap, route.id ? { domainId: route.id } : { name: name.trim(), provider }, key);
    if (out.status === "held") { d.nav.openTask(out.taskId); return; }
    if (!route.id) d.nav.open("domains", out.domain.id);
    else { setNotice(cap === "mail.domain.check" ? "Checked the DNS records." : "Updated the default sending domain."); domain.refresh(); }
    setKey(actionKey()); setConfirm(false);
  } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  return <Frame testID={route.id ? "apps-domain-detail" : "apps-create-domain"} title={route.id ? domain.data?.domain.name ?? "Sending domain" : "Add sending domain"} back={back} offline={!online} error={error ?? domain.error} loading={domain.loading} retry={domain.refresh}>
    {!route.id ? <Card title="Send from your domain"><Field label="Domain name" value={name} onChange={(v) => { setName(v); setConfirm(false); }} placeholder="mail.example.com" disabled={busy} /><Select label="Delivery provider" value={provider} options={[{ key: "resend", title: "Resend" }, { key: "mailgun", title: "Mailgun" }]} onChange={(v) => { setProvider(v); setConfirm(false); }} disabled={busy} />
      <Text style={s.text}>The Space needs this provider connected in Vault. Adding the domain asks the provider for the DNS records you must publish.</Text>
      {confirm ? <><Text style={s.text}>{`Add ${name} with ${provider}?`}</Text><View style={s.actions}><Button title="Cancel" onPress={() => setConfirm(false)} /><Button title="Confirm add domain" testID="apps-confirm-domain" disabled={busy || !online} primary onPress={() => void run("mail.domain.add")} /></View></> : <Button title="Review domain" disabled={busy || !online || !name.trim()} onPress={() => setConfirm(true)} />}
    </Card> : domain.data ? <>
      <Card title="Verification"><Text style={s.text}>{`${domain.data.domain.provider} · ${domain.data.domain.verified ? "Verified" : "Needs verification"}${domain.data.domain.isDefault ? " · Default sender" : ""}`}</Text>
        <Row title="SPF" note={domain.data.domain.spf} /><Row title="DKIM" note={domain.data.domain.dkim} /><Row title="DMARC" note={domain.data.domain.dmarc} />
        <View style={s.actions}><Button title="Check DNS records" disabled={busy || !online} testID="apps-check-domain" onPress={() => void run("mail.domain.check")} />{domain.data.domain.verified && !domain.data.domain.isDefault ? <Button title="Make default sender" disabled={busy || !online} onPress={() => void run("mail.domain.set_default")} /> : null}</View>
      </Card>
      <Card title="DNS records to publish">{domain.data.records.map((record, i) => <Row key={i} id={String(i)} title={`${record.type} ${record.name}`} note={`${record.purpose} · ${record.state}`} trailing={<Text selectable style={s.text}>{record.value}</Text>} />)}</Card>
    </> : null}
    {notice ? <Text style={s.text}>{notice}</Text> : null}
  </Frame>;
}
