# journey.stage_exited

A Journey record left a stage

| | |
|---|---|
| Module | journeys |
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
  journeyId: string;
  recordId: string;
  stage: string;
  toStage?: string;
};
```
