# call.ringing

An incoming call is ringing for someone

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | entity at /callId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | call.incoming |
| Retention | default |

## Payload

```ts
type Payload = {
  callId: string;
  numberId: string;
  from: string;
  contactId?: string;
  ringing: Array<{
      kind: "person" | "agent" | "group";
      id: string;
    }>;
};
```
