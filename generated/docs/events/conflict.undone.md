# conflict.undone

A resolution was undone

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
};
```
