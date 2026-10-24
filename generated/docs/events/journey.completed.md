# journey.completed

A Journey record reached a final stage

| | |
|---|---|
| Module | journeys |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A Journey completes |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  journeyId: string;
  recordId: string;
  stage: string;
};
```
