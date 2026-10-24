# registration.status_changed

The texting registration changed status

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | entity at /registrationId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  registrationId: string;
  state: "in_review" | "approved" | "rejected";
};
```
