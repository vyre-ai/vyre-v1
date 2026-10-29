# connection.pending

A connection was started and waits for its sign-in; it exists (so its owner can use it) but is not announced as made yet

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | connection at /connectionId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  connectionId: string;
  connector: string;
  ownerKind: "person" | "space";
};
```
