// Mount for P-L9f_07: the join pages against the prototype's Join place. ?view=<state>&space=northwind|harbor picks the state,
// named as the prototype's hash tokens are: accept, s1, s2, s3, rec, ai, setup, done, expired, signin, totp, checklist.
import type { ReactNode } from "react";
import { Checklist } from "../../../apps/app/src/join/Checklist.tsx";
import { JoinFlow } from "../../../apps/app/src/join/JoinFlow.tsx";
import type { FlowState, JoinInvite } from "../../../apps/app/src/join/logic.ts";

export const title = "Join pages";

const NORTHWIND: JoinInvite = {
  space: "Northwind", host: "northwind", by: "Irfad Imtiaz", role: "Member", email: "irfad@northwind.example",
  names: { first: "Dana", last: "Whitfield" }, deviceName: "Dana's MacBook",
  starting: { agents: ["Intake", "Billing", "Research", "Docs"], projects: ["Rivera matter", "Q4 billing", "Hiring"] },
  sso: ["Google", "Microsoft", "Okta"], github: true, adminKey: true,
};
const HARBOR: JoinInvite = {
  space: "Harbor Studio", host: "harbor", by: "Ines Costa", role: "Member", email: "ines@harborstudio.example",
  names: { first: "June", last: "Okafor" }, deviceName: "June's MacBook",
  starting: { agents: ["Assistant", "Scheduler", "Proofer"], projects: ["Brand refresh", "Launch site", "Studio ops"] },
  sso: ["Google"], github: true, adminKey: false,
};
const TAKEN = ["irfad", "maya", "omar", "lena", "sam", "admin", "ines", "theo"];
const CODE = "K7QM-4TXD-92HB-WPLE";
const PASSWORD = "harbor-lamp-ninety";

function stateFor(view: string, invite: JoinInvite): Partial<FlowState> {
  const user = invite.names?.first.toLowerCase() ?? "";
  const filled = { user, pw: PASSWORD, pw2: PASSWORD };
  switch (view) {
    case "s1": return { stage: "steps", step: 0, user };
    case "s2": return { stage: "steps", step: 1, ...filled };
    case "s3": return { stage: "steps", step: 2, ...filled };
    case "rec": return { stage: "steps", step: 2, ...filled, rec: "new", sheet: true, code: CODE };
    case "ai": return { stage: "steps", step: 3, ...filled };
    case "setup": return { stage: "run", step: 3, run: 2, ...filled };
    case "done": return { stage: "done", step: 3, ...filled };
    case "signin": return { stage: "signin", si: "pw" };
    case "totp": return { stage: "signin", si: "totp", siUser: user, siPw: "x" };
    default: return {};
  }
}

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
  const view = q.get("view") ?? "accept";
  const invite = q.get("space") === "harbor" ? HARBOR : NORTHWIND;
  if (view === "checklist") {
    return (
      <Checklist
        space={invite.space} visible assistantLocked={false}
        items={[
          { key: "photo_and_title", title: "Add a photo and title", done: false },
          { key: "connect_mailbox_and_calendar", title: "Connect your mailbox and calendar", done: false },
          { key: "meet_assistant", title: "Meet your assistant", done: false },
          { key: "open_first_project", title: "Open your first project", done: false },
          { key: "import", title: "Import your mailboxes, drives, CRM or spreadsheets", done: false },
        ]}
      />
    );
  }
  return <JoinFlow invite={invite} expired={view === "expired"} initial={stateFor(view, invite)} isTaken={(u) => TAKEN.includes(u)} hold />;
}
