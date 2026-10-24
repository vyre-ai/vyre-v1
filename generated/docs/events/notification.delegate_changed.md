# notification.delegate_changed

A standing approvals delegate chain changed

| | |
|---|---|
| Module | notifications |
| Schema version | 1 |
| Subject | entity at /person |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  chain: Array<{
      kind: "person" | "role" | "none";
      id?: string;
    }>;
};
```
