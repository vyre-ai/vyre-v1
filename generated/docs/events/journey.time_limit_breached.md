# journey.time_limit_breached

A stage time limit passed; it reaches the owner Needs you, then the escalation role

| | |
|---|---|
| Module | journeys |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A Journey stage runs over its time limit |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  journeyId: string;
  recordId: string;
  stage: string;
  limitHours: number;
  escalated: boolean;
};
```
