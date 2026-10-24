# journey.started

A subject record started a Journey and its Journey record was created

| | |
|---|---|
| Module | journeys |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A Journey starts |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  journeyId: string;
  recordId: string;
  subjectRecordId: string;
  stage: string;
  version: number;
};
```
