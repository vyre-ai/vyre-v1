# vault.request_declined

A key request was declined with a note

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
  forRun?: string;
  note?: string;
};
```
