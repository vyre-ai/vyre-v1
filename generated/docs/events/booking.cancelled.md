# booking.cancelled

A booking was cancelled

| | |
|---|---|
| Module | forms |
| Schema version | 1 |
| Subject | form at /formId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  bookingId: string;
  formId: string;
};
```
