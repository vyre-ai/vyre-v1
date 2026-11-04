# member.join_requested

A person opened the Request to join link and asked to join; every admin gets a line

| | |
|---|---|
| Module | members |
| Schema version | 1 |
| Subject | entity at /requestId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | Someone asks to join |
| Notification | member.join_requested |
| Retention | audit |

## Payload

```ts
type Payload = {
  requestId: string;
  name: string;
  role: string;
};
```
