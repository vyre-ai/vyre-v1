// A recorded meeting for the close-out tests (invented people): the transcript as Zoom hands it over, and the answer the owner's Assistant gave for it (meetings.closeout.propose input).
// Maya Ortiz runs the call, Sam Reyes is her colleague, Pat Lee is the client (a contact at Lee Holdings).
import { NOW } from "./harness.ts";

export const SAM = "usr_samr0001";
export const ASSISTANT = "agt_mayaasst1";
export const COMPANY = "rec_leehold01";
const DAY = 86_400_000;

export const TRANSCRIPT = `WEBVTT

1
00:00:01.000 --> 00:00:06.000
Maya Ortiz: Thanks for making time, Pat. Let's go through the renewal.

2
00:00:07.000 --> 00:00:15.000
Pat Lee: Sure. First, my role changed: I'm Head of Operations now, so send things to me directly.

3
00:00:16.000 --> 00:00:24.000
Pat Lee: We've decided to move to the annual plan, starting in January.

4
00:00:25.000 --> 00:00:33.000
Sam Reyes: Great. I'll send the revised quote by Friday the seventeenth.

5
00:00:34.000 --> 00:00:41.000
Maya Ortiz: And I'll set up the onboarding call with your team.

6
00:00:42.000 --> 00:00:50.000
Pat Lee: One thing we haven't settled is whether our legal team needs to review the terms.

7
00:00:51.000 --> 00:00:58.000
Maya Ortiz: Let's meet again next Thursday at three to close that out.`;

/** The day the next meeting was agreed for: a week after the call, at 15:00 UTC. */
export const NEXT_AT = NOW + 7 * DAY - (NOW % DAY) + 15 * 3_600_000;

export const ANSWER = {
  summary: "Pat Lee confirmed Lee Holdings moves to the annual plan from January. Pat is now Head of Operations. Sam sends the revised quote and Maya sets up onboarding. Whether their legal team reviews the terms is still open.",
  decisions: ["Lee Holdings moves to the annual plan, starting in January."],
  questions: ["Does the Lee Holdings legal team need to review the terms?"],
  actions: [
    { title: "Send Pat the revised quote", owner: "Sam", due: new Date(NOW + 8 * DAY).toISOString().slice(0, 10), why: "Sam offered on the call." },
    { title: "Set up the onboarding call with the Lee Holdings team", owner: "Maya Ortiz" },
  ],
  records: [
    { recordId: "rec_pat00001", changes: [{ field: "title", value: "Head of Operations" }, { field: "email", value: "not an address" }], note: "Renewal call: moving to the annual plan from January; legal review still open." },
    { recordId: COMPANY, changes: [{ field: "website", value: "https://leeholdings.example" }] },
  ],
  email: {
    subject: "Next steps on your renewal",
    text: "Hi Pat,\n\nThanks for the time today. To confirm: you are moving to the annual plan from January. Sam will send the revised quote by the 17th, and I will set up the onboarding call with your team. We still need to know whether your legal team wants to review the terms.\n\nTalk Thursday,\nMaya",
  },
  next: { title: "Renewal: legal review", startsAt: new Date(NEXT_AT).toISOString(), minutes: 30 },
};
