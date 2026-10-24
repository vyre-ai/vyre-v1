# journey.designed

The Journey design changed (stages, tasks, rules or start rule); a new version

| | |
|---|---|
| Module | journeys |
| Schema version | 1 |
| Subject | entity at /journeyId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  journeyId: string;
  version: number;
  stages: Array<string>;
  by: string;
};
```
