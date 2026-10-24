# spend.paused

All AI spend was paused

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  by: string;
  reason?: string;
};
```
