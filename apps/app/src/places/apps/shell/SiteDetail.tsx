// One site: its address, whether it answers, where it runs, who may reach it, its log, custom domains, and stop. A site is a route, so there is nothing here to build: an agent runs it on a computer.
// Going public is an outward act: a person's press is their yes, and a call that Gate still holds opens its request.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useAppsData } from "./data.tsx";
import { actionKey, errorMessage, mutate } from "./mutations.ts";
import { Button, Card, Frame, Select, s, useOnline, useRead } from "./editor-ui.tsx";
import { DeployedSite } from "./DeployedSite.tsx";

type Site = CapMap["sites.get"]["out"]["site"];
type DomainState = CapMap["sites.domain_check"]["out"]["state"];
const ACCESS = [{ key: "public", title: "Anyone with the address" }, { key: "space", title: "People in this Space" }, { key: "private", title: "Only you and people you share with" }] as const;
const STATE_WORD: Readonly<Record<DomainState, string>> = { waiting_dns: "Waiting for DNS", issuing: "Issuing certificate", live: "Live" };

export const copy = (text: string): void => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(text).catch(() => undefined); };

/** What the page says about a site in one line. */
export function siteLine(site: Pick<Site, "live" | "blocked">, status: { answering: boolean; detail?: string } | null): string {
  if (site.blocked) return "Taken down by an admin of this server.";
  if (!site.live) return "Not published. Nothing is served at its address.";
  if (!status) return "Live.";
  return status.answering ? "Live and answering." : status.detail ?? "Published, but it is not answering.";
}

export function DomainRow({ siteId, domain, online }: { siteId: string; domain: string; online: boolean }): ReactElement {
  const d = useAppsData();
  const check = useRead<CapMap["sites.domain_check"]["out"]>("sites.domain_check", { siteId, domain }, "sites");
  const [error, setError] = useState<string | null>(null);
  const remove = (): void => { void d.call("sites.domain_set", { siteId, domain, remove: true }).then(() => check.refresh(), (e: unknown) => setError(errorMessage(e))); };
  return <View testID={`site-domain-${domain}`}>
    <Row id={domain} title={domain} note={check.data ? STATE_WORD[check.data.state] : check.error ?? "Checking"} trailing={<Button title="Remove" disabled={!online} onPress={remove} />} />
    {check.data && check.data.state === "waiting_dns" ? check.data.records.map((r) => <Row key={`${r.type}${r.name}`} id={`${r.type}${r.name}`} title={`${r.type} ${r.name}`} note={r.value} trailing={<Button title="Copy" onPress={() => copy(r.value)} />} />) : null}
    {error ? <Text style={s.text}>{error}</Text> : null}
  </View>;
}

export function SiteDetail({ id, back }: { id: string; back(): void }): ReactElement {
  const d = useAppsData(), online = useOnline();
  const site = useRead<CapMap["sites.get"]["out"]>("sites.get", { siteId: id }, "sites");
  const status = useRead<CapMap["sites.status"]["out"]>("sites.status", { siteId: id }, "sites");
  const host = useRead<CapMap["sites.host"]["out"]>("sites.host", {}, "sites");
  const domains = useRead<CapMap["sites.domains_get"]["out"]>("sites.domains_get", { siteId: id }, "sites");
  const logs = useRead<CapMap["sites.logs"]["out"]>("sites.logs", { siteId: id, tail: 100 }, "sites");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [domain, setDomain] = useState("");
  const again = (): void => { site.refresh(); status.refresh(); domains.refresh(); };
  const run = async (cap: string, input: Record<string, unknown>): Promise<void> => {
    setBusy(true); setError(null);
    try {
      const out = await mutate(d, cap, input, actionKey());
      if (out?.status === "held") { d.nav.openTask(out.taskId); return; }
      again();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const x = site.data?.site;
  const domainRows: ReactElement[] = [];
  for (const row of domains.data?.domains ?? []) domainRows.push(<DomainRow key={row.domain} siteId={id} domain={row.domain} online={online} />);
  const publish = (): void => { if (x) void run(x.access === "public" ? "sites.promote" : "sites.publish", { siteId: id }); };
  // a site Vyre builds and runs has its own page: deploys, build log, env vars, database
  if (x?.deployed) return <DeployedSite site={x} refresh={site.refresh} back={back} />;
  return <Frame testID="apps-site-detail" title={x?.name ?? "Site"} back={back} offline={!online} error={error ?? site.error} loading={site.loading} retry={site.refresh}>
    {x ? <>
      <Card title="Address">
        <Text selectable style={s.text} testID="site-url">{x.url ?? "It gets an address when it is published."}</Text>
        <Text style={s.text} testID="site-line">{siteLine(x, status.data)}</Text>
        {host.data?.relay ? <Text style={s.text}>On a vyre.run address a site runs in a sandbox with no cookies. A site that needs them belongs on a custom domain.</Text> : null}
        <View style={s.actions}>
          {x.url ? <Button title="Copy address" onPress={() => copy(x.url as string)} /> : null}
          {x.url ? <Button title="Open" onPress={() => d.nav.openUrl?.(x.url as string)} /> : null}
          {x.live ? <Button title="Stop" testID="site-stop" disabled={busy || !online} onPress={() => void run("sites.stop", { siteId: id })} /> : <Button title="Publish" primary testID="site-publish" disabled={busy || !online || x.blocked === true} onPress={publish} />}
        </View>
      </Card>
      <Card title="Where it runs">
        <Text style={s.text} testID="site-where">{x.folderId ? "A folder in Files" : x.port !== undefined ? `${x.computerId ? "An agent computer" : "This computer"}, port ${x.port}` : "Nowhere yet. Ask an agent to run it."}</Text>
      </Card>
      <Card title="Access">
        <Select label="Who can reach it" value={x.access ?? "private"} options={ACCESS} disabled={busy || !online} onChange={(access) => void run("sites.update", { siteId: id, access })} />
      </Card>
      <Card title="Domains">
        {domainRows}
        {host.data && !host.data.domains ? <><Text style={s.text} testID="site-domains-need">{host.data.domainsNeed}</Text><View style={s.actions}><Button title="Add a server" onPress={() => d.nav.openComputers?.()} /></View></> : <View style={s.actions}>
          <TextInput accessibilityLabel="Domain" value={domain} onChangeText={setDomain} placeholder="www.example.com" placeholderTextColor="var(--ink-4)" style={[s.input, { flex: 1 }]} />
          <Button title="Add domain" testID="site-add-domain" disabled={busy || !online || domain.trim() === ""} onPress={() => { void run("sites.domain_add", { siteId: id, domain: domain.trim() }).then(() => setDomain("")); }} />
        </View>}
      </Card>
      <Card title="Logs">
        {(logs.data?.lines.length ?? 0) > 0 ? <Text selectable testID="site-logs" style={[s.text, { fontFamily: "var(--mono)" as string, fontSize: 12 }]}>{logs.data!.lines.slice(-100).join("\n")}</Text> : <Text style={s.text}>Nothing logged. An agent writes it to ~/sites/{x.slug ?? "name"}/site.log on the computer.</Text>}
      </Card>
    </> : null}
  </Frame>;
}
