# view_as.started

An admin previewed what another person sees (audited)

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /target |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  target: string;
  expiresAt: number;
};
```
