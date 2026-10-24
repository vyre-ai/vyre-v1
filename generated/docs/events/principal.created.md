# principal.created

A person, agent, outside actor or service came to exist

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /principalId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  principalId: string;
  kind: "person" | "agent" | "actor" | "service";
  owner?: string;
};
```
