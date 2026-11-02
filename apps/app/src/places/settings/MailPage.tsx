// Settings > Email and calendar: where a person connects and removes what flows into their Inbox. With nothing connected it is the Inbox's own connect tiles (Gmail, Outlook, Other
// email, Twilio), reused as they are. Once something is in, it lists the person's mailboxes, calendars and the numbers assigned to them, each with what it is doing and a way to stop
// it, and the same tiles sit under them to add another. Inbox joins the rail when the first one arrives and leaves when the last one goes (shell/rail/inbox-sources.ts).
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { ConnectChannel } from "../inbox/connect/ConnectChannel.tsx";
import { useOpenConnect } from "../../shell/connect/context.ts";
import { INBOX_SOURCE_QUERIES, useInboxSources } from "../../shell/rail/inbox-sources.ts";
import { useIsPersonal, useScreenQuery, useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { NOT_CONNECTED, suiteSections, throughFirm } from "./suites.ts";
import { Glyph, Section, SettingsRow, SmallButton, Value, s as ui } from "./ui.tsx";

type MailboxesOut = CapMap["mail.mailbox.list"]["out"];
type CalendarsOut = CapMap["calendar.list_calendars"]["out"];
type NumbersOut = CapMap["telephony.number.list"]["out"];

const PROVIDER: Record<string, string> = { google: "Google", microsoft: "Microsoft", imap: "IMAP", inbound_only: "Receive only", local: "On Vyre" };
const STATE: Record<string, string> = { pending: "Connecting", syncing: "Syncing", paused: "Paused", error: "Needs attention", disconnected: "Disconnected" };
const [MAIL, CALENDARS, NUMBERS] = INBOX_SOURCE_QUERIES;

export function MailPage(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const openConnect = useOpenConnect();
  const personal = useIsPersonal();
  const me = data.me.id;
  const has = useInboxSources(data.screens, me);
  const boxes = useScreenQuery<MailboxesOut>(MAIL[0], MAIL[1], {});
  const cals = useScreenQuery<CalendarsOut>(CALENDARS[0], CALENDARS[1], {});
  const nums = useScreenQuery<NumbersOut>(NUMBERS[0], NUMBERS[1], {});
  const mailboxes = boxes.status === "ready" ? boxes.data.mailboxes.filter((m) => m.state !== "disconnected") : [];
  const calendars = cals.status === "ready" ? cals.data.calendars : [];
  const numbers = nums.status === "ready" ? nums.data.numbers.filter((n) => n.state !== "released" && n.assigneeKind === "person" && n.assigneeId === me) : [];
  const tiles = <ConnectChannel inline connect={(kind) => data.nav.connect(kind === "twilio" || kind === "number" ? "twilio" : "mailbox")} />;

  const remove = (cap: string, input: Record<string, unknown>): void => {
    void data.call(cap, input).then(() => saved.saved("Removed")).catch(() => saved.failed("That did not remove."));
  };

  // what the admin connected for this person through Google Workspace or Microsoft 365
  const suites = suiteSections(mailboxes.map((m) => ({ id: m.id, address: m.address, provider: m.provider, state: m.state })), calendars.map((c) => ({ id: c.id, title: c.title, provider: c.provider, state: c.state })));
  const firmRows: ReactElement[] = [];
  suites.forEach((suite, si) => firmRows.push(
    <SettingsRow key={suite.key} id={`suite.${suite.key}`} label={suite.title} sub={throughFirm(suite)} first={si === 0} lead={<Glyph name="link" size={15} />} control={<Value text={suite.rows.map((r) => r.service).filter((v, i, a) => a.indexOf(v) === i).join(" and ")} />} />,
  ));
  const firm = personal ? null : (
    <Section title="Through your Space" {...(suites.length === 0 && boxes.status === "ready" && cals.status === "ready" ? { note: NOT_CONNECTED } : {})}>{firmRows}</Section>
  );

  const mailRows: ReactElement[] = [];
  mailboxes.forEach((m, i) => mailRows.push(
    <SettingsRow
      key={m.id} id={`mailbox.${m.id}`} label={m.address} first={i === 0} lead={<Glyph name="mail" size={15} />}
      sub={`${PROVIDER[m.provider] ?? m.provider}, ${m.privacy === "private" ? "private to you" : m.privacy === "space" ? "visible to the Space" : "shared with chosen people"}`}
      control={
        <>
          <Value text={STATE[m.state] ?? m.state} accent={m.state === "error"} />
          {m.state === "error" && (m.provider === "google" || m.provider === "microsoft") && openConnect
            ? <SmallButton label="Sign in again" primary testID={`mailbox-fix-${m.id}`} onPress={() => void openConnect({ kind: "mailbox", provider: m.provider as "google" | "microsoft" })} />
            : null}
          {m.state === "paused"
            ? <SmallButton label="Resume" onPress={() => void data.call("mail.mailbox.resume", { mailboxId: m.id }).then(() => saved.saved("Resumed")).catch(() => saved.failed("That did not resume."))} />
            : <SmallButton label="Pause" onPress={() => void data.call("mail.mailbox.pause", { mailboxId: m.id }).then(() => saved.saved("Paused", async () => { await data.call("mail.mailbox.resume", { mailboxId: m.id }); })).catch(() => saved.failed("That did not pause."))} />}
          {m.ownerId === me ? <SmallButton label="Remove" testID={`mailbox-remove-${m.id}`} onPress={() => remove("mail.mailbox.disconnect", { mailboxId: m.id })} /> : null}
        </>
      }
    />,
  ));
  const calRows: ReactElement[] = [];
  calendars.forEach((c, i) => calRows.push(
    <SettingsRow
      key={c.id} id={`calendar.${c.id}`} label={c.title} first={i === 0} sub={PROVIDER[c.provider] ?? c.provider} lead={<View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.color }} />}
      control={c.ownerId === me ? <SmallButton label="Remove" testID={`calendar-remove-${c.id}`} onPress={() => remove("calendar.delete_calendar", { calendarId: c.id })} /> : <Value text={STATE[c.state] ?? c.state} />}
    />,
  ));
  const numRows: ReactElement[] = [];
  numbers.forEach((n, i) => numRows.push(
    <SettingsRow key={n.id} id={`number.${n.id}`} label={n.displayName ?? n.title} first={i === 0} sub={n.e164} lead={<Glyph name="phone" size={15} />} control={<Value text="Assigned to you" />} />,
  ));

  if (has === null) return <>{firm}<Text style={ui.sTitle} accessibilityRole="progressbar">Loading</Text></>;
  if (has === false) return <View testID="mail-empty">{firm}<View style={ui.section}>{tiles}</View></View>;

  return (
    <View testID="mail-sources">
      {firm}
      {mailRows.length > 0 ? <Section title="Mail">{mailRows}</Section> : null}
      {calRows.length > 0 ? <Section title="Calendars">{calRows}</Section> : null}
      {numRows.length > 0 ? <Section title="Numbers">{numRows}</Section> : null}
      <View style={ui.section} testID="mail-add">
        <Text accessibilityRole="header" style={ui.sTitle}>Add</Text>
        {tiles}
      </View>
    </View>
  );
}
