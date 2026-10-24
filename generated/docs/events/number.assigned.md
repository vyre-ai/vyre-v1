# number.assigned

A number was assigned to a person, an agent or a shared inbox

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | number at /numberId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  numberId: string;
  assigneeKind: "person" | "agent" | "inbox";
  assigneeId: string;
};
```
