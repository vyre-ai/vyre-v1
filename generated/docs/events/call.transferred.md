# call.transferred

A call moved to a teammate or an agent

| | |
|---|---|
| Module | telephony |
| Schema version | 1 |
| Subject | entity at /callId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  callId: string;
  to: {
    kind: "person" | "agent" | "group";
    id: string;
  };
  mode: "warm" | "cold";
};
```
