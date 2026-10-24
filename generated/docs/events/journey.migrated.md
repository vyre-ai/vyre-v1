# journey.migrated

In-flight records moved to a new Journey version through a stage mapping

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
  fromVersion: number;
  toVersion: number;
  records: number;
  runId: string;
};
```
