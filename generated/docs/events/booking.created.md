# booking.created

A booking was made; a record and a meeting were created or updated

| | |
|---|---|
| Module | forms |
| Schema version | 1 |
| Subject | form at /formId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A booking is made |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  bookingId: string;
  formId: string;
  recordId: string;
};
```
