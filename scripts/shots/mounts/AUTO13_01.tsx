// Mount for lane b-auto (13 Nov 2026): the new Automations screens, one part at a time (?part=home|builder|builder-live|picker|picker-app|picker-search|connect|cards|run|list), with the sample data of the prototype
// (team/v1/prototypes/auto221). Exists only in the shots build; nothing here ships.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { FirstPageView } from "../../../apps/app/src/places/automations/screens/FirstPageView.tsx";
import { ListView } from "../../../apps/app/src/places/automations/screens/ListView.tsx";
import { RunView } from "../../../apps/app/src/places/automations/screens/RunView.tsx";
import { StoryView } from "../../../apps/app/src/places/automations/screens/StoryView.tsx";
import { firstPage } from "../../../apps/app/src/places/automations/first/model.ts";
import { runView } from "../../../apps/app/src/places/automations/run/model.ts";
import { story } from "../../../apps/app/src/places/automations/story/model.ts";
import type { StepIn } from "../../../apps/app/src/places/automations/story/model.ts";
import { StepPicker } from "../../../apps/app/src/places/automations/picker/StepPicker.tsx";
import { ConnectSheet } from "../../../apps/app/src/places/automations/picker/ConnectSheet.tsx";
import type { PickApp, PickStep } from "../../../apps/app/src/places/automations/picker/model.ts";
import {
  AllowCard,
  AskAdminCard,
  CredentialCard,
  FormChoiceView,
  MappingCard,
  TestLeadCard,
  TrailCard,
  UnderstoodCard,
  WaitingCard,
} from "../../../apps/app/src/places/automations/cards/Cards.tsx";
import {
  allowCard,
  askAdminCard,
  formChoiceCard,
  mappingCard,
  testLeadCard,
  trailView,
  understoodCard,
  waitingCard,
} from "../../../apps/app/src/places/automations/cards/model.ts";

export const title = "Automations, the new screens";

const noop = (): void => undefined;
const google = { id: "google", name: "Google Workspace" };
const stripe = { id: "stripe", name: "Stripe" };
const twilio = { id: "twilio", name: "Twilio" };
const notely = { id: "notely", name: "Notely" };
const hub = { id: "hubspot", name: "HubSpot" };

const PICK_STEPS: PickStep[] = [
  { key: "send_email", title: "Send an email", description: "Email a person or a list" },
  { key: "create_task", title: "Create a task", description: "Make a task for someone" },
  { key: "post_message", title: "Post a chat message", description: "Say it in a channel" },
  { key: "files.save", title: "Save a file" },
  { key: "sign", title: "Send for signature" },
  { key: "calendar.create_event", title: "Add a calendar event" },
  { key: "records.create", title: "Add a record" },
  { key: "forms.send", title: "Send a form" },
  { key: "ai", title: "Ask an agent" },
  { key: "approval", title: "Ask a person to approve" },
  { key: "wait", title: "Wait" },
  { key: "google.gmail.send_message", title: "Send a Gmail message", description: "Send from your inbox" },
  { key: "google.sheets.append_values", title: "Add a row to a sheet", description: "To a Google Sheet" },
  { key: "google.drive.create_folder", title: "Save to Google Drive", description: "A copy in a Drive folder" },
  { key: "connector_request", title: "Add a contact", preset: { connector: "notely", action: "add_contact" } },
  { key: "connector_request", title: "Update a contact", preset: { connector: "notely", action: "update_contact" } },
  { key: "connector_request", title: "Create an invoice", preset: { connector: "stripe", action: "create_invoice" } },
  { key: "connector_request", title: "Text a number", preset: { connector: "twilio", action: "send_text" } },
];
const PICK_APPS: PickApp[] = [
  { id: "google", name: "Google Workspace", connected: true, mayUse: true },
  { id: "stripe", name: "Stripe", connected: true, mayUse: true },
  { id: "twilio", name: "Twilio", connected: true, mayUse: true },
  { id: "notely", name: "Notely", connected: true, mayUse: true },
  { id: "microsoft", name: "Microsoft 365", connected: true, mayUse: false, admin: "Dana Whitfield" },
  { id: "github", name: "GitHub", connected: false, mayUse: false },
  {
    id: "hubspot",
    name: "HubSpot",
    connected: false,
    mayUse: false,
    vault: { item: "HubSpot key", use: "use", assistant: "owner" },
  },
];

const chip = (label: string, from: string, sample: string) => ({ chip: { label, from, sample } });
const STEPS: StepIn[] = [
  {
    id: "a",
    app: { id: "gdrive", name: "Google Workspace" },
    action: "Save to Drive",
    template: "Save {file} to Drive / {folder}",
    values: { file: chip("Uploaded file", "A form is submitted", "brief.pdf"), folder: { text: "Clients" } },
  },
  {
    id: "b",
    app: { id: "vyre:docs", name: "Documents and signing" },
    action: "Send for signature",
    template: "Send {file} to {to} for signature",
    values: { to: chip("Email", "A form is submitted", "sam@brightpath.io") },
    needs: [{ kind: "value", line: "Choose the file to send", button: "Choose the file" }],
    writes: true,
  },
  {
    id: "c",
    app: { id: "vyre:chat", name: "Messages" },
    action: "Post a chat message",
    template: "Post in {channel}: New request from {name}",
    values: { channel: { text: "#ops" }, name: chip("Name", "A form is submitted", "Sam Reyes") },
    writes: true,
  },
];
const TRIGGER = {
  id: "t",
  app: { id: "vyre:forms", name: "Forms" },
  template: "A form is submitted: {form}",
  values: { form: { text: "Intake questionnaire" } },
  hand: false,
};
const BASE = { name: "Intake to signature", on: false, proposed: false, dirty: false, test: null };

function Frame({ children, width = 760 }: { children: ReactNode; width?: number }): ReactNode {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: "center", paddingVertical: 24 }}>
      <View style={{ width: "100%", maxWidth: width }}>{children}</View>
    </ScrollView>
  );
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(
    () =>
      setPart(
        new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ??
          "home",
      ),
    [],
  );
  if (part === null) return null;
  if (part === "home")
    return (
      <Frame>
        <FirstPageView
          now={Date.now()}
          summary="5 on, 2 need you"
          onAsk={noop}
          page={firstPage({
            needs: [
              {
                id: "n1",
                automation: "New lead follow-up",
                why: "Step 2, Text to me, could not run: the Twilio key is missing.",
                at: Date.now() - 1.5 * 3600_000,
                runId: "r4",
                app: "twilio",
                fix: { label: "Add the key", kind: "key" },
              },
              {
                id: "n2",
                automation: "Invoice reminders",
                why: "Waiting for you to approve 4 invoices before they go out.",
                at: Date.now() - 26 * 3600_000,
                runId: "r3",
                app: "stripe",
                fix: { label: "Approve all 4", kind: "approve" },
              },
            ],
            suggestions: [
              { id: "s1", app: notely, item: "Notely API key", mayUse: true, knownService: true, assistant: "owner" },
            ],
            today: { ran: 4, failed: [{ runId: "r4" }] },
          })}
          onFix={noop}
          onSeeRun={noop}
          onSetUp={noop}
          onNotNow={noop}
          onNew={noop}
          onExamples={noop}
          onAllRuns={noop}
        />
      </Frame>
    );
  if (part === "builder" || part === "builder-live")
    return (
      <Frame>
        <StoryView
          story={story(
            part === "builder"
              ? { ...BASE, proposed: true, trigger: TRIGGER, steps: STEPS }
              : {
                  ...BASE,
                  on: true,
                  dirty: true,
                  trigger: TRIGGER,
                  steps: STEPS.map((s) => ({ ...s, needs: undefined })),
                },
          )}
          on={noop}
        />
      </Frame>
    );
  if (part === "picker" || part === "picker-app" || part === "picker-search")
    return (
      <StepPicker
        model={{
          steps: PICK_STEPS,
          apps: PICK_APPS,
          suggested: ["create_task", "send_email", "post_message"],
          suggestedFrom: "name, email",
        }}
        x={420}
        y={120}
        onChoose={noop}
        onConnect={noop}
        onClose={noop}
        {...(part !== "picker" ? { initial: part === "picker-app" ? { open: "app:google" } : { query: "sign" } } : {})}
      />
    );
  if (part === "connect")
    return (
      <ConnectSheet
        apps={PICK_APPS}
        known={[
          { id: "hubspot", name: "HubSpot" },
          { id: "slack", name: "Slack" },
          { id: "wordpress", name: "WordPress" },
        ]}
        onSetup={noop}
        onAsk={noop}
        onDescribe={noop}
        onClose={noop}
      />
    );
  if (part === "cards")
    return (
      <Frame width={420}>
        <View style={{ gap: 12 }}>
          <TrailCard
            groups={trailView([
              { app: null, text: "Your WordPress site is northwind.example", state: "done" },
              { app: hub, text: "Read HubSpot's documentation", state: "done" },
              { app: hub, text: "Finding how HubSpot connects", state: "doing" },
            ])}
          />
          <UnderstoodCard
            card={understoodCard({
              trigger: {
                app: { id: "wordpress", name: "WordPress" },
                text: "A form is submitted",
                typed: "wp",
                how: "alias",
              },
              clauses: [
                { order: 1, kind: "action", text: "Send you a Slack message", app: { id: "slack", name: "Slack" } },
                { order: 2, kind: "action", text: "Post in #vyre", app: null },
                { order: 3, kind: "action", text: "Create a lead in HubSpot", app: hub },
              ],
            })}
            onAnswer={noop}
          />
          <FormChoiceView
            card={formChoiceCard({
              site: "northwind.example",
              forms: [
                { id: "f1", name: "Contact", where: "/contact", madeWith: "WPForms" },
                { id: "f2", name: "Newsletter", where: "in the footer", madeWith: "WPForms" },
              ],
              plugins: [],
            })}
            onPick={noop}
            onNeither={noop}
          />
          <CredentialCard
            credential={{ app: hub, mode: "key", field: "Private app token", guide: null, frame: "chat" }}
            port={{ save: async () => "saved" }}
            onClose={noop}
          />
          <MappingCard
            card={mappingCard({
              app: hub,
              noun: "lead",
              pairs: [
                ["Name", "Name"],
                ["Email", "Email"],
                ["Phone", "Phone"],
                ["Message", "Notes"],
              ],
              unmatched: {
                field: "Preferred time",
                choices: [
                  { id: "notes", label: "Put it in Notes" },
                  { id: "skip", label: "Leave it out" },
                ],
              },
            })}
            onChoose={noop}
          />
          <WaitingCard
            card={waitingCard({
              app: { id: "wordpress", name: "WordPress" },
              url: "https://northwind.example/vyre/hook/ab12",
              remindAfterHours: 24,
            })}
            onCheck={noop}
          />
          <TestLeadCard
            card={testLeadCard({ app: hub, noun: "lead", testName: "Vyre test", where: "HubSpot" })}
            onAnswer={noop}
          />
          <AllowCard
            card={allowCard({ app: "Google Workspace", item: "Google Workspace", ctx: "build" })}
            onAnswer={noop}
          />
          <AskAdminCard
            card={askAdminCard({ app: "Microsoft 365", admin: "Dana Whitfield" })}
            asked={false}
            onAsk={noop}
          />
        </View>
      </Frame>
    );
  if (part === "run")
    return (
      <Frame>
        <RunView
          view={runView(
            [
              {
                id: "a",
                app: stripe,
                action: "Make a task",
                template: "Task for {who}",
                values: { who: { text: "Lena, due in 2 days" } },
              },
              {
                id: "b",
                app: twilio,
                action: "Text to me",
                template: "Text to {who}",
                values: { who: { text: "me" } },
                writes: true,
              },
              {
                id: "c",
                app: { id: "gsheets", name: "Google Workspace" },
                action: "Add a row",
                template: "Add a row",
                values: {},
              },
            ],
            {
              a: {
                status: "ok",
                line: "Task for Lena, due in 2 days",
                values: [["Title", "Follow up with Sam Reyes"]],
              },
              b: { status: "failed", why: "The Twilio key is missing.", fix: "Add the key" },
            },
            {
              id: "t",
              app: { id: "vyre:forms", name: "Forms" },
              template: "A form is submitted: {form}",
              values: { form: { text: "Contact form" } },
              hand: false,
            },
          )}
          onFix={noop}
        />
      </Frame>
    );
  return (
    <View style={{ width: 280, padding: 8 }}>
      <ListView
        rows={[
          { id: "1", name: "New lead follow-up", state: "needs", scope: "Space" },
          { id: "2", name: "Invoice reminders", state: "needs", scope: "Space" },
          { id: "3", name: "Daily brief", state: "on", scope: "Space" },
          { id: "4", name: "Notes digest", state: "off", scope: "Shared" },
        ]}
        onOpen={noop}
        onHome={noop}
        onNew={noop}
      />
    </View>
  );
}
