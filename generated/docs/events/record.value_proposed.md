# record.value_proposed

An agent or automation filled a value; it waits for review or counts straight away, per field

| | |
|---|---|
| Module | records |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  recordId: string;
  type: string;
  field: string;
  source: {
    kind: "agent" | "person" | "form" | "automation" | "sync" | "import";
    actor: string;
    link?: string;
    at: number;
    state: "counted" | "needs_review" | "rejected";
  };
  reviewRequired: boolean;
};
```
