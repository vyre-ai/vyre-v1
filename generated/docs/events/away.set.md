# away.set

A person set themselves away until a time with an approvals delegate

| | |
|---|---|
| Module | notifications |
| Schema version | 1 |
| Subject | entity at /person |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  until: number;
  delegate: {
    kind: "person" | "role" | "none";
    id?: string;
  };
};
```
