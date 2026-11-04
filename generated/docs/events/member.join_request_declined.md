# member.join_request_declined

A request to join was declined

| | |
|---|---|
| Module | members |
| Schema version | 1 |
| Subject | entity at /requestId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  requestId: string;
};
```
