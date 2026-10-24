# journey.created

A Journey and its record type were created

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
  name: string;
  recordType: string;
  subjectType: string;
};
```
