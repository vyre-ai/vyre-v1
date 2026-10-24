# conflict.resolved

A conflict was resolved (summary and choice, values never in the payload)

| | |
|---|---|
| Module | conflicts |
| Schema version | 1 |
| Subject | entity at /conflictId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  conflictId: string;
  resolutionId: string;
  choice: string;
  by: string;
  summary: string;
};
```
