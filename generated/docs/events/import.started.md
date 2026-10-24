# import.started

An import Run began writing rows

| | |
|---|---|
| Module | import |
| Schema version | 1 |
| Subject | entity at /importId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  importId: string;
  runId: string;
  type: string;
  source: "csv" | "excel" | "airtable" | "notion" | "google_sheets";
  rows: number;
};
```
