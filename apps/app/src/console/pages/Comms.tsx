import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";

type Domains = CapMap["mail.domain.list"]["out"];
export function DomainsPage(): ReactElement {
  const list = useRead<Domains>("mail.domain.list", {});
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<"resend" | "mailgun">("resend");
  const [selected, setSelected] = useState<Domains["domains"][number] | null>(null);
  const [records, setRecords] = useState<CapMap["mail.domain.check"]["out"]["records"]>([]);
  const [confirm, setConfirm] = useState(false);
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const rows = list.data.domains.map((domain) => <Row key={domain.id} id={`console-domain-${domain.id}`} title={domain.name} note={`${domain.provider} · ${domain.verified ? "Verified" : "Pending"}${domain.isDefault ? " · Default" : ""}`} onPress={() => { setSelected(domain); setRecords([]); setConfirm(false); }} />);
  return <View testID="console-domains"><Section title="Sending domains" count={rows.length}><Group>{rows.length ? rows : <Note>No sending domains.</Note>}</Group></Section><Section title="Add domain"><Group><Field label="Domain" value={name} onChange={setName} /><Field label="Provider (resend or mailgun)" value={provider} onChange={(value) => { if (value === "resend" || value === "mailgun") setProvider(value); }} /><Button label="Add domain" disabled={!name.trim() || action.busy} onPress={() => void action.run("mail.domain.add", { name: name.trim(), provider, idempotencyKey: attempt() }, "Domain added")} /></Group></Section>{selected ? <Section title={selected.name}><Group><Row id="domain-spf" title="SPF" note={selected.spf} /><Row id="domain-dkim" title="DKIM" note={selected.dkim} /><Row id="domain-dmarc" title="DMARC" note={selected.dmarc} />{records.map((record) => <Row key={`${record.purpose}:${record.name}`} id={`domain-record-${record.purpose}`} title={`${record.type} ${record.name}`} note={`${record.value} · ${record.state}`} />)}</Group><Actions><Button label="Check DNS" onPress={() => void action.run<CapMap["mail.domain.check"]["out"]>("mail.domain.check", { domainId: selected.id }, "DNS checked").then((out) => { if (out) setRecords(out.records); })} />{!selected.isDefault ? <Button label="Make default" disabled={!selected.verified} onPress={() => void action.run("mail.domain.set_default", { domainId: selected.id }, "Default domain updated")} /> : null}<Button label="Remove…" danger onPress={() => setConfirm(true)} /></Actions>{confirm ? <Actions><Button label="Cancel" onPress={() => setConfirm(false)} /><Button label="Confirm removal" danger onPress={() => void action.run("mail.domain.remove", { domainId: selected.id }, "Domain removed").then((out) => { if (out) setSelected(null); })} /></Actions> : null}</Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}

type Numbers = CapMap["telephony.number.list"]["out"];
export function NumbersPage(): ReactElement {
  const list = useRead<Numbers>("telephony.number.list", {});
  const [selected, setSelected] = useState<Numbers["numbers"][number] | null>(null);
  const [country, setCountry] = useState("US");
  const [areaCode, setAreaCode] = useState("");
  const [available, setAvailable] = useState<CapMap["telephony.number.search"]["out"]["available"]>([]);
  const [confirm, setConfirm] = useState(false);
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const rows = list.data.numbers.map((number) => <Row key={number.id} id={`console-number-${number.id}`} title={number.title} note={`${number.e164} · ${number.state} · ${number.a2p} · ${number.assigneeKind}${number.assigneeId ? ` ${number.assigneeId}` : ""}`} onPress={() => { setSelected(number); setConfirm(false); }} />);
  return <View testID="console-numbers"><Section title="Numbers" count={rows.length}><Group>{rows.length ? rows : <Note>No numbers.</Note>}</Group></Section><Section title="Buy a number"><Group><Field label="Country" value={country} onChange={setCountry} /><Field label="Area code" value={areaCode} onChange={setAreaCode} /><Button label="Search available numbers" disabled={!country.trim() || action.busy} onPress={() => void action.run<CapMap["telephony.number.search"]["out"]>("telephony.number.search", { country: country.trim().toUpperCase(), ...(areaCode.trim() ? { areaCode: areaCode.trim() } : {}) }, "Search complete").then((out) => { if (out) setAvailable(out.available); })} />{available.map((number) => <Row key={number.e164} id={`available-${number.e164}`} title={number.e164} note={`${number.locality ?? ""} ${number.region ?? ""}`.trim()} trailing={<Button label="Buy" onPress={() => void action.run("telephony.number.buy", { e164: number.e164, title: number.e164, assigneeKind: "inbox", idempotencyKey: attempt() }, "Number purchased")} />}/>)}</Group></Section>{selected ? <Section title={selected.title}><Group><Row id="number-address" title="Number" note={selected.e164} /><Row id="number-route" title="Route" note={`${selected.route.ring.length} targets · ${selected.route.ringSeconds}s · ${selected.route.voicemail ? "Voicemail" : "No voicemail"}`} /><Row id="number-hours" title="Hours" note={`${selected.hours.zone} · Outside: ${selected.hours.outsideHours}`} /><Row id="number-recording" title="Recording" note={selected.recording} trailing={<Button label={selected.recording === "off" ? "Announce recording" : "Turn recording off"} onPress={() => void action.run("telephony.number.set_recording", { numberId: selected.id, recording: selected.recording === "off" ? "announce" : "off" }, "Recording policy updated")} />} /></Group><Button label="Release number…" danger onPress={() => setConfirm(true)} />{confirm ? <Actions><Button label="Cancel" onPress={() => setConfirm(false)} /><Button label="Confirm release" danger onPress={() => void action.run("telephony.number.release", { numberId: selected.id, idempotencyKey: attempt() }, "Number released").then((out) => { if (out) setSelected(null); })} /></Actions> : null}</Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}

type Mailboxes = CapMap["mail.mailbox.list"]["out"];
export function InboxesPage(): ReactElement {
  const list = useRead<Mailboxes>("mail.mailbox.list", { scope: "shared" });
  const routes = useRead<CapMap["mail.route.list"]["out"]>("mail.route.list", {});
  const [selected, setSelected] = useState<Mailboxes["mailboxes"][number] | null>(null);
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "space" | "people">("space");
  const action = useAction(() => { list.refresh(); routes.refresh(); });
  if (!list.data || !routes.data) return <ReadState error={list.error ?? routes.error} retry={() => { list.refresh(); routes.refresh(); }} />;
  const rows = list.data.mailboxes.map((mailbox) => <Row key={mailbox.id} id={`console-inbox-${mailbox.id}`} title={mailbox.title} note={`${mailbox.address} · ${mailbox.provider} · ${mailbox.state} · ${mailbox.privacy}`} onPress={() => { setSelected(mailbox); setPrivacy(mailbox.privacy); }} />);
  return <View testID="console-inboxes"><Section title="Shared inboxes" count={rows.length}><Group>{rows.length ? rows : <Note>No shared inboxes yet.</Note>}</Group></Section><Section title="New shared inbox"><Group><Field label="Title" value={title} onChange={setTitle} /><Field label="Address" value={address} onChange={setAddress} /><Button label="Create inbox" disabled={!title.trim() || !address.trim() || action.busy} onPress={() => void action.run("mail.mailbox.create", { kind: "shared", title: title.trim(), address: address.trim(), privacy: "space", idempotencyKey: attempt() }, "Inbox created")} /></Group></Section>{selected ? <Section title={selected.title}><Group><Row id="inbox-provider" title="Provider" note={selected.provider} /><Field label="Privacy (private, space or people)" value={privacy} onChange={(value) => { if (value === "private" || value === "space" || value === "people") setPrivacy(value); }} /><Button label="Save Privacy" disabled={privacy === selected.privacy || action.busy} onPress={() => void action.run("mail.mailbox.set_privacy", { mailboxId: selected.id, privacy }, "Privacy updated")} />{routes.data.routes.filter((route) => route.mailboxId === selected.id).map((route) => <Row key={route.id} id={`mail-route-${route.id}`} title={`${route.localPart}@${route.domainId}`} note={route.provider} />)}</Group></Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}

export function TextingPage(): ReactElement {
  const current = useRead<CapMap["telephony.registration.get"]["out"]>("telephony.registration.get", {});
  const [legalName, setLegalName] = useState("");
  const [ein, setEin] = useState("");
  const [website, setWebsite] = useState("");
  const [useCase, setUseCase] = useState("");
  const action = useAction(current.refresh);
  if (!current.data) return <ReadState error={current.error} retry={current.refresh} />;
  const registration = current.data.registration;
  return <View testID="console-texting"><Section title="Texting registration"><Group>{registration ? <><Row id="registration-name" title={registration.legalName} note={registration.state} /><Row id="registration-id" title="Registration id" note={registration.id} />{registration.rejectedReason ? <Note>{registration.rejectedReason}</Note> : null}</> : <Note>No registration draft yet.</Note>}<Field label="Legal name" value={legalName} onChange={setLegalName} /><Field label="EIN" value={ein} onChange={setEin} /><Field label="Website" value={website} onChange={setWebsite} /><Field multiline label="Messaging use case" value={useCase} onChange={setUseCase} /><Actions><Button label="Save draft" testID="registration-save" disabled={!legalName.trim() || action.busy} onPress={() => void action.run("telephony.registration.save", { legalName: legalName.trim(), ...(ein.trim() ? { ein: ein.trim() } : {}), ...(website.trim() ? { website: website.trim() } : {}), ...(useCase.trim() ? { useCase: useCase.trim() } : {}) }, "Registration saved")} />{registration && registration.state === "draft" ? <Button label="Submit registration" testID="registration-submit" disabled={action.busy} onPress={() => void action.run("telephony.registration.submit", { registrationId: registration.id }, "Registration submitted")} /> : null}{registration && registration.state !== "draft" ? <Button label="Refresh status" disabled={action.busy} onPress={() => void action.run("telephony.registration.refresh", { registrationId: registration.id }, "Status refreshed")} /> : null}</Actions></Group></Section>{action.note ? <Note>{action.note}</Note> : null}</View>;
}
