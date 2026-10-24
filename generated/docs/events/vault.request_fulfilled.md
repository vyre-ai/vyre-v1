# vault.request_fulfilled

A requested key was supplied; the waiting run can resume

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
| Retention | audit |

## Payload

```ts
type Payload = {
  requestId: string;
  itemId: string;
  forRun?: string;
};
```
