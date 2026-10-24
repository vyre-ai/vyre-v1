# import.completed

An import finished

| | |
|---|---|
| Module | import |
| Schema version | 1 |
| Subject | entity at /importId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | An import finishes |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  importId: string;
  runId: string;
  type: string;
  source: "csv" | "excel" | "airtable" | "notion" | "google_sheets";
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  ranAutomations: boolean;
};
```
