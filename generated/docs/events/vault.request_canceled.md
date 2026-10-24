# vault.request_canceled

The requester withdrew a key request

| | |
|---|---|
| Module | vault-requests |
| Schema version | 1 |
| Subject | entity at /requestId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  requestId: string;
};
```
