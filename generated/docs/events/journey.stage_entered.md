# journey.stage_entered

A Journey record entered a stage

| | |
|---|---|
| Module | journeys |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A Journey record enters a stage |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  journeyId: string;
  recordId: string;
  stage: string;
  previousStage?: string;
  version: number;
  manual: boolean;
  reason?: string;
};
```
