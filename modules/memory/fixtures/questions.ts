// The 50 questions of the proof set (ARCH 6.10): 40 with a right answer somewhere in the world, 5 that must answer with today's value and never a closed, removed or proposed one,
// and 5 that have no answer in memory at all (the pointer block must stay empty). `expect` lists every right answer; any of them counts. Keys are fact:<id> or note:<noteId>.
import { BILLING, INTAKE } from "./world.ts";

export interface Question {
  q: string;
  kind: "relevant" | "stale" | "irrelevant";
  agentId: string;
  expect: string[];
  /** Facts that must not be offered for this question. */
  forbid?: string[];
}

const n = (id: string): string => `note:not_${id}`;
const f = (id: string): string => `fact:fct_${id}`;
const r = (q: string, expect: string[], agentId: string = INTAKE): Question => ({ q, kind: "relevant", agentId, expect });
const s = (q: string, expect: string[], forbid: string[], agentId: string = INTAKE): Question => ({ q, kind: "stale", agentId, expect, forbid });
const i = (q: string): Question => ({ q, kind: "irrelevant", agentId: INTAKE, expect: [] });

export const QUESTIONS: Question[] = [
  r("How does Dana like her meeting summaries?", [f("w01")]),
  r("When should invoices go out each month?", [f("w02")]),
  r("What timezone does Dana work in?", [f("w03")]),
  r("Who is Dana's assistant?", [f("w04")]),
  r("When is the Harlow brand refresh due?", [f("w05"), n("n04")]),
  r("What replaced Mailchimp for the newsletter?", [f("w06")]),
  r("Does Dana like exclamation marks in client emails?", [f("w07"), n("n03")]),
  r("What coffee does Dana order?", [f("w08")]),
  r("Can Dana approve discounts herself?", [f("w09")], BILLING),
  r("What does Intake ask every new client for?", [f("a01"), n("n01")]),
  r("Who gets urgent requests from Intake?", [f("a02"), n("n02")]),
  r("Do refunds need a second approver?", [f("a03"), n("n02")]),
  r("Where are signed contracts filed?", [f("a04"), n("n01")]),
  r("How long is the onboarding call?", [f("a05"), n("n01")]),
  r("What is Harlow's brand colour?", [f("p01"), n("n04")]),
  r("Who approves Harlow copy?", [f("p02"), n("n04")]),
  r("When does the Harlow website launch?", [f("p03"), n("n04")]),
  r("How soon are Harlow invoices paid?", [f("p04")]),
  r("When is the office closed?", [f("s01"), n("n05")]),
  r("How long until client files are archived?", [f("s02"), n("n05")]),
  r("Which tools does the Studio use for design review?", [f("s03")]),
  r("How soon must expense receipts be uploaded?", [f("s04"), n("n05")]),
  r("Where does the main phone line forward after hours?", [f("s05")]),
  r("When does billing run the invoice batch?", [f("b01"), n("n06")], BILLING),
  r("What late fee applies?", [f("b02"), n("n06")], BILLING),
  r("What is Omar Haddad's role in escalations?", [f("a02"), n("n02")]),
  r("Who is Fiona Walsh?", [f("p02"), n("n04")]),
  r("Colour palette for the Harlow refresh?", [f("p01"), n("n04")]),
  r("What does the onboarding checklist say?", [n("n01")]),
  r("Show me the escalation policy", [n("n02")]),
  r("What is our brand voice?", [n("n03")]),
  r("Studio handbook rules", [n("n05")]),
  r("Billing calendar", [n("n06")], BILLING),
  r("Harlow refresh plan", [n("n04")]),
  r("Which coffee order does Dana prefer?", [f("w08")]),
  r("What time does Dana start work?", [f("w03")]),
  r("Is there a budget question during intake?", [f("a01"), n("n01")]),
  r("What does Dana want in client emails?", [f("w07"), n("n03")]),
  r("Archive rule for old client files", [f("s02"), n("n05")]),
  r("Who handles calendar conflicts?", [f("w04")]),
  s("Is the Harlow website launch set for October 3?", [f("p03"), n("n04")], [f("c01")]),
  s("Does Dana prefer meeting summaries as a long paragraph?", [f("w01")], [f("c02")]),
  s("Is the late fee 1 percent after 30 days?", [f("b02"), n("n06")], [f("c04")], BILLING),
  s("Is Dana's timezone Eastern?", [f("w03")], [f("c03")]),
  s("Should Intake offer every new client a ten percent discount?", [f("a01")], [f("x01")]),
  i("What is the weather in Lisbon tomorrow?"),
  i("Recommend a good sci-fi novel"),
  i("How do I bake sourdough bread?"),
  i("Thanks, sounds good"),
  i("Who won the football match yesterday evening?"),
];
