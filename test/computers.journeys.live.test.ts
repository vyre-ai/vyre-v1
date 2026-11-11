// The real app, the agent's Computer tab and the chat around it (rc.9 flows 11 to 13, reshaped for the workspace model of 6 Nov 2026), in a Team Space. The journey is in support/computers-journey.ts;
// the Personal Space's is test/computers.journeys.personal.live.test.ts, in its own file so each stays inside the 120 s file cap.
import { computersJourney } from "./support/computers-journey.ts";

computersJourney("team");
