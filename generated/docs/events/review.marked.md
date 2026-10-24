# review.marked

A sampled turn was reviewed

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | entity at /turnId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  turnId: string;
  verdict: string;
  by: string;
};
```
