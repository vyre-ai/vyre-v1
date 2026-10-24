// Golden flow 1: Lead to client to project. Steps live in golden/steps/01-lead-to-client-to-project.ts (L11).
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 1,
  name: "lead-to-client-to-project",
  title: "Lead to client to project",
  needs: ["forms", "contacts-link", "journeys", "records", "projects", "chat", "files"],
  events: ["form.submitted", "record.created", "journey.started", "project.created"],
});
